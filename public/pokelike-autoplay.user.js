// ==UserScript==
// @name         Pokelike Auto-Player
// @namespace    https://lovable.dev/pokelike-autoplay
// @version      0.2.0
// @description  Auto-plays pokelike.xyz — battles, evolutions, transitions. Heuristic type-chart AI with resilient DOM fallbacks.
// @match        https://pokelike.xyz/*
// @match        https://www.pokelike.xyz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ---------- Config (persisted) ----------
  const G = (k, d) => (typeof GM_getValue === "function" ? GM_getValue(k, d) : JSON.parse(localStorage.getItem("pai_" + k) ?? "null") ?? d);
  const S = (k, v) => { try { typeof GM_setValue === "function" ? GM_setValue(k, v) : localStorage.setItem("pai_" + k, JSON.stringify(v)); } catch (_) {} };
  const cfg = {
    running: G("running", false),
    speedMs: G("speedMs", 600),
    debug: G("debug", true),
    evoPreference: G("evoPreference", "last"),
    stopOnGameOver: G("stopOnGameOver", true),
    aggressiveClick: G("aggressiveClick", true),
  };
  const save = (k, v) => { cfg[k] = v; S(k, v); };

  const log = (...a) => { if (cfg.debug) console.log("%c[PokelikeAI]", "color:#22c55e;font-weight:bold", ...a); };

  // ---------- Type chart ----------
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
  const eff = (atk, defTypes) => {
    if (!atk || !defTypes?.length) return 1;
    const row = T[atk] || {};
    return defTypes.reduce((m, d) => m * (row[d] ?? 1), 1);
  };

  // ---------- DOM helpers ----------
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.top > innerHeight + 200) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.1 && s.pointerEvents !== "none";
  };
  const clickable = () => $all('button, a, [role="button"], [class*="btn"], [class*="Button"]').filter(visible);
  const byText = (texts, root) => {
    const wanted = (Array.isArray(texts) ? texts : [texts]).map(t => t.toLowerCase().trim());
    return (root ? $all('button,a,[role="button"],div,span', root) : clickable()).filter(el => {
      if (!visible(el)) return false;
      const t = (el.innerText || el.textContent || "").toLowerCase().trim();
      if (!t || t.length > 60) return false;
      return wanted.some(w => t === w || t.split("\n").some(line => line.trim() === w) || (w.length > 3 && t.includes(w)));
    });
  };
  const realClick = (el) => {
    if (!el) return false;
    try {
      el.scrollIntoView({block:"center", behavior:"instant"});
      const r = el.getBoundingClientRect();
      const x = r.left + r.width/2, y = r.top + r.height/2;
      const opts = {bubbles:true, cancelable:true, composed:true, clientX:x, clientY:y, button:0, view:window};
      el.dispatchEvent(new PointerEvent("pointerdown", {...opts, pointerType:"mouse"}));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", {...opts, pointerType:"mouse"}));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      el.click?.();
      return true;
    } catch(e) { console.warn("[PokelikeAI] click failed", e); return false; }
  };
  const clickFirst = (texts) => {
    const els = byText(texts);
    if (els.length) { log("→ click:", texts[0] || texts, els[0].innerText?.slice(0,30)); return realClick(els[0]); }
    return false;
  };
  const pageText = () => (document.body.innerText || "").toLowerCase();

  // ---------- State detection ----------
  function detectState() {
    const txt = pageText();
    if (/you are the\s*champion/i.test(txt)) return "victory";
    if (/game over/i.test(txt) && byText(["play again", "main menu"]).length) return "gameover";
    if (/choose its evolution/i.test(txt)) return "evolution";
    if (/choose your order/i.test(txt) || byText(["fight!"]).length) return "order";
    if (/wild battle/i.test(txt)) return "battle-intro";
    if (byText(["keep team as-is", "decline", "accept"]).length) return "offer";
    if (byText(["next map", "next map →"]).length) return "transition";
    if (byText(["continue"]).length) return "transition";
    if (byText(["skip", "skip (flee)"]).length && !looksLikeBattle()) return "transition";
    if (looksLikeBattle()) return "battle";
    if (byText(["enter", "play story", "resume story"]).length) return "menu";
    return "idle";
  }
  function looksLikeBattle() {
    // Battle UI: usually shows HP bars, 4 move buttons, "Skip" button, your team vs enemy
    const hasHP = /\bhp\b/i.test(document.body.innerText) || $all("[class*=hp i], [class*=health i]").some(visible);
    const moves = findMoveButtons();
    return hasHP && moves.length >= 2;
  }

  // ---------- Battle parsing ----------
  function findMoveButtons() {
    // Heuristic: find a horizontal/grid group of 2-4 small buttons near the bottom containing type words or short attack names
    const btns = clickable().filter(el => {
      const t = (el.innerText || "").trim();
      if (!t || t.length > 40) return false;
      if (/^(skip|fight|continue|next|back|main menu|play again|accept|decline|share|🗼|📤|🏛️)/i.test(t)) return false;
      return true;
    });
    // Score: contains a type name, or appears in bottom half, or has short title-cased first line
    const scored = btns.map(el => {
      const t = (el.innerText || "").toLowerCase();
      const r = el.getBoundingClientRect();
      let s = 0;
      if (TYPES.some(tp => new RegExp(`\\b${tp}\\b`).test(t))) s += 3;
      if (/\bpower\b|\bpp\b/.test(t)) s += 2;
      if (r.top > innerHeight * 0.5) s += 1;
      const first = (el.innerText || "").split("\n")[0].trim();
      if (/^[A-Z][a-zA-Z' -]{2,20}$/.test(first)) s += 1;
      return {el, s, t};
    }).filter(x => x.s > 0);
    // Group siblings: take the 4 highest-scored siblings under a common parent
    if (scored.length >= 2) {
      const byParent = new Map();
      for (const x of scored) {
        const p = x.el.parentElement;
        if (!p) continue;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(x);
      }
      let best = [];
      for (const arr of byParent.values()) if (arr.length > best.length) best = arr;
      if (best.length >= 2) return best.sort((a,b)=>b.s-a.s).slice(0,6).map(x=>x.el);
    }
    return scored.slice(0, 4).map(x => x.el);
  }

  function extractMove(el) {
    const raw = el.innerText || "";
    const lower = raw.toLowerCase();
    let type = null;
    for (const tp of TYPES) if (new RegExp(`\\b${tp}\\b`).test(lower)) { type = tp; break; }
    const pw = lower.match(/power[:\s]*([0-9]+)/);
    const power = pw ? parseInt(pw[1], 10) : 60;
    const acc = lower.match(/acc(?:uracy)?[:\s]*([0-9]+)/);
    const accuracy = acc ? parseInt(acc[1], 10) / 100 : 1;
    return {type, power, accuracy, name: raw.split("\n")[0].trim()};
  }

  function readEnemyTypes() {
    // Find element/section labeled "Enemy" and scan its descendants for type words
    const labels = $all("body *").filter(el => {
      if (!visible(el)) return false;
      const t = (el.textContent || "").trim().toLowerCase();
      return t === "enemy" || t === "opponent";
    });
    let scope = labels[0]?.parentElement || labels[0]?.closest("section,div") || null;
    // Walk up a couple levels to capture the panel
    if (scope) for (let i = 0; i < 2 && scope.parentElement; i++) scope = scope.parentElement;
    const txt = (scope?.innerText || document.body.innerText || "").toLowerCase();
    const found = new Set();
    for (const tp of TYPES) if (new RegExp(`\\b${tp}\\b`).test(txt)) found.add(tp);
    // If we found too many (whole page), restrict
    if (found.size > 3 && scope === document.body) return [];
    return [...found].slice(0, 2);
  }

  function pickMove(moves, enemyTypes) {
    const scored = moves.map(el => {
      const m = extractMove(el);
      const e = m.type ? eff(m.type, enemyTypes) : 1;
      const score = m.power * (e || 0.1) * m.accuracy;
      return {el, m, e, score};
    }).sort((a,b)=>b.score-a.score);
    return scored;
  }

  // ---------- Loop ----------
  let failCount = 0, ticks = 0, battlesWon = 0, lastState = "";
  function step() {
    if (!cfg.running) return;
    ticks++;
    let acted = false;
    try {
      const state = detectState();
      if (state !== lastState) { log("state:", state); lastState = state; updateHud(); }

      switch (state) {
        case "victory":
          save("running", false); updateHud(); log("🏆 Champion!");
          return;
        case "gameover":
          if (cfg.stopOnGameOver) { save("running", false); updateHud(); log("⛔ Game Over — parado."); return; }
          acted = clickFirst(["play again"]);
          break;
        case "menu":
          acted = clickFirst(["resume story"]) || clickFirst(["play story"]) || clickFirst(["enter"]);
          break;
        case "order":
          acted = clickFirst(["fight!"]) || clickFirst(["fight"]);
          break;
        case "evolution": {
          const opts = clickable().filter(el => el.querySelector("img") && (el.innerText||"").length < 40);
          if (opts.length) {
            const pick = cfg.evoPreference === "last" ? opts[opts.length-1]
                       : cfg.evoPreference === "random" ? opts[Math.floor(Math.random()*opts.length)]
                       : opts[0];
            acted = realClick(pick); log("evolve:", pick.innerText?.slice(0,20));
          }
          break;
        }
        case "battle-intro":
          acted = clickFirst(["continue"]) || clickFirst(["skip"]);
          break;
        case "battle": {
          const moves = findMoveButtons();
          const enemyTypes = readEnemyTypes();
          if (moves.length) {
            const scored = pickMove(moves, enemyTypes);
            log("battle:", {enemyTypes, options: scored.map(s=>({n:s.m.name,t:s.m.type,p:s.m.power,e:s.e,s:s.score.toFixed(1)}))});
            acted = realClick(scored[0].el);
            if (acted) battlesWon += 0; // we'll count via transitions
          } else {
            acted = clickFirst(["fight"]) || clickFirst(["continue"]);
          }
          break;
        }
        case "offer":
          acted = clickFirst(["accept"]) || clickFirst(["keep team as-is"]) || clickFirst(["decline"]);
          break;
        case "transition":
          if (clickFirst(["continue"])) { acted = true; }
          else if (clickFirst(["next map"])) { acted = true; battlesWon++; updateHud(); }
          else if (clickFirst(["skip"])) acted = true;
          break;
        default:
          if (cfg.aggressiveClick) {
            // last resort: try common labels
            acted = clickFirst(["continue"]) || clickFirst(["next"]) || clickFirst(["ok"]) || clickFirst(["close"]);
          }
      }

      if (acted) failCount = 0;
      else {
        failCount++;
        if (failCount === 5) log("⚠ 5 ticks sem ação — estado:", state, "| visíveis:", clickable().slice(0,8).map(b=>b.innerText?.slice(0,20)));
        if (failCount >= 12) {
          save("running", false); updateHud();
          log("⏸ Parado: 12 ticks sem encontrar botão. Cole os logs acima para eu ajustar os seletores.");
          return;
        }
      }
    } catch (e) {
      console.error("[PokelikeAI] step error:", e);
      failCount++;
    }
    setTimeout(step, cfg.speedMs);
  }

  // ---------- HUD ----------
  let hud;
  function buildHud() {
    hud = document.createElement("div");
    hud.id = "pokelike-ai-hud";
    hud.style.cssText = `position:fixed;z-index:2147483647;bottom:16px;right:16px;background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,-apple-system,sans-serif;border:1px solid #22c55e;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.5);min-width:250px;user-select:none`;
    document.body.appendChild(hud);
    updateHud();
  }
  function updateHud() {
    if (!hud) return;
    hud.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="width:10px;height:10px;border-radius:50%;background:${cfg.running?"#22c55e":"#ef4444"};box-shadow:0 0 8px ${cfg.running?"#22c55e":"#ef4444"}"></span>
        <strong style="flex:1">Pokelike Auto-Player</strong>
        <span style="font-size:11px;opacity:.6">v0.2</span>
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
          <option value="last" ${cfg.evoPreference==="last"?"selected":""}>Last (final form)</option>
          <option value="random" ${cfg.evoPreference==="random"?"selected":""}>Random</option>
        </select>
        <label>Debug</label>
        <input id="pai-debug" type="checkbox" ${cfg.debug?"checked":""}>
        <label>Stop on death</label>
        <input id="pai-stop" type="checkbox" ${cfg.stopOnGameOver?"checked":""}>
      </div>
      <div style="margin-top:8px;font-size:11px;opacity:.7">${cfg.speedMs}ms · maps: ${battlesWon} · state: ${lastState||"-"}</div>
    `;
    hud.querySelector("#pai-toggle").onclick = () => {
      save("running", !cfg.running); updateHud();
      if (cfg.running) { failCount = 0; step(); }
    };
    hud.querySelector("#pai-speed").oninput = (e) => { save("speedMs", +e.target.value); };
    hud.querySelector("#pai-evo").onchange = (e) => save("evoPreference", e.target.value);
    hud.querySelector("#pai-debug").onchange = (e) => save("debug", e.target.checked);
    hud.querySelector("#pai-stop").onchange = (e) => save("stopOnGameOver", e.target.checked);
  }

  const boot = () => {
    buildHud();
    if (cfg.running) { failCount = 0; step(); }
    log("Carregado. Clique ▶ Start no HUD.");
  };
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
