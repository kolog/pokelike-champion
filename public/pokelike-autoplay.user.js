// ==UserScript==
// @name         Pokelike Auto-Player
// @namespace    https://lovable.dev/pokelike-autoplay
// @version      0.4.0
// @description  Auto-plays pokelike.xyz Story mode — type-effectiveness AI with real DOM selectors.
// @match        https://pokelike.xyz/*
// @match        https://www.pokelike.xyz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const G = (k, d) => { try { return typeof GM_getValue === "function" ? GM_getValue(k, d) : (JSON.parse(localStorage.getItem("pai_" + k)) ?? d); } catch { return d; } };
  const S = (k, v) => { try { typeof GM_setValue === "function" ? GM_setValue(k, v) : localStorage.setItem("pai_" + k, JSON.stringify(v)); } catch {} };
  const cfg = {
    running: G("running", false),
    speedMs: G("speedMs", 500),
    debug: G("debug", true),
    evoPreference: G("evoPreference", "last"),
    autoStartRun: G("autoStartRun", true),
    region: G("region", "first"), // first unlocked
  };
  const save = (k, v) => { cfg[k] = v; S(k, v); };
  const log = (...a) => { if (cfg.debug) console.log("%c[PokelikeAI]", "color:#22c55e;font-weight:bold", ...a); };

  // ---------- Type chart (Gen 6+) ----------
  const T = {
    normal:{rock:.5,ghost:0,steel:.5},
    fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5,steel:2},
    water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5},
    electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},
    grass:{fire:.5,water:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5,steel:.5},
    ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2,steel:.5},
    fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0,dark:2,steel:2,fairy:.5},
    poison:{grass:2,poison:.5,ground:.5,rock:.5,ghost:.5,steel:0,fairy:2},
    ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2,steel:2},
    flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5,steel:.5},
    psychic:{fighting:2,poison:2,psychic:.5,dark:0,steel:.5},
    bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,ghost:.5,dark:2,steel:.5,fairy:.5},
    rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2,steel:.5},
    ghost:{normal:0,psychic:2,ghost:2,dark:.5},
    dragon:{dragon:2,steel:.5,fairy:0},
    dark:{fighting:.5,psychic:2,ghost:2,dark:.5,fairy:.5},
    steel:{fire:.5,water:.5,electric:.5,ice:2,rock:2,steel:.5,fairy:2},
    fairy:{fire:.5,fighting:2,poison:.5,dragon:2,dark:2,steel:.5},
  };
  const TYPES = Object.keys(T);
  const eff = (atk, defTypes) => !atk || !defTypes?.length ? 1 :
    defTypes.reduce((m, d) => m * ((T[atk] || {})[d] ?? 1), 1);

  // ---------- DOM helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.05 && s.pointerEvents !== "none";
  };
  const click = (el) => {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", pointerId: 1 }));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", pointerId: 1 }));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      el.click?.();
      return true;
    } catch (e) { console.warn("[PokelikeAI] click error", e); return false; }
  };
  const visText = (sel) => $$(sel).filter(vis);
  const findByText = (sel, regex) => visText(sel).find(e => regex.test((e.innerText || "").trim()));

  // Extract type names from a container by reading .type-badge classes
  const typesIn = (el) => {
    if (!el) return [];
    const out = new Set();
    $$(".type-badge", el).forEach(b => {
      for (const cls of b.classList) {
        const m = /^type-(\w+)$/.exec(cls);
        if (m && TYPES.includes(m[1])) out.add(m[1]);
      }
    });
    return [...out];
  };

  // ---------- Game state detection ----------
  function detectState() {
    if (visText(".game-over, [class*=gameover i]").length || findByText("h1,h2,div", /game over/i)) return "gameover";
    if (findByText("h1,h2,div", /champion|you win|victory/i)) return "victory";
    if (visText(".title-mode-card--story").length) return "title";
    if (visText(".history-region-btn").length) return "region-select";
    if (visText(".trainer-card").length) return "trainer-select";

    // In battle: there are .poke-move buttons that are clickable AND an enemy panel
    const moves = visText(".poke-move");
    if (moves.length >= 1) {
      // Could be starter selection (3 .poke-card with moves but no enemy)
      // Starter screen: 3 poke-cards, no map/battle context
      const pokeCards = visText(".poke-card");
      if (pokeCards.length === 3 && !visText("[class*=enemy], [class*=opponent], [class*=foe]").length && !visText("[class*=battle-]").length) {
        return "starter-select";
      }
      return "battle";
    }

    if (visText("[class*=evolution], [class*=evolve]").length) return "evolution";
    if (visText("[class*=map-node], [class*=encounter], [class*=route]").length) return "map";
    return "idle";
  }

  // ---------- Battle parsing ----------
  function findEnemy() {
    // Try common enemy wrapper classes
    const sels = [".enemy", ".opponent", ".foe", "[class*=enemy]", "[class*=opponent]", "[class*=foe]"];
    for (const s of sels) {
      const el = visText(s)[0];
      if (el) {
        const card = el.matches(".poke-card") ? el : el.querySelector(".poke-card") || el;
        return card;
      }
    }
    // Fallback: poke-card not inside our team area; top half of viewport
    const cards = visText(".poke-card");
    const above = cards.filter(c => c.getBoundingClientRect().top < innerHeight / 2);
    return above[0] || null;
  }

  function parseMove(el) {
    const name = ($(".move-name", el)?.innerText || el.innerText || "").trim().split("\n")[0];
    const typeBadge = $(".type-badge", el);
    let type = null;
    if (typeBadge) {
      for (const c of typeBadge.classList) {
        const m = /^type-(\w+)$/.exec(c);
        if (m && TYPES.includes(m[1])) { type = m[1]; break; }
      }
    }
    const pwrText = $(".move-power-badge", el)?.innerText || "";
    const pw = pwrText.match(/(\d+)/);
    const power = pw ? parseInt(pw[1], 10) : 50;
    const disabled = el.matches("[disabled], .disabled, [class*=disabled]") || el.getAttribute("aria-disabled") === "true";
    return { el, name, type, power, disabled };
  }

  function pickMove() {
    const enemy = findEnemy();
    const enemyTypes = typesIn(enemy);
    const moves = visText(".poke-move").map(parseMove).filter(m => !m.disabled);
    if (!moves.length) return null;
    const scored = moves.map(m => {
      const e = m.type ? eff(m.type, enemyTypes) : 1;
      // STAB approximation: if our active pokemon shares move type (lookup our card too)
      return { ...m, eff: e, score: (m.power || 40) * (e || 0.1) };
    }).sort((a, b) => b.score - a.score);
    log("battle | enemy:", enemyTypes, "| moves:", scored.map(s => `${s.name}(${s.type},p${s.power},x${s.eff})=${s.score.toFixed(0)}`).join(" | "));
    return scored[0];
  }

  // ---------- Main loop ----------
  let failCount = 0, ticks = 0, battles = 0, lastState = "", lastAction = "";

  function step() {
    if (!cfg.running) return;
    ticks++;
    let acted = false;
    try {
      const state = detectState();
      if (state !== lastState) { log("→ state:", state); lastState = state; updateHud(); }

      switch (state) {
        case "gameover":
        case "victory":
          save("running", false); updateHud();
          log(state === "victory" ? "🏆 Vitória!" : "⛔ Game over.");
          return;

        case "title":
          if (cfg.autoStartRun) {
            // Try resume first, else play
            acted = click(visText(".title-mode-resume--story")[0]) || click(visText(".title-mode-card--story")[0]);
          }
          break;

        case "region-select": {
          // pick classic mode if visible
          const classic = visText(".history-mode-btn--classic.active, .history-mode-btn--classic")[0];
          if (classic && !classic.className.includes("active")) { click(classic); acted = true; break; }
          const region = visText(".history-region-btn").find(r => !r.className.includes("locked"));
          if (region) { acted = click(region); }
          break;
        }

        case "trainer-select":
          acted = click(visText(".trainer-card")[0]);
          break;

        case "starter-select": {
          // Pick the starter with best move power (simple heuristic)
          const cards = visText(".poke-card");
          let best = cards[0], bestScore = -1;
          for (const c of cards) {
            const mv = $(".poke-move", c);
            if (!mv) continue;
            const p = parseMove(mv);
            if (p.power > bestScore) { bestScore = p.power; best = c; }
          }
          acted = click(best);
          break;
        }

        case "battle": {
          const m = pickMove();
          if (m) { acted = click(m.el); lastAction = `move: ${m.name}`; }
          break;
        }

        case "evolution": {
          const opts = visText("[class*=evolution-option], [class*=evolve-option], .poke-card").filter(e => e.querySelector("img"));
          if (opts.length) {
            const idx = cfg.evoPreference === "last" ? opts.length - 1
                     : cfg.evoPreference === "random" ? Math.floor(Math.random() * opts.length) : 0;
            acted = click(opts[idx]);
          } else {
            acted = click(findByText("button", /accept|evolve|confirm|yes/i));
          }
          break;
        }

        case "map": {
          // Click first available map node
          const nodes = visText("[class*=map-node]:not([class*=locked]):not([class*=disabled]):not([class*=cleared]), [class*=encounter]:not([class*=locked])");
          acted = click(nodes[0]);
          break;
        }

        default: {
          // Generic: continue/next/ok/confirm/skip/accept buttons — but NEVER side-menu, dex, settings
          const safe = visText("button, [role=button]").filter(b => {
            const cls = b.className || "";
            if (/run-menu|dex-|nav-|btn-icon-close|history-select-logo|run-menu-link|title-footer/.test(cls)) return false;
            const t = (b.innerText || "").trim();
            return /^(continue|next|ok|confirm|accept|skip|start|begin|fight|reward|claim|done|finish)$/i.test(t);
          });
          acted = click(safe[0]);
          // If still nothing, try a primary action button at the bottom that isn't menu
          if (!acted) {
            const primaries = visText(".btn-primary").filter(b => {
              const cls = b.className || "";
              return !/run-menu|dex-|nav-|btn-icon-close|run-menu-link|title-footer|history-mode-btn|history-region-btn/.test(cls)
                  && (b.innerText || "").trim().length > 0
                  && (b.innerText || "").trim().length < 30;
            });
            // Only auto-click if there's exactly one obvious primary
            if (primaries.length === 1) acted = click(primaries[0]);
          }
        }
      }

      if (acted) {
        failCount = 0;
        if (state === "map" || lastAction.startsWith("move")) battles++;
      } else {
        failCount++;
        if (failCount === 6) {
          log("⚠ 6 ticks sem ação. Estado:", state, "| botões visíveis:",
            visText("button").slice(0, 12).map(b => (b.innerText || "").trim().slice(0, 30)));
        }
        if (failCount >= 20) {
          save("running", false); updateHud();
          log("⏸ Parado: 20 ticks ociosos. Cole os logs para ajustar seletores.");
          return;
        }
      }
    } catch (e) { console.error("[PokelikeAI]", e); failCount++; }
    updateHudStats();
    setTimeout(step, cfg.speedMs);
  }

  // ---------- HUD ----------
  let hud, statsEl;
  function buildHud() {
    if (document.getElementById("pokelike-ai-hud")) return;
    hud = document.createElement("div");
    hud.id = "pokelike-ai-hud";
    hud.style.cssText = "position:fixed;z-index:2147483647;bottom:14px;right:14px;background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif;border:1px solid #22c55e;border-radius:12px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.6);min-width:260px;user-select:none";
    document.body.appendChild(hud);
    renderHud();
  }
  function renderHud() {
    if (!hud) return;
    hud.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span id="pai-led" style="width:10px;height:10px;border-radius:50%;background:${cfg.running?"#22c55e":"#ef4444"};box-shadow:0 0 8px ${cfg.running?"#22c55e":"#ef4444"}"></span>
        <strong style="flex:1">Pokelike Auto-Player</strong>
        <span style="font-size:11px;opacity:.6">v0.4</span>
      </div>
      <button id="pai-toggle" style="width:100%;padding:8px;border:0;border-radius:8px;cursor:pointer;font-weight:700;background:${cfg.running?"#ef4444":"#22c55e"};color:#0f172a">
        ${cfg.running?"⏸ Stop":"▶ Start"}
      </button>
      <div style="margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:12px">
        <label>Speed</label>
        <input id="pai-speed" type="range" min="150" max="2000" step="50" value="${cfg.speedMs}" style="width:100%">
        <label>Evolution</label>
        <select id="pai-evo" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:2px 6px">
          <option value="first" ${cfg.evoPreference==="first"?"selected":""}>First</option>
          <option value="last" ${cfg.evoPreference==="last"?"selected":""}>Last (final form)</option>
          <option value="random" ${cfg.evoPreference==="random"?"selected":""}>Random</option>
        </select>
        <label>Auto start</label>
        <input id="pai-auto" type="checkbox" ${cfg.autoStartRun?"checked":""}>
        <label>Debug</label>
        <input id="pai-debug" type="checkbox" ${cfg.debug?"checked":""}>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="pai-diag" style="flex:1;padding:5px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:11px">🔍 Diagnose</button>
      </div>
      <div id="pai-stats" style="margin-top:8px;font-size:11px;opacity:.75">${cfg.speedMs}ms · state: - · actions: 0</div>
    `;
    statsEl = hud.querySelector("#pai-stats");
    hud.querySelector("#pai-toggle").onclick = () => {
      save("running", !cfg.running); renderHud();
      if (cfg.running) { failCount = 0; setTimeout(step, 100); }
    };
    hud.querySelector("#pai-speed").oninput = e => { save("speedMs", +e.target.value); updateHudStats(); };
    hud.querySelector("#pai-evo").onchange = e => save("evoPreference", e.target.value);
    hud.querySelector("#pai-auto").onchange = e => save("autoStartRun", e.target.checked);
    hud.querySelector("#pai-debug").onchange = e => save("debug", e.target.checked);
    hud.querySelector("#pai-diag").onclick = () => {
      const state = detectState();
      const moves = visText(".poke-move").map(parseMove);
      const enemy = findEnemy();
      console.log("%c[PokelikeAI DIAGNOSE]", "color:#facc15;font-weight:bold", {
        state, url: location.href,
        moves, enemyTypes: typesIn(enemy),
        visibleButtons: visText("button").slice(0,20).map(b => (b.innerText||"").trim().slice(0,40)).filter(Boolean),
        pokeCards: visText(".poke-card").length,
        url2: location.pathname,
      });
      alert("Diagnose logged to console (F12). State: " + state);
    };
  }
  function updateHud() { renderHud(); }
  function updateHudStats() {
    if (!statsEl) return;
    statsEl.textContent = `${cfg.speedMs}ms · state: ${lastState||"-"} · ticks: ${ticks} · battles: ${battles}`;
    const led = hud.querySelector("#pai-led");
    if (led) { led.style.background = cfg.running ? "#22c55e" : "#ef4444"; led.style.boxShadow = `0 0 8px ${cfg.running?"#22c55e":"#ef4444"}`; }
    const tog = hud.querySelector("#pai-toggle");
    if (tog) { tog.textContent = cfg.running ? "⏸ Stop" : "▶ Start"; tog.style.background = cfg.running ? "#ef4444" : "#22c55e"; }
  }

  const boot = () => {
    buildHud();
    if (cfg.running) { failCount = 0; setTimeout(step, 500); }
    log("Carregado v0.4. Clique ▶ Start. Use 🔍 Diagnose para debug.");
  };
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);

  // Re-attach HUD if React unmounts body (rare)
  setInterval(() => { if (!document.getElementById("pokelike-ai-hud")) buildHud(); }, 3000);
})();
