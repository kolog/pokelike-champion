// ==UserScript==
// @name         Pokelike Auto-Player
// @namespace    https://lovable.dev/pokelike-autoplay
// @version      0.1.0
// @description  Auto-plays pokelike.xyz — battles, evolutions, transitions. Heuristic type-chart AI. Use at your own risk.
// @match        https://pokelike.xyz/*
// @match        https://www.pokelike.xyz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ---------- Config (persisted) ----------
  const cfg = {
    running: GM_getValue("running", false),
    speedMs: GM_getValue("speedMs", 700),
    debug: GM_getValue("debug", true),
    evoPreference: GM_getValue("evoPreference", "first"), // 'first' | 'last' | 'random'
    stopOnGameOver: GM_getValue("stopOnGameOver", true),
  };
  const save = (k, v) => { cfg[k] = v; GM_setValue(k, v); };

  const log = (...a) => { if (cfg.debug) console.log("%c[PokelikeAI]", "color:#22c55e;font-weight:bold", ...a); };

  // ---------- Pokémon type chart ----------
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
  const eff = (atk, defTypes) => {
    if (!atk || !defTypes?.length) return 1;
    const row = T[atk.toLowerCase()] || {};
    return defTypes.reduce((m, d) => m * (row[d.toLowerCase()] ?? 1), 1);
  };

  // ---------- DOM helpers ----------
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const byText = (texts, root = document) => {
    const wanted = (Array.isArray(texts) ? texts : [texts]).map(t => t.toLowerCase().trim());
    return $all("button, a, div[role=button], span[role=button]", root).filter(el => {
      if (!visible(el)) return false;
      const t = (el.innerText || el.textContent || "").toLowerCase().trim();
      return wanted.some(w => t === w || t.includes(w));
    });
  };
  const clickFirst = (texts) => {
    const els = byText(texts);
    if (els.length) { els[0].click(); log("click:", texts, els[0]); return true; }
    return false;
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------- Game state detection ----------
  function detectState() {
    const body = document.body.innerText.toLowerCase();
    if (/game over/.test(body) && visible([...document.querySelectorAll("*")].find(e => /game over/i.test(e.textContent||"")))) return "gameover";
    if (/you are the\s*champion/.test(body)) return "victory";
    if (/choose your order/.test(body)) return "order";
    if (/choose its evolution/.test(body)) return "evolution";
    if (/wild battle/.test(body) || byText(["fight","fight!"]).length) return "battle";
    if (byText(["continue"]).length || byText(["next map"]).length) return "transition";
    if (byText(["skip"]).length) return "transition";
    if (byText(["keep team as-is","decline","accept"]).length) return "offer";
    return "idle";
  }

  // ---------- Battle decision (best-effort) ----------
  function parseBattle() {
    // Look for move buttons. Pokelike usually shows 4 move buttons during FIGHT.
    // We pick any clickable element whose text looks like a move name (1-3 words, no punctuation, with possibly a type label nearby).
    const candidates = $all("button, div[role=button]").filter(visible).filter(el => {
      const t = (el.innerText||"").trim();
      if (!t || t.length > 30) return false;
      if (/^(fight|skip|continue|next|back|main menu|play again|accept|decline|share)/i.test(t)) return false;
      // Move buttons usually contain type info or power numbers
      return /\b(power|pp|type)\b/i.test(t) || /[A-Z][a-z]/.test(t.split("\n")[0]||"");
    });
    return candidates;
  }

  function scoreMove(el, enemyTypes) {
    const t = (el.innerText || "").toLowerCase();
    // try to extract power
    const pwMatch = t.match(/power[:\s]*([0-9]+)/);
    const power = pwMatch ? parseInt(pwMatch[1], 10) : 50;
    // try to extract type
    let moveType = null;
    for (const tp of Object.keys(T)) {
      if (new RegExp(`\\b${tp}\\b`).test(t)) { moveType = tp; break; }
    }
    const e = moveType ? eff(moveType, enemyTypes) : 1;
    return power * e;
  }

  function readEnemyTypes() {
    // Look for any element whose text matches a known type, near "Enemy" header
    const all = $all("body *").filter(visible);
    const enemyArea = all.find(el => /enemy/i.test(el.textContent || "") && el.children.length < 50);
    const types = new Set();
    const scope = enemyArea || document.body;
    const txt = (scope.innerText || "").toLowerCase();
    for (const tp of Object.keys(T)) {
      if (new RegExp(`\\b${tp}\\b`).test(txt)) types.add(tp);
    }
    return [...types].slice(0, 2);
  }

  // ---------- Failure tracking ----------
  let failCount = 0;
  function step() {
    if (!cfg.running) return;
    try {
      const state = detectState();
      log("state:", state);
      let acted = false;

      switch (state) {
        case "gameover":
          if (cfg.stopOnGameOver) { save("running", false); render(); log("Stopped (game over)."); return; }
          acted = clickFirst(["play again"]);
          break;
        case "victory":
          save("running", false); render(); log("🏆 Champion! Stopped.");
          return;
        case "order":
          acted = clickFirst(["fight!", "fight"]);
          break;
        case "evolution": {
          const opts = byText(["a","b","c"]).concat($all("button,img[alt]").filter(visible));
          const evoBtns = $all("button, div[role=button]").filter(visible).filter(el => /evol|choose/i.test((el.innerText||"")) === false && el.querySelector("img"));
          if (evoBtns.length) {
            const pick = cfg.evoPreference === "last" ? evoBtns[evoBtns.length-1]
                       : cfg.evoPreference === "random" ? evoBtns[Math.floor(Math.random()*evoBtns.length)]
                       : evoBtns[0];
            pick.click(); acted = true; log("evolve pick", pick);
          }
          break;
        }
        case "battle": {
          const enemyTypes = readEnemyTypes();
          const moves = parseBattle();
          if (moves.length) {
            const best = moves.map(m => ({m, s: scoreMove(m, enemyTypes)})).sort((a,b)=>b.s-a.s)[0];
            best.m.click(); acted = true;
            log("attack", { enemyTypes, score: best.s, text: (best.m.innerText||"").slice(0,40) });
          } else {
            acted = clickFirst(["fight", "fight!"]);
          }
          break;
        }
        case "transition":
          acted = clickFirst(["continue"]) || clickFirst(["next map"]) || clickFirst(["skip"]);
          break;
        case "offer":
          // Default: accept items/keep team
          acted = clickFirst(["accept"]) || clickFirst(["keep team as-is"]);
          break;
        default:
          // try generic continue
          acted = clickFirst(["continue"]) || clickFirst(["next"]);
      }

      if (acted) failCount = 0;
      else {
        failCount++;
        if (failCount >= 8) {
          save("running", false); render();
          log("⚠ Stopped — couldn't find a clickable action for 8 ticks. Send the console log to update selectors.");
          return;
        }
      }
    } catch (e) {
      console.error("[PokelikeAI] step error", e);
      failCount++;
    }
    setTimeout(step, cfg.speedMs);
  }

  // ---------- HUD ----------
  let hud;
  function render() {
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "pokelike-ai-hud";
      hud.style.cssText = `
        position:fixed;z-index:2147483647;bottom:16px;right:16px;
        background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif;
        border:1px solid #22c55e;border-radius:12px;padding:12px 14px;
        box-shadow:0 10px 30px rgba(0,0,0,.5);min-width:240px;user-select:none;
      `;
      document.body.appendChild(hud);
    }
    hud.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="width:10px;height:10px;border-radius:50%;background:${cfg.running?"#22c55e":"#ef4444"};box-shadow:0 0 8px ${cfg.running?"#22c55e":"#ef4444"}"></span>
        <strong style="flex:1">Pokelike Auto-Player</strong>
      </div>
      <button id="pai-toggle" style="width:100%;padding:8px;border:0;border-radius:8px;cursor:pointer;font-weight:600;background:${cfg.running?"#ef4444":"#22c55e"};color:#0f172a">
        ${cfg.running?"⏸ Stop":"▶ Start"}
      </button>
      <div style="margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:12px">
        <label>Speed</label>
        <input id="pai-speed" type="range" min="200" max="2500" step="100" value="${cfg.speedMs}" style="width:100%">
        <label>Evolution</label>
        <select id="pai-evo" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:2px 6px">
          <option value="first" ${cfg.evoPreference==="first"?"selected":""}>First</option>
          <option value="last" ${cfg.evoPreference==="last"?"selected":""}>Last</option>
          <option value="random" ${cfg.evoPreference==="random"?"selected":""}>Random</option>
        </select>
        <label>Debug</label>
        <input id="pai-debug" type="checkbox" ${cfg.debug?"checked":""}>
        <label>Stop on death</label>
        <input id="pai-stop" type="checkbox" ${cfg.stopOnGameOver?"checked":""}>
      </div>
      <div style="margin-top:8px;font-size:11px;opacity:.7">Speed: ${cfg.speedMs}ms · Open DevTools for log</div>
    `;
    hud.querySelector("#pai-toggle").onclick = () => {
      save("running", !cfg.running); render();
      if (cfg.running) { failCount = 0; step(); }
    };
    hud.querySelector("#pai-speed").oninput = (e) => save("speedMs", +e.target.value);
    hud.querySelector("#pai-speed").onchange = () => render();
    hud.querySelector("#pai-evo").onchange = (e) => save("evoPreference", e.target.value);
    hud.querySelector("#pai-debug").onchange = (e) => save("debug", e.target.checked);
    hud.querySelector("#pai-stop").onchange = (e) => save("stopOnGameOver", e.target.checked);
  }

  const boot = () => {
    render();
    if (cfg.running) { failCount = 0; step(); }
    log("Pokelike Auto-Player loaded. Click ▶ Start on the HUD.");
  };
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
