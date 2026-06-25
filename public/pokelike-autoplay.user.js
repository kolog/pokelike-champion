// ==UserScript==
// @name         Pokelike Auto-Champion
// @namespace    https://lovable.dev/pokelike-autoplay
// @version      2.1.1
// @description  Autonomous AI agent that plays pokelike.xyz — strategic battle, map routing, memory learning, pokedex farm
// @match        https://pokelike.xyz/*
// @match        https://www.pokelike.xyz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 1: CONFIG & PERSISTÊNCIA
  // ═══════════════════════════════════════════════════════════════════════════

  const GM = {
    get(k, d) {
      try { return typeof GM_getValue === "function" ? GM_getValue(k, d) : (JSON.parse(localStorage.getItem("pac_" + k)) ?? d); }
      catch { return d; }
    },
    set(k, v) {
      try { typeof GM_setValue === "function" ? GM_setValue(k, v) : localStorage.setItem("pac_" + k, JSON.stringify(v)); }
      catch {}
    }
  };

  const DEFAULT_CONFIG = {
    running: false,
    speedMs: 400,
    debug: false,
    evoPreference: "last",
    autoStartRun: true,
    region: "first",
    mode: "normal",

    // AI params
    healThreshold: 0.4,
    avoidWeakNodes: true,
    preferTrades: true,
    preferItemsEarly: true,
    preferHealsLate: true,
    minLevelToAdvance: 3,
    farmEvos: true,

    // Dashboard
    dashboardOpen: true,
    dashboardTab: "overview",
  };

  const cfg = {};
  for (const [k, d] of Object.entries(DEFAULT_CONFIG)) cfg[k] = GM.get(k, d);
  const save = (k, v) => { cfg[k] = v; GM.set(k, v); };

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 2: TYPE CHART & GAME DATA
  // ═══════════════════════════════════════════════════════════════════════════

  const T = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  };
  const TYPES = Object.keys(T);

  const eff = (atk, defTypes) => {
    if (!atk || !defTypes?.length) return 1;
    return defTypes.reduce((m, d) => m * ((T[atk] || {})[d] ?? 1), 1);
  };

  // Counter-types: which types beat a given type
  const COUNTERS = {};
  for (const atk of TYPES) {
    for (const def of TYPES) {
      const e = (T[atk] || {})[def] ?? 1;
      if (e >= 2) {
        if (!COUNTERS[def]) COUNTERS[def] = [];
        COUNTERS[def].push(atk);
      }
    }
  }

  // Starter tier list (research-based)
  const STARTER_TIERS = {
    bulbasaur: { score: 95, reason: "Edges Brock + Misty, best for Normal" },
    ivysaur: { score: 94, reason: "Evo of Bulbasaur" },
    venusaur: { score: 93, reason: "Final evo, grass/poison" },
    squirtle: { score: 88, reason: "Safe pick, tank" },
    wartortle: { score: 87, reason: "Evo of Squirtle" },
    blastoise: { score: 86, reason: "Final evo, water" },
    charmander: { score: 82, reason: "High ceiling but unforgiving" },
    charmeleon: { score: 81, reason: "Evo of Charmander" },
    charizard: { score: 85, reason: "Final evo, fire/flying, meta carry" },
    // Gen 2
    chikorita: { score: 65, reason: "Weak early" },
    cyndaquil: { score: 83, reason: "Good damage dealer" },
    quilava: { score: 82, reason: "Evo of Cyndaquil" },
    typhlosion: { score: 84, reason: "Final evo, fire" },
    totodile: { score: 78, reason: "Solid water type" },
    croconaw: { score: 77, reason: "Evo of Totodile" },
    feraligatr: { score: 80, reason: "Final evo, water" },
    // Common powerful Pokemon
    gengar: { score: 96, reason: "Meta king, ghost/poison" },
    dragonite: { score: 94, reason: "Meta carry, dragon/flying" },
    lapras: { score: 90, reason: "Best tank, water/ice" },
    mamoswine: { score: 88, reason: "Destroys Dragon trainers" },
    alakazam: { score: 85, reason: "High special attack" },
    scizor: { score: 86, reason: "Steel/bug, priority bullet punch" },
    gyarados: { score: 87, reason: "Intimidate + dragon dance" },
    snorlax: { score: 84, reason: "Bulky special wall" },
    aerodactyl: { score: 80, reason: "Fast rocker" },
    golem: { score: 78, reason: "Rock/ground, sturdy" },
  };

  // Items knowledge
  const ITEMS = {
    "lucky egg": { priority: 95, effect: "xp boost", phase: "early" },
    "rocky helmet": { priority: 80, effect: "damage on contact", phase: "mid" },
    "leftovers": { priority: 85, effect: "heal each turn", phase: "any" },
    "choice band": { priority: 70, effect: "attack boost", phase: "mid" },
    "choice specs": { priority: 70, effect: "spatk boost", phase: "mid" },
    "life orb": { priority: 65, effect: "damage boost with recoil", phase: "late" },
    "focus sash": { priority: 60, effect: "survive one hit", phase: "any" },
    "eviolite": { priority: 55, effect: "defense boost for pre-evos", phase: "early" },
    "shell bell": { priority: 50, effect: "heal on damage dealt", phase: "mid" },
    "amulet coin": { priority: 45, effect: "more gold", phase: "early" },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 3: DOM ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

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
      if (r.width < 1 || r.height < 1) return false;
      const tag = el.tagName;
      const isSVG = ["g", "svg", "rect", "circle", "path", "image"].includes(tag);
      if (isSVG) {
        // SVG elements: .click() doesn't work, must use dispatchEvent
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", pointerId: 1 }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", pointerId: 1 }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        return true;
      }
      // DOM elements: .click() first, synthetic events as backup
      el.click();
      try {
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", pointerId: 1 }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", pointerId: 1 }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
      } catch (_) { /* sandbox may lack PointerEvent — .click() above is enough */ }
      return true;
    } catch (e) { return false; }
  };

  const visText = (sel) => $$(sel).filter(vis);
  const findByText = (sel, regex) => visText(sel).find(e => regex.test((e.innerText || "").trim()));
  const findAllByText = (sel, regex) => visText(sel).filter(e => regex.test((e.innerText || "").trim()));

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

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 4: STATE DETECTION & PARSING
  // ═══════════════════════════════════════════════════════════════════════════

  function detectState() {
    const bodyText = document.body.innerText || "";

    // ─── TITLE SCREEN ───
    if (visText(".title-mode-card--story").length) return "title";

    // ─── REGION SELECT ───
    if (visText(".history-region-btn").length) return "region-select";

    // ─── TRAINER SELECT ───
    if (visText(".trainer-card").length) return "trainer-select";

    // ─── STARTER SELECT — body text "Choose Your Starter" ───
    if (/Choose Your Starter|Choose your starter/i.test(bodyText)) return "starter-select";

    // ─── BATTLE — has .poke-move buttons AND "ENEMY" text ───
    const moves = visText(".poke-move");
    if (moves.length >= 1 && /ENEMY/i.test(bodyText)) return "battle";

    // ─── POST-BATTLE — "ENEMY" text + CONTINUE button, no poke-moves ───
    if (/ENEMY/i.test(bodyText) && moves.length === 0) {
      const btns = [...document.querySelectorAll("button")].filter(vis);
      if (btns.some(b => /CONTINUE/i.test((b.innerText || "").trim()))) return "post-battle";
    }

    // ─── GAME OVER — .gameover-title visible ───
    const go = document.querySelector(".gameover-title");
    if (go && go.getBoundingClientRect().width > 10 && vis(go)) return "gameover";

    // ─── VICTORY — .win-title visible ───
    const w = document.querySelector(".win-title");
    if (w && w.getBoundingClientRect().width > 10 && vis(w)) return "victory";

    // ─── TRADE OFFER ───
    if (/Trade Offer|Trade one of your/i.test(bodyText) && /DECLINE/i.test(bodyText)) return "trade-offer";

    // ─── BADGE EARNED ───
    if (/Badge Earned|earned the.*Badge/i.test(bodyText) && /NEXT MAP/i.test(bodyText)) return "badge-earned";

    // ─── MAP — .map-node--clickable exists AND has actual visible dimensions ───
    if (document.querySelector(".map-node--clickable")) {
      // Check if any clickable node is actually visible (not hidden behind overlays)
      const firstClickable = document.querySelector(".map-node--clickable");
      if (firstClickable) {
        const r = firstClickable.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) return "map";
      }
    }

    // ─── TEAM FULL ───
    if (/Team Full|Choose.*release/i.test(bodyText)) return "team-full";

    // ─── MOVE TUTOR ───
    if (/Move Tutor|Teach one/i.test(bodyText)) return "move-tutor";

    // ─── ITEM SELECT / REWARD ───
    if (/Item Found|Choose one item/i.test(bodyText)) return "item-select";

    // ─── EVOLUTION ───
    if (/evolv|evolution/i.test(bodyText)) {
      const btns = [...document.querySelectorAll("button")].filter(vis);
      if (btns.length) return "evolution";
    }

    // ─── SHOP ───
    if (visText(".shop-item, .shop-card").length) return "shop";

    // ─── HEAL ───
    if (visText(".heal-node, .pokemon-center").length) return "heal";

    // ─── TRADE ───
    if (visText(".trade-node, .trade-card").length) return "trade";

    // ─── POKEDEX PANEL OPEN (blocks map) ───
    const dexClose = document.querySelector(".btn-icon-close");
    if (dexClose && vis(dexClose) && document.querySelector(".dex-tab.active")) return "pokedex-open";

    // ─── DISMISS OVERLAY ───
    if (/Click anywhere to dismiss/i.test(bodyText)) return "dismiss";

    // ─── SKIP AVAILABLE ───
    const skipBtns = [...document.querySelectorAll("button")].filter(vis).filter(b => /SKIP|FLEE/i.test((b.innerText || "").trim()));
    if (skipBtns.length) return "has-skip";

    // ─── GENERIC ACTION BUTTON ───
    const actionBtns = [...document.querySelectorAll("button")].filter(vis).filter(b => {
      const cls = b.className || "";
      if (/run-menu|dex-|nav-|btn-icon|history-select|title-footer|title-mode/.test(cls)) return false;
      const t = (b.innerText || "").trim();
      return t.length > 0 && t.length < 30 && /CONTINUE|NEXT|OK|DONE|CLAIM|COLLECT|PROCEED|CONFIRM|ACCEPT|HEAL|FIGHT|NEXT MAP/i.test(t);
    });
    if (actionBtns.length) return "generic-button";

    return "idle";
  }

  // Parse battle state
  function findEnemy() {
    // Game uses "ENEMY" text label, not CSS class. Find poke-card in upper half of screen.
    const cards = visText(".poke-card");
    const above = cards.filter(c => c.getBoundingClientRect().top < innerHeight / 2);
    if (above.length) return above[0];
    // Fallback: any enemy-related selector
    const sels = [".enemy", ".opponent", ".foe", "[class*=enemy]", "[class*=opponent]"];
    for (const s of sels) {
      const el = visText(s)[0];
      if (el) return el.matches(".poke-card") ? el : el.querySelector(".poke-card") || el;
    }
    return null;
  }

  function findAlly() {
    const cards = visText(".poke-card");
    const below = cards.filter(c => c.getBoundingClientRect().top >= innerHeight / 2);
    return below[0] || cards[cards.length - 1] || null;
  }

  function parseHP(el) {
    if (!el) return { hp: 100, maxHp: 100, ratio: 1 };
    // Try to find HP text like "45/100" or "45%"
    const text = el.innerText || "";
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const hp = parseInt(match[1], 10);
      const maxHp = parseInt(match[2], 10);
      return { hp, maxHp, ratio: maxHp > 0 ? hp / maxHp : 1 };
    }
    const pctMatch = text.match(/(\d+)\s*%/);
    if (pctMatch) {
      const ratio = parseInt(pctMatch[1], 10) / 100;
      return { hp: Math.round(ratio * 100), maxHp: 100, ratio };
    }
    // Try HP bar width
    const bar = el.querySelector("[class*=hp-bar], [class*=health-bar], .hp-fill, [class*=hp-fill]");
    if (bar) {
      const width = parseFloat(bar.style.width) || 100;
      return { hp: Math.round(width), maxHp: 100, ratio: width / 100 };
    }
    return { hp: 100, maxHp: 100, ratio: 1 };
  }

  function parseLevel(el) {
    if (!el) return 1;
    const text = el.innerText || "";
    const match = text.match(/[Ll](?:vl|evel)?\.?\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
    const numMatch = text.match(/(\d+)/);
    return numMatch ? parseInt(numMatch[1], 10) : 1;
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

    // Try to read accuracy
    const accText = $(".move-accuracy-badge", el)?.innerText || "";
    const accMatch = accText.match(/(\d+)/);
    const accuracy = accMatch ? parseInt(accMatch[1], 10) : 100;

    return { el, name, type, power, accuracy, disabled };
  }

  function parseBattleState() {
    const enemy = findEnemy();
    const ally = findAlly();
    const enemyTypes = typesIn(enemy);
    const allyTypes = typesIn(ally);
    const enemyHP = parseHP(enemy);
    const allyHP = parseHP(ally);
    const enemyLevel = parseLevel(enemy);
    const allyLevel = parseLevel(ally);
    const moves = visText(".poke-move").map(parseMove);

    return { enemy, ally, enemyTypes, allyTypes, enemyHP, allyHP, enemyLevel, allyLevel, moves };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 5: AI ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Battle AI ──
  function pickMove(state) {
    const { enemyTypes, allyTypes, allyHP, enemyHP, moves } = state;
    const available = moves.filter(m => !m.disabled);
    if (!available.length) return null;

    const hpRatio = allyHP.ratio;

    const scored = available.map(m => {
      let score = 0;

      // 1. Effectiveness (40%)
      const effectiveness = m.type ? eff(m.type, enemyTypes) : 1;
      score += effectiveness * 40;

      // 2. Power normalized (25%)
      score += (Math.min(m.power, 150) / 150) * 25;

      // 3. STAB (15%)
      if (m.type && allyTypes.includes(m.type)) score += 15;

      // 4. Accuracy (10%)
      score += ((m.accuracy || 100) / 100) * 10;

      // 5. HP urgency (10%)
      if (hpRatio < 0.3) {
        // Low HP: prioritize high power to kill fast
        score += (Math.min(m.power, 150) / 150) * 10;
      } else if (hpRatio < 0.5) {
        // Medium HP: balance
        score += 5;
      } else {
        score += 5;
      }

      // Penalty: immune
      if (effectiveness === 0) score = 0;

      // Bonus: super effective
      if (effectiveness >= 2) score += 10;

      return { ...m, eff: effectiveness, score };
    }).sort((a, b) => b.score - a.score);

    log("battle", `enemy: [${enemyTypes}] | best: ${scored[0].name}(${scored[0].type},p${scored[0].power},x${scored[0].eff}) = ${scored[0].score.toFixed(0)}`);
    return scored[0];
  }

  // ── Map AI ──
  function evaluateNode(node, ctx) {
    const { hpRatio, runPhase, gold, hasLuckyEgg, missingEvos, pokedexMissing } = ctx;
    const cls = (node.className || "").toLowerCase();
    const text = (node.innerText || "").toLowerCase();

    let score = 50;
    let type = "unknown";

    // Detect node type
    if (/heal|cura|recover|pokemon-center/i.test(cls + text)) type = "heal";
    else if (/shop|loja|buy|store/i.test(cls + text)) type = "shop";
    else if (/trade|troca|swap/i.test(cls + text)) type = "trade";
    else if (/item|reward|loot|prize/i.test(cls + text)) type = "item";
    else if (/catch|captura|pokeball|encounter/i.test(cls + text)) type = "catch";
    else if (/evol/i.test(cls + text)) type = "evolution";
    else if (/boss|leader|gym|elite|champion/i.test(cls + text)) type = "boss";
    else if (/trainer|battle|fight/i.test(cls + text)) type = "trainer";
    else if (/mystery|event|question|\?/i.test(cls + text)) type = "mystery";
    else if (/rest|camp|safe/i.test(cls + text)) type = "rest";

    // Is it locked/disabled/cleared?
    if (/locked|disabled|cleared|completed/i.test(cls)) return { score: -1, type };

    switch (type) {
      case "heal":
        if (hpRatio < 0.3) score = 95;
        else if (hpRatio < 0.5) score = 85;
        else if (hpRatio < 0.8) score = 50;
        else score = 20;
        if (runPhase === "late") score += 10;
        break;

      case "shop":
        if (!hasLuckyEgg && gold >= 100) score = 90;
        else if (gold >= 50) score = 60;
        else score = 30;
        if (runPhase === "early") score += 10;
        break;

      case "trade":
        score = 80; // +3 levels free is always good
        if (runPhase === "mid" || runPhase === "late") score += 15;
        if (cfg.preferTrades) score += 10;
        break;

      case "item":
        if (runPhase === "early") score = 80;
        else if (runPhase === "mid") score = 65;
        else score = 50;
        break;

      case "catch":
        if (pokedexMissing && pokedexMissing.length > 0) {
          score = 85; // always good for pokedex
        } else {
          score = 40;
        }
        break;

      case "evolution":
        score = 75;
        if (missingEvos && missingEvos.length > 0) score += 10;
        break;

      case "trainer":
        score = 65; // good XP
        if (hpRatio > 0.6) score += 10;
        else score -= 10;
        break;

      case "boss":
        if (hpRatio > 0.7) score = 70;
        else score = 20; // don't fight boss weak
        break;

      case "mystery":
        score = 55; // unpredictable
        break;

      case "rest":
        if (hpRatio < 0.6) score = 70;
        else score = 35;
        break;

      default:
        score = 45;
    }

    return { score, type };
  }

  function pickMapNode() {
    // Use .map-node--clickable for reachable nodes (SVG elements)
    const clickable = document.querySelectorAll(".map-node--clickable");
    if (clickable.length) {
      // Skip move-tutor nodes (they open panels, not battles)
      // Prefer: trainer > battle > grass > pokeball > item > anything else
      const PRIORITY = ["trainer", "bug-catcher", "hiker", "battle", "grass", "wild", "pokeball", "item", "mystery"];
      let best = null;
      let bestScore = -1;
      for (const node of clickable) {
        const img = node.querySelector("image");
        const href = img ? (img.getAttribute("href") || "") : "";
        const name = href.split("/").pop().replace(".png", "").replace(".svg", "");
        // Skip move-tutor and trade nodes (they open panels)
        if (/move-tutor|trade/i.test(name)) continue;
        let score = 0;
        for (let i = 0; i < PRIORITY.length; i++) {
          if (name.includes(PRIORITY[i])) { score = PRIORITY.length - i; break; }
        }
        if (score > bestScore) { bestScore = score; best = node; }
      }
      if (best) return best;
      // Fallback: first clickable that isn't move-tutor
      for (const node of clickable) {
        const img = node.querySelector("image");
        const href = img ? (img.getAttribute("href") || "") : "";
        if (!/move-tutor|trade/i.test(href)) return node;
      }
      // Last resort: any clickable
      return clickable[0];
    }
    // Fallback: any visible map node
    const all = document.querySelectorAll(".map-node");
    for (const n of all) {
      if (vis(n)) return n;
    }
    return null;
  }

  // ── Starter AI ──
  function pickStarter() {
    const cards = visText(".poke-card");
    if (!cards.length) return null;

    const scored = cards.map(c => {
      const text = (c.innerText || "").toLowerCase();
      let bestScore = 30;

      // Check against tier list
      for (const [name, data] of Object.entries(STARTER_TIERS)) {
        if (text.includes(name)) {
          bestScore = Math.max(bestScore, data.score);
          break;
        }
      }

      // Check move power
      const mv = $(".poke-move", c);
      if (mv) {
        const p = parseMove(mv);
        const effectiveness = p.type ? eff(p.type, ["normal"]) : 1;
        bestScore += (p.power / 100) * 10;
        if (effectiveness >= 2) bestScore += 5;
      }

      // Check types
      const types = typesIn(c);
      // Bonus for types that cover early gym weaknesses (rock, water)
      for (const t of types) {
        if (t === "grass" || t === "water" || t === "fighting") bestScore += 5;
      }

      return { card: c, score: bestScore };
    }).sort((a, b) => b.score - a.score);

    log("starter", `best: score ${scored[0].score}`);
    return scored[0].card;
  }

  // ── Evolution AI ──
  function pickEvolution() {
    const opts = visText(".evolution-option, .evolve-option, .poke-card").filter(e => e.querySelector("img"));
    if (!opts.length) {
      // Try confirm/accept buttons
      return findByText("button", /accept|evolve|confirm|yes/i);
    }

    if (cfg.evoPreference === "last") return opts[opts.length - 1];
    if (cfg.evoPreference === "random") return opts[Math.floor(Math.random() * opts.length)];
    return opts[0];
  }

  // ── Shop AI ──
  function pickShopItem() {
    const items = visText(".shop-item, .item-card, .shop button, .shop [role=button]");
    if (!items.length) return null;

    const scored = items.map(item => {
      const text = (item.innerText || "").toLowerCase();
      let score = 30;

      for (const [name, data] of Object.entries(ITEMS)) {
        if (text.includes(name)) {
          score = data.priority;
          break;
        }
      }

      // Generic bonuses
      if (/lucky egg|xp/i.test(text)) score = Math.max(score, 90);
      if (/heal|potion|revive|full restore/i.test(text)) score = Math.max(score, 70);
      if (/leftovers/i.test(text)) score = Math.max(score, 80);
      if (/rocky helmet/i.test(text)) score = Math.max(score, 75);

      return { item, score };
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.item;
  }

  // ── Helpers ──
  function getRunPhase() {
    // Try to detect how far we are in the run
    const badges = visText(".badge").length;
    if (badges <= 2) return "early";
    if (badges <= 5) return "mid";
    return "late";
  }

  function parseGold() {
    const el = findByText("[class*=gold], [class*=money], [class*=coin], span, div", /\d+\s*(?:gold|coin|$|Poké|money)/i);
    if (el) {
      const match = (el.innerText || "").match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }
    return 0;
  }

  function checkHasItem(name) {
    const text = document.body.innerText.toLowerCase();
    return text.includes(name.toLowerCase());
  }

  function getMissingPokemon() {
    // Check pokedex data if available
    const data = GM.get("pokedex", { seen: [], caught: [] });
    // Return some common missing ones for now
    return data.missing || [];
  }

  function getMissingEvos() {
    return GM.get("pokedex", { missingEvos: [] }).missingEvos || [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 6: MEMORY & LEARNING
  // ═══════════════════════════════════════════════════════════════════════════

  const memory = {
    getRuns() { return GM.get("runs", []); },
    addRun(run) {
      const runs = this.getRuns();
      runs.push({ ...run, date: new Date().toISOString(), id: `run_${Date.now()}` });
      if (runs.length > 100) runs.splice(0, runs.length - 100);
      GM.set("runs", runs);
    },
    getPatterns() { return GM.get("patterns", { winRate: 0, bestStarters: {}, weakAgainst: [], params: {} }); },
    setPatterns(p) { GM.set("patterns", p); },

    analyzeAndLearn() {
      const runs = this.getRuns();
      if (runs.length < 3) return;

      const wins = runs.filter(r => r.result === "victory");
      const losses = runs.filter(r => r.result === "defeat");
      const winRate = wins.length / runs.length;

      // Best starters
      const starterWins = {};
      for (const r of runs) {
        if (!starterWins[r.starter]) starterWins[r.starter] = { wins: 0, total: 0 };
        starterWins[r.starter].total++;
        if (r.result === "victory") starterWins[r.starter].wins++;
      }

      // Common death causes
      const deathTypes = {};
      for (const r of losses) {
        if (r.deathType) deathTypes[r.deathType] = (deathTypes[r.deathType] || 0) + 1;
      }

      const patterns = {
        winRate,
        bestStarters: starterWins,
        weakAgainst: Object.entries(deathTypes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]),
        totalRuns: runs.length,
        avgBattlesPerWin: wins.length ? (wins.reduce((s, r) => s + (r.battles || 0), 0) / wins.length).toFixed(1) : 0,
      };

      // Auto-adjust params
      if (winRate < 0.4 && runs.length >= 5) {
        save("healThreshold", Math.min(0.65, cfg.healThreshold + 0.05));
        save("minLevelToAdvance", cfg.minLevelToAdvance + 1);
        log("learner", `Low win rate (${(winRate * 100).toFixed(0)}%) — being more conservative`);
      } else if (winRate > 0.75 && runs.length >= 5) {
        save("healThreshold", Math.max(0.25, cfg.healThreshold - 0.03));
        save("minLevelToAdvance", Math.max(2, cfg.minLevelToAdvance - 1));
        log("learner", `High win rate (${(winRate * 100).toFixed(0)}%) — being more aggressive`);
      }

      this.setPatterns(patterns);
      return patterns;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 7: POKEDEX FARM
  // ═══════════════════════════════════════════════════════════════════════════

  const pokedexFarm = {
    getSeen() { return GM.get("pokedex_seen", []); },
    addSeen(name) {
      const seen = this.getSeen();
      if (!seen.includes(name)) { seen.push(name); GM.set("pokedex_seen", seen); }
    },
    getCaught() { return GM.get("pokedex_caught", []); },
    addCaught(name) {
      const caught = this.getCaught();
      if (!caught.includes(name)) { caught.push(name); GM.set("pokedex_caught", caught); }
    },
    getMissing() {
      // All known Pokemon minus caught
      const all = Object.keys(STARTER_TIERS);
      const caught = this.getCaught();
      return all.filter(p => !caught.includes(p));
    },
    shouldPrioritizeCatch() {
      return cfg.mode === "pokedex-farm" && this.getMissing().length > 0;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 8: DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  let dashboard, statsEl, logEl, chartEl;
  const actionLog = [];

  function logAction(state, action) {
    actionLog.push({ state, action, time: new Date().toLocaleTimeString() });
    if (actionLog.length > 50) actionLog.shift();
  }

  function buildDashboard() {
    if (document.getElementById("pac-dashboard")) return;

    dashboard = document.createElement("div");
    dashboard.id = "pac-dashboard";
    dashboard.style.cssText = `
      position:fixed; z-index:2147483647; bottom:14px; right:14px;
      width:360px; max-height:520px;
      background:#0a0e1a; color:#e2e8f0;
      font:12px/1.4 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
      border:1px solid #1e293b; border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,.8), 0 0 40px rgba(34,197,94,.1);
      user-select:none; overflow:hidden;
      display:flex; flex-direction:column;
    `;
    document.body.appendChild(dashboard);
    renderDashboard();
  }

  function renderDashboard() {
    if (!dashboard) return;
    const tab = cfg.dashboardTab;
    const running = cfg.running;
    const runs = memory.getRuns();
    const patterns = memory.getPatterns();
    const wins = runs.filter(r => r.result === "victory").length;
    const losses = runs.filter(r => r.result === "defeat").length;
    const winRate = runs.length ? ((wins / runs.length) * 100).toFixed(0) : "0";

    dashboard.innerHTML = `
      <style>
        .pac-tab { padding:6px 12px; cursor:pointer; border:none; background:transparent; color:#64748b; font:inherit; border-bottom:2px solid transparent; transition:all .2s; }
        .pac-tab:hover { color:#94a3b8; }
        .pac-tab.active { color:#22c55e; border-bottom-color:#22c55e; }
        .pac-stat { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #1e293b; }
        .pac-stat:last-child { border:none; }
        .pac-label { color:#64748b; }
        .pac-value { color:#e2e8f0; font-weight:600; }
        .pac-btn { padding:8px 16px; border:0; border-radius:8px; cursor:pointer; font-weight:700; font:inherit; transition:all .2s; }
        .pac-btn:hover { transform:scale(1.02); }
        .pac-log { max-height:120px; overflow-y:auto; font-size:10px; color:#64748b; padding:4px 8px; background:#060a14; border-radius:8px; }
        .pac-log div { padding:2px 0; border-bottom:1px solid #0f172a; }
        .pac-bar { height:6px; background:#1e293b; border-radius:3px; overflow:hidden; margin-top:4px; }
        .pac-bar-fill { height:100%; border-radius:3px; transition:width .3s; }
        .pac-win { color:#22c55e; } .pac-loss { color:#ef4444; }
      </style>

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #1e293b">
        <div style="width:10px;height:10px;border-radius:50%;background:${running ? "#22c55e" : "#ef4444"};box-shadow:0 0 12px ${running ? "#22c55e" : "#ef4444"};animation:${running ? "pac-pulse 2s infinite" : "none"}"></div>
        <strong style="flex:1;font-size:13px">PAC Auto-Champion</strong>
        <span style="font-size:10px;color:#475569">v2.0</span>
        <button id="pac-minimize" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;padding:0 4px">─</button>
      </div>
      <style>@keyframes pac-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }</style>

      <!-- Tabs -->
      <div style="display:flex;border-bottom:1px solid #1e293b;padding:0 8px">
        <button class="pac-tab ${tab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
        <button class="pac-tab ${tab === "stats" ? "active" : ""}" data-tab="stats">Stats</button>
        <button class="pac-tab ${tab === "runs" ? "active" : ""}" data-tab="runs">Runs</button>
        <button class="pac-tab ${tab === "learning" ? "active" : ""}" data-tab="learning">Learn</button>
        <button class="pac-tab ${tab === "settings" ? "active" : ""}" data-tab="settings">Config</button>
      </div>

      <!-- Content -->
      <div style="padding:12px 16px;flex:1;overflow-y:auto;min-height:200px">
        ${tab === "overview" ? renderOverview(running, runs, wins, losses, winRate, patterns) : ""}
        ${tab === "stats" ? renderStats(runs, patterns) : ""}
        ${tab === "runs" ? renderRuns(runs) : ""}
        ${tab === "learning" ? renderLearning(patterns) : ""}
        ${tab === "settings" ? renderSettings() : ""}
      </div>

      <!-- Footer: Start/Stop -->
      <div style="padding:12px 16px;border-top:1px solid #1e293b">
        <button id="pac-toggle" class="pac-btn" style="width:100%;background:${running ? "#ef4444" : "#22c55e"};color:${running ? "#fff" : "#000"}">
          ${running ? "⏸ STOP" : "▶ START"}
        </button>
      </div>
    `;

    // Event listeners
    dashboard.querySelectorAll(".pac-tab").forEach(t => {
      t.onclick = () => { save("dashboardTab", t.dataset.tab); renderDashboard(); };
    });

    dashboard.querySelector("#pac-toggle")?.addEventListener("click", () => {
      save("running", !cfg.running);
      if (cfg.running) { failCount = 0; setTimeout(step, 100); }
      renderDashboard();
    });

    dashboard.querySelector("#pac-minimize")?.addEventListener("click", () => {
      dashboard.querySelector("[style*='padding:12px 16px;flex:1']").style.display =
        dashboard.querySelector("[style*='padding:12px 16px;flex:1']").style.display === "none" ? "block" : "none";
    });

    // Settings event listeners
    if (tab === "settings") {
      dashboard.querySelector("#pac-speed")?.addEventListener("input", e => { save("speedMs", +e.target.value); });
      dashboard.querySelector("#pac-evo")?.addEventListener("change", e => { save("evoPreference", e.target.value); });
      dashboard.querySelector("#pac-mode")?.addEventListener("change", e => { save("mode", e.target.value); });
      dashboard.querySelector("#pac-debug")?.addEventListener("change", e => { save("debug", e.target.checked); });
      dashboard.querySelector("#pac-auto")?.addEventListener("change", e => { save("autoStartRun", e.target.checked); });
      dashboard.querySelector("#pac-reset")?.addEventListener("click", () => {
        if (confirm("Reset all learning data?")) {
          GM.set("runs", []);
          GM.set("patterns", {});
          GM.set("pokedex_seen", []);
          GM.set("pokedex_caught", []);
          renderDashboard();
        }
      });
    }
  }

  function renderOverview(running, runs, wins, losses, winRate, patterns) {
    const recentRuns = runs.slice(-5);
    return `
      <div class="pac-stat"><span class="pac-label">Status</span><span class="pac-value" style="color:${running ? "#22c55e" : "#ef4444"}">${running ? "RUNNING" : "STOPPED"}</span></div>
      <div class="pac-stat"><span class="pac-label">State</span><span class="pac-value">${lastState || "-"}</span></div>
      <div class="pac-stat"><span class="pac-label">Last Action</span><span class="pac-value" style="font-size:10px">${lastAction || "-"}</span></div>
      <div class="pac-stat"><span class="pac-label">Win Rate</span><span class="pac-value pac-win">${winRate}%</span></div>
      <div class="pac-stat"><span class="pac-label">Runs</span><span class="pac-value">${wins}W / ${losses}L (${runs.length} total)</span></div>
      <div class="pac-stat"><span class="pac-label">Ticks</span><span class="pac-value">${ticks}</span></div>
      <div class="pac-stat"><span class="pac-label">Battles</span><span class="pac-value">${battles}</span></div>
      <div style="margin-top:8px">
        <div class="pac-stat"><span class="pac-label">Win Rate</span></div>
        <div class="pac-bar"><div class="pac-bar-fill" style="width:${winRate}%;background:linear-gradient(90deg,#ef4444,#eab308,#22c55e)"></div></div>
      </div>
      <div style="margin-top:10px;font-size:10px;color:#475569">Recent:</div>
      <div class="pac-log">
        ${recentRuns.length ? recentRuns.map(r => `<div><span class="${r.result === "victory" ? "pac-win" : "pac-loss"}">${r.result === "victory" ? "W" : "L"}</span> ${r.starter || "?"} — ${r.battles || "?"} battles</div>`).join("") : '<div style="color:#475569">No runs yet</div>'}
      </div>
    `;
  }

  function renderStats(runs, patterns) {
    const starterStats = patterns.bestStarters || {};
    const topStarters = Object.entries(starterStats)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))
      .slice(0, 5);

    const avgBattles = runs.length ? (runs.reduce((s, r) => s + (r.battles || 0), 0) / runs.length).toFixed(0) : "0";
    const avgDuration = runs.length ? (runs.reduce((s, r) => s + (r.duration || 0), 0) / runs.length / 1000).toFixed(0) : "0";

    return `
      <div class="pac-stat"><span class="pac-label">Total Runs</span><span class="pac-value">${runs.length}</span></div>
      <div class="pac-stat"><span class="pac-label">Win Rate</span><span class="pac-value pac-win">${patterns.winRate ? (patterns.winRate * 100).toFixed(0) : 0}%</span></div>
      <div class="pac-stat"><span class="pac-label">Avg Battles/Run</span><span class="pac-value">${avgBattles}</span></div>
      <div class="pac-stat"><span class="pac-label">Avg Duration</span><span class="pac-value">${avgDuration}s</span></div>
      <div style="margin-top:10px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Top Starters</div>
      ${topStarters.length ? topStarters.map(([name, s]) => {
        const wr = s.total ? ((s.wins / s.total) * 100).toFixed(0) : "0";
        return `<div class="pac-stat"><span class="pac-label">${name}</span><span class="pac-value">${wr}% (${s.wins}/${s.total})</span></div>`;
      }).join("") : '<div style="color:#475569;font-size:10px">No data yet</div>'}
      <div style="margin-top:10px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Weak Against</div>
      <div style="font-size:10px;color:#ef4444">${patterns.weakAgainst?.length ? patterns.weakAgainst.join(", ") : "No data"}</div>
    `;
  }

  function renderRuns(runs) {
    const recent = runs.slice(-10).reverse();
    return `
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Last 10 Runs</div>
      ${recent.length ? recent.map(r => `
        <div style="padding:6px 8px;background:#060a14;border-radius:8px;margin-bottom:4px">
          <div style="display:flex;justify-content:space-between">
            <span class="${r.result === "victory" ? "pac-win" : "pac-loss"}" style="font-weight:700">${r.result === "victory" ? "VICTORY" : "DEFEAT"}</span>
            <span style="color:#475569;font-size:10px">${new Date(r.date).toLocaleDateString()}</span>
          </div>
          <div style="font-size:10px;color:#94a3b8">Starter: ${r.starter || "?"} | Region: ${r.region || "?"} | Battles: ${r.battles || "?"}</div>
        </div>
      `).join("") : '<div style="color:#475569">No runs recorded</div>'}
    `;
  }

  function renderLearning(patterns) {
    return `
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Learned Patterns</div>
      <div class="pac-stat"><span class="pac-label">Win Rate</span><span class="pac-value">${patterns.winRate ? (patterns.winRate * 100).toFixed(0) + "%" : "No data"}</span></div>
      <div class="pac-stat"><span class="pac-label">Total Runs Analyzed</span><span class="pac-value">${patterns.totalRuns || 0}</span></div>
      <div class="pac-stat"><span class="pac-label">Avg Battles (Wins)</span><span class="pac-value">${patterns.avgBattlesPerWin || "—"}</span></div>
      <div style="margin-top:10px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Current AI Params</div>
      <div class="pac-stat"><span class="pac-label">Heal Threshold</span><span class="pac-value">${(cfg.healThreshold * 100).toFixed(0)}%</span></div>
      <div class="pac-stat"><span class="pac-label">Min Level to Advance</span><span class="pac-value">${cfg.minLevelToAdvance}</span></div>
      <div class="pac-stat"><span class="pac-label">Prefer Trades</span><span class="pac-value">${cfg.preferTrades ? "Yes" : "No"}</span></div>
      <div class="pac-stat"><span class="pac-label">Mode</span><span class="pac-value">${cfg.mode}</span></div>
      <div style="margin-top:10px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Pokedex</div>
      <div class="pac-stat"><span class="pac-label">Seen</span><span class="pac-value">${pokedexFarm.getSeen().length}</span></div>
      <div class="pac-stat"><span class="pac-label">Caught</span><span class="pac-value">${pokedexFarm.getCaught().length}</span></div>
      <div class="pac-stat"><span class="pac-label">Missing</span><span class="pac-value">${pokedexFarm.getMissing().length}</span></div>
    `;
  }

  function renderSettings() {
    return `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;font-size:11px">
        <label style="color:#94a3b8">Speed</label>
        <div><input id="pac-speed" type="range" min="150" max="2000" step="50" value="${cfg.speedMs}" style="width:100%"><span style="color:#64748b;font-size:10px">${cfg.speedMs}ms</span></div>

        <label style="color:#94a3b8">Evolution</label>
        <select id="pac-evo" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font:inherit">
          <option value="first" ${cfg.evoPreference === "first" ? "selected" : ""}>First</option>
          <option value="last" ${cfg.evoPreference === "last" ? "selected" : ""}>Last (final form)</option>
          <option value="random" ${cfg.evoPreference === "random" ? "selected" : ""}>Random</option>
        </select>

        <label style="color:#94a3b8">Mode</label>
        <select id="pac-mode" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font:inherit">
          <option value="normal" ${cfg.mode === "normal" ? "selected" : ""}>Normal (Win)</option>
          <option value="pokedex-farm" ${cfg.mode === "pokedex-farm" ? "selected" : ""}>Pokedex Farm</option>
        </select>

        <label style="color:#94a3b8">Auto Start</label>
        <input id="pac-auto" type="checkbox" ${cfg.autoStartRun ? "checked" : ""}>

        <label style="color:#94a3b8">Debug</label>
        <input id="pac-debug" type="checkbox" ${cfg.debug ? "checked" : ""}>

        <label style="color:#94a3b8">Heal Threshold</label>
        <div style="color:#e2e8f0">${(cfg.healThreshold * 100).toFixed(0)}%</div>

        <label style="color:#94a3b8">Min Level</label>
        <div style="color:#e2e8f0">${cfg.minLevelToAdvance}</div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="pac-reset" style="flex:1;padding:6px;border:1px solid #ef4444;border-radius:6px;background:transparent;color:#ef4444;cursor:pointer;font:inherit;font-size:11px">Reset Learning</button>
      </div>
    `;
  }

  function updateDashboard() {
    if (dashboard) renderDashboard();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 9: ENGINE CORE
  // ═══════════════════════════════════════════════════════════════════════════

  let failCount = 0, ticks = 0, battles = 0, lastState = "", lastAction = "", currentRun = {};

  function log(tag, msg) {
    if (cfg.debug) console.log(`%c[PAC:${tag}]`, "color:#22c55e;font-weight:bold", msg);
    actionLog.push({ tag, msg, time: new Date().toLocaleTimeString() });
    if (actionLog.length > 50) actionLog.shift();
  }

  function step() {
    if (!cfg.running) return;
    ticks++;
    let acted = false;

    try {
      const state = detectState();
      if (state !== lastState) {
        log("state", `→ ${state}`);
        lastState = state;
        updateDashboard();
      }

      switch (state) {
        case "gameover":
          if (currentRun.startTime) {
            currentRun.result = "defeat";
            currentRun.battles = battles;
            currentRun.deathType = lastAction;
            memory.addRun(currentRun);
            memory.analyzeAndLearn();
          }
          save("running", false);
          updateDashboard();
          log("result", "DEFEAT — run saved, learning updated");
          return;

        case "victory":
          if (currentRun.startTime) {
            currentRun.result = "victory";
            currentRun.battles = battles;
            memory.addRun(currentRun);
            memory.analyzeAndLearn();
          }
          save("running", false);
          updateDashboard();
          log("result", "VICTORY — run saved, learning updated");
          return;

        case "title":
          if (cfg.autoStartRun) {
            if (!currentRun.startTime) {
              currentRun = { starter: null, region: cfg.region, startTime: Date.now() };
              battles = 0;
            }
            acted = click(visText(".title-mode-resume--story")[0]) || click(visText(".title-mode-card--story")[0]);
          }
          break;

        case "region-select": {
          const classic = visText(".history-mode-btn--classic.active, .history-mode-btn--classic")[0];
          if (classic && !classic.className.includes("active")) { click(classic); acted = true; break; }
          const region = visText(".history-region-btn").find(r => !r.className.includes("locked"));
          if (region) { acted = click(region); currentRun.region = region.innerText; }
          break;
        }

        case "trainer-select":
          acted = click(visText(".trainer-card")[0]);
          break;

        case "starter-select": {
          const starter = pickStarter();
          if (starter) {
            acted = click(starter);
            currentRun.starter = starter.innerText?.split("\n")[0] || "unknown";
          }
          break;
        }

        case "battle": {
          const state = parseBattleState();
          const m = pickMove(state);
          if (m) { acted = click(m.el); lastAction = `move:${m.name}`; }
          break;
        }

        case "post-battle": {
          const contBtn = [...document.querySelectorAll("button")].filter(vis).find(b => /CONTINUE/i.test((b.innerText || "").trim()));
          if (contBtn) acted = click(contBtn);
          break;
        }

        case "evolution": {
          const evo = pickEvolution();
          if (evo) acted = click(evo);
          break;
        }

        case "trade-offer": {
          // Prefer accept if trade is beneficial, else decline
          const acceptBtn = [...document.querySelectorAll("button")].filter(vis).find(b => /ACCEPT|TRADE|CONFIRM/i.test((b.innerText || "").trim()));
          const declineBtn = [...document.querySelectorAll("button")].filter(vis).find(b => /DECLINE|SKIP|REJECT/i.test((b.innerText || "").trim()));
          if (cfg.preferTrades && acceptBtn) {
            acted = click(acceptBtn);
            lastAction = "trade:accept";
          } else if (declineBtn) {
            acted = click(declineBtn);
            lastAction = "trade:decline";
          }
          break;
        }

        case "badge-earned": {
          const nextBtn = [...document.querySelectorAll("button")].filter(vis).find(b => /NEXT MAP|NEXT|CONTINUE/i.test((b.innerText || "").trim()));
          if (nextBtn) acted = click(nextBtn);
          break;
        }

        case "map": {
          const node = pickMapNode();
          if (node) acted = click(node);
          break;
        }

        case "shop": {
          const item = pickShopItem();
          if (item) { acted = click(item); lastAction = `shop:${item.innerText?.slice(0, 20)}`; }
          else {
            acted = click(findByText("button, [role=button]", /close|continue|done|back|sair/i));
          }
          break;
        }

        case "heal": {
          acted = click(findByText("button, [role=button]", /heal|continue|ok|confirm|aceitar/i));
          if (!acted) acted = click(visText(".btn-primary")[0]);
          break;
        }

        case "trade": {
          acted = click(findByText("button, [role=button]", /accept|confirm|trade|trocar|continue/i));
          if (!acted) acted = click(visText(".btn-primary")[0]);
          break;
        }

        case "item-select": {
          // "Item Found! Choose one item to keep" — prefer upgrade button (→), else first item, else SKIP
          const upgradeBtn = [...document.querySelectorAll("button")].filter(vis).find(b => (b.innerText || "").includes("→"));
          if (upgradeBtn) { acted = click(upgradeBtn); lastAction = "item:upgrade"; break; }
          const itemCards = visText(".poke-card");
          if (itemCards.length) { acted = click(itemCards[0]); lastAction = "item:pick"; break; }
          acted = click(findByText("button", /SKIP/i));
          if (!acted) acted = click(visText(".btn-primary")[0]);
          break;
        }

        case "team-full": {
          // "Team Full! Choose a Pokémon to release" — prefer KEEP TEAM AS-IS
          const keepBtn = [...document.querySelectorAll("button")].filter(vis).find(b => /KEEP TEAM/i.test((b.innerText || "").trim()));
          if (keepBtn) { acted = click(keepBtn); lastAction = "team:keep"; break; }
          acted = click(findByText("button", /SKIP|RELEASE|DECLINE/i));
          break;
        }

        case "move-tutor": {
          // "Move Tutor — Teach one Pokémon a more powerful move" — pick first upgrade or SKIP
          const tutorBtn = [...document.querySelectorAll("button")].filter(vis).find(b => (b.innerText || "").includes("→"));
          if (tutorBtn) { acted = click(tutorBtn); lastAction = "tutor:upgrade"; break; }
          acted = click(findByText("button", /SKIP/i));
          break;
        }

        case "dismiss": {
          document.body.click();
          acted = true;
          break;
        }

        case "pokedex-open": {
          // Close the Pokedex panel that blocks the map
          const closeBtn = document.querySelector(".btn-icon-close");
          if (closeBtn && vis(closeBtn)) {
            closeBtn.click();
            // Also try synthetic events in case .click() doesn't work
            try {
              const r = closeBtn.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
              closeBtn.dispatchEvent(new MouseEvent("click", o));
            } catch (_) {}
            acted = true;
            lastAction = "dex:close";
          }
          break;
        }

        case "has-skip": {
          acted = click(findByText("button", /SKIP|FLEE/i));
          break;
        }

        case "generic-button": {
          acted = click(findByText("button", /CONTINUE|NEXT|OK|DONE|CLAIM|COLLECT|PROCEED|CONFIRM|ACCEPT|HEAL|FIGHT/i));
          break;
        }

        default: {
          // Generic fallback: safe buttons
          const safe = visText("button, [role=button]").filter(b => {
            const cls = b.className || "";
            if (/run-menu|dex-|nav-|btn-icon-close|history-select-logo|run-menu-link|title-footer/.test(cls)) return false;
            const t = (b.innerText || "").trim();
            return /^(continue|next|ok|confirm|accept|skip|start|begin|fight|reward|claim|done|finish|sair|avançar|prosseguir)$/i.test(t);
          });
          acted = click(safe[0]);

          if (!acted) {
            const primaries = visText(".btn-primary").filter(b => {
              const cls = b.className || "";
              return !/run-menu|dex-|nav-|btn-icon-close|run-menu-link|title-footer|history-mode-btn|history-region-btn/.test(cls)
                  && (b.innerText || "").trim().length > 0
                  && (b.innerText || "").trim().length < 30;
            });
            if (primaries.length === 1) acted = click(primaries[0]);
          }
        }
      }

      if (acted) {
        failCount = 0;
        if (state === "map" || lastAction.startsWith("move")) battles++;
      } else {
        failCount++;
        if (failCount === 8) {
          log("warn", `8 ticks without action. State: ${state}`);
        }
        if (failCount >= 25) {
          save("running", false);
          updateDashboard();
          log("stall", "Stopped: 25 ticks idle. Check logs.");
          return;
        }
      }
    } catch (e) {
      console.error("[PAC]", e);
      failCount++;
    }

    updateDashboard();
    setTimeout(step, cfg.speedMs);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMADA 10: BOOT
  // ═══════════════════════════════════════════════════════════════════════════

  const boot = () => {
    buildDashboard();
    if (cfg.running) {
      failCount = 0;
      currentRun = { starter: null, region: cfg.region, startTime: Date.now() };
      setTimeout(step, 500);
    }
    log("boot", `PAC v2.0 loaded. Mode: ${cfg.mode}. Click START to begin.`);
  };

  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);

  // Re-attach dashboard if removed
  setInterval(() => {
    if (!document.getElementById("pac-dashboard")) buildDashboard();
  }, 3000);
})();
