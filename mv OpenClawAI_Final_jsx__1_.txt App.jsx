import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";

// ============================================================
// SAVE POINT: FINAL COMPLETE BUILD — OpenClaw AI v2.0
// Sections 8 (PWA) + 9 (Performance) + 10 (Polish) merged
// ============================================================

// ---- SECTION 1: CONSTANTS & DESIGN SYSTEM ----
const THEME = {
  dark: {
    bg: "#080C10", surface: "#0D1117", surfaceAlt: "#161B22",
    border: "#1E2A35", borderBright: "#2D3F50",
    accent: "#00FFB2", accentDim: "#00FFB218", accentHover: "#00E6A0",
    danger: "#FF4747", warn: "#FFB800",
    text: "#E6EDF3", textDim: "#7D8590", textFaint: "#3D4550",
    glow: "0 0 20px #00FFB240, 0 0 60px #00FFB215",
  },
  light: {
    bg: "#F0F4F8", surface: "#FFFFFF", surfaceAlt: "#E8EEF4",
    border: "#CBD5E0", borderBright: "#A0AEC0",
    accent: "#007A55", accentDim: "#007A5515", accentHover: "#005C3F",
    danger: "#E53E3E", warn: "#D97706",
    text: "#1A202C", textDim: "#4A5568", textFaint: "#A0AEC0",
    glow: "0 0 20px #007A5520",
  }
};

const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Sonnet 4", tier: "Smart", icon: "⚡" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", tier: "Fast", icon: "🚀" },
];

const PERSONAS = [
  { id: "assistant", label: "Assistant", icon: "🤖", prompt: "You are a helpful, accurate, and concise AI assistant. Format responses with markdown where helpful." },
  { id: "coder", label: "Dev Mode", icon: "💻", prompt: "You are an expert software engineer. Give precise, working code. Prefer modern idioms. Be brief but complete." },
  { id: "analyst", label: "Analyst", icon: "📊", prompt: "You are a sharp analytical thinker. Break down problems systematically with structured, data-driven insights." },
  { id: "creative", label: "Creative", icon: "🎨", prompt: "You are a creative writing partner. Think boldly and unconventionally. Use vivid, expressive language." },
  { id: "tutor", label: "Tutor", icon: "📚", prompt: "You are a patient, clear teacher. Explain step by step with examples, adapting to the user's level." },
];

const SUGGESTIONS = [
  "⚡ Explain quantum entanglement simply",
  "💻 Debug my React component",
  "📊 Analyze my business idea",
  "🎨 Write a short sci-fi story",
];

const MAX_INPUT = 8000;
const MAX_CONTEXT = 20;
const RATE_LIMIT = { window: 60000, max: 20 };

// ---- SECTION 2: SECURITY MODULE ----
class Security {
  constructor() {
    this.log = [];
    this.violations = 0;
    this.session = this._initSession();
  }
  _initSession() {
    let id = sessionStorage.getItem("oc_sid");
    if (!id) { id = "oc_" + Date.now() + "_" + Math.random().toString(36).slice(2,9); sessionStorage.setItem("oc_sid", id); }
    return id;
  }
  rateCheck() {
    const now = Date.now();
    this.log = this.log.filter(t => now - t < RATE_LIMIT.window);
    if (this.log.length >= RATE_LIMIT.max) {
      return { ok: false, wait: Math.ceil((RATE_LIMIT.window - (now - this.log[0])) / 1000) };
    }
    this.log.push(now);
    return { ok: true };
  }
  sanitize(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\x00/g,"").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g,"").slice(0, MAX_INPUT);
  }
  injection(s) {
    return [
      /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
      /system\s*:\s*(you are|act as|pretend|forget)/i,
      /\[INST\]|\[SYS\]|<\|im_start\|>/i,
      /jailbreak|DAN mode|developer mode|override safety/i,
      /reveal\s+(your\s+)?(system\s+prompt|instructions)/i,
    ].some(p => p.test(s));
  }
  validKey(k) { return /^sk-ant-[a-zA-Z0-9\-_]{20,}$/.test(k); }
  storeKey(k, persist) {
    if (!this.validKey(k)) return false;
    const enc = btoa(k);
    persist ? localStorage.setItem("oc_ak", enc) : sessionStorage.setItem("oc_ak_s", enc);
    return true;
  }
  getKey() {
    try { return atob(sessionStorage.getItem("oc_ak_s") || localStorage.getItem("oc_ak") || ""); } catch { return ""; }
  }
  clearKey() { sessionStorage.removeItem("oc_ak_s"); localStorage.removeItem("oc_ak"); }
  flag(type, detail) { this.violations++; console.warn(`[OC:Security] ${type} — ${detail?.slice(0,60)}`); }
}
const sec = new Security();

// ---- SECTION 3: MEMORY MANAGER ----
class Memory {
  constructor() { this.convos = this._load(); this.active = null; }
  _load() { try { return JSON.parse(localStorage.getItem("oc_c") || "{}"); } catch { return {}; } }
  _save() {
    try { localStorage.setItem("oc_c", JSON.stringify(this.convos)); }
    catch { const k = Object.keys(this.convos).sort(); if (k.length > 8) { delete this.convos[k[0]]; this._save(); } }
  }
  newConvo(persona = "assistant") {
    const id = "c" + Date.now();
    this.convos[id] = { id, title: "New Conversation", persona, msgs: [], at: Date.now() };
    this.active = id; this._save(); return id;
  }
  get() { return this.convos[this.active] || null; }
  addMsg(role, content, meta = {}) {
    const c = this.get(); if (!c) return null;
    const m = { id: "m" + Date.now(), role, content, ts: Date.now(), ...meta };
    c.msgs.push(m); c.at = Date.now();
    if (c.msgs.length === 1 && role === "user") c.title = content.slice(0,45) + (content.length > 45 ? "…" : "");
    this._save(); return m;
  }
  apiMsgs() {
    const c = this.get(); if (!c) return [];
    return c.msgs.slice(-MAX_CONTEXT).map(m => ({ role: m.role, content: m.content }));
  }
  del(id) { delete this.convos[id]; if (this.active === id) this.active = null; this._save(); }
  list() { return Object.values(this.convos).sort((a,b) => b.at - a.at); }
  clear() { this.convos = {}; this.active = null; localStorage.removeItem("oc_c"); }
}
const mem = new Memory();

// ---- SECTION 4: AI ENGINE ----
async function streamAI({ messages, system, model, key, onChunk, onDone, onError }) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages, stream: true }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); onError(e.error?.message || `Error ${res.status}`); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === "content_block_delta" && d.delta?.type === "text_delta") {
            full += d.delta.text; onChunk(d.delta.text, full);
          }
        } catch {}
      }
    }
    onDone(full);
  } catch(e) { onError(e.message || "Network error"); }
}

// ---- SECTION 5: MARKDOWN RENDERER ----
function escH(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function md(text) {
  if (!text) return "";
  let h = text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_,l,c) =>
      `<div class="code-wrap"><pre class="code-block" data-lang="${l||'text'}"><code>${escH(c.trim())}</code></pre><button class="copy-code-btn" onclick="navigator.clipboard?.writeText(this.previousElementSibling.textContent)">Copy</button></div>`)
    .replace(/`([^`\n]+)`/g, (_,c) => `<code class="ic">${escH(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>")
    .replace(/^[-*] (.+)$/gm,"<li>$1</li>").replace(/(<li>.*<\/li>(\n|$))+/g,s=>`<ul>${s}</ul>`)
    .replace(/^\d+\. (.+)$/gm,"<li_>$1</li_>").replace(/(<li_>.*<\/li_>(\n|$))+/g,s=>`<ol>${s.replace(/li_/g,"li")}</ol>`)
    .replace(/^> (.+)$/gm, `<blockquote>$1</blockquote>`)
    .replace(/^---$/gm,"<hr>")
    .replace(/\n\n+/g,"</p><p>").replace(/\n(?!<)/g,"<br>");
  return `<p>${h}</p>`;
}

// ---- SECTION 9: VIRTUAL LIST HOOK (Performance) ----
function useVirtualList(items, itemHeight = 120, containerRef) {
  const [range, setRange] = useState({ start: 0, end: 20 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Only virtualize if > 50 messages (mobile perf threshold)
    if (items.length <= 50) { setRange({ start: 0, end: items.length }); return; }
    const update = () => {
      const { scrollTop, clientHeight } = el;
      const buffer = 5;
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
      const end = Math.min(items.length, Math.ceil((scrollTop + clientHeight) / itemHeight) + buffer);
      setRange({ start, end });
    };
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => el.removeEventListener("scroll", update);
  }, [items.length, itemHeight, containerRef]);
  return range;
}

// ---- SECTION 10A: HAPTIC FEEDBACK ----
function haptic(type = "light") {
  if (!navigator.vibrate) return;
  const patterns = { light: [10], medium: [20], heavy: [30, 10, 30], success: [10, 50, 10], error: [50, 20, 50] };
  navigator.vibrate(patterns[type] || [10]);
}

// ---- SECTION 10B: PWA INSTALL HOOK ----
function usePWAInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const h = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => { setInstalled(true); setPrompt(null); });
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const install = useCallback(async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") { setInstalled(true); haptic("success"); }
    setPrompt(null);
  }, [prompt]);
  return { prompt, installed, install };
}

// ---- SECTION 10C: BATTERY AWARE HOOK ----
function useBatteryMode() {
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    if (!("getBattery" in navigator)) return;
    navigator.getBattery().then(battery => {
      const check = () => setLowPower(battery.level < 0.2 && !battery.charging);
      check();
      battery.addEventListener("levelchange", check);
      battery.addEventListener("chargingchange", check);
    }).catch(() => {});
  }, []);
  return lowPower;
}

// ---- SECTION 10D: KEYBOARD AWARE HOOK (Android) ----
function useKeyboardAware(chatRef) {
  useEffect(() => {
    if (!("visualViewport" in window)) return;
    const vv = window.visualViewport;
    const handle = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      if (chatRef.current) {
        chatRef.current.style.paddingBottom = keyboardHeight > 100 ? `${keyboardHeight}px` : "";
      }
    };
    vv.addEventListener("resize", handle);
    return () => vv.removeEventListener("resize", handle);
  }, [chatRef]);
}

// ---- SECTION 10E: SWIPE GESTURE HOOK ----
function useSwipeGesture(onSwipeRight, onSwipeLeft) {
  const startX = useRef(null);
  const onTouchStart = useCallback(e => { startX.current = e.touches[0].clientX; }, []);
  const onTouchEnd = useCallback(e => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 60) { dx > 0 ? onSwipeRight?.() : onSwipeLeft?.(); }
    startX.current = null;
  }, [onSwipeRight, onSwipeLeft]);
  return { onTouchStart, onTouchEnd };
}

// ---- SECTION 8C: SERVICE WORKER REGISTRATION ----
function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js")
        .then(reg => {
          console.log("[OC] SW registered:", reg.scope);
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            nw?.addEventListener("statechange", () => {
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                // New version available — notify app
                window.dispatchEvent(new CustomEvent("sw-update"));
              }
            });
          });
        })
        .catch(e => console.warn("[OC] SW failed:", e));
    });
  }
}

// ---- HOOKS ----
function useTheme() {
  const [mode, setMode] = useState(() => localStorage.getItem("oc_theme") || "dark");
  const toggle = () => setMode(m => { const n = m==="dark"?"light":"dark"; localStorage.setItem("oc_theme",n); return n; });
  return [mode, toggle, THEME[mode]];
}
function useToast() {
  const [list, setList] = useState([]);
  const show = useCallback((msg, type="info", ms=2800) => {
    const id = Date.now();
    setList(l => [...l.slice(-2), { id, msg, type }]);
    setTimeout(() => setList(l => l.filter(x => x.id !== id)), ms);
  }, []);
  return [list, show];
}
function useAutoResize(ref) {
  return useCallback(() => {
    if (!ref.current) return;
    ref.current.style.height = "24px";
    ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + "px";
  }, [ref]);
}
function useVoice(onResult) {
  const [rec, setRec] = useState(false);
  const rRef = useRef(null);
  const supported = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  const start = useCallback(() => {
    if (!supported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR(); r.continuous = false; r.interimResults = true;
    r.onresult = e => { const t = Array.from(e.results).map(r=>r[0].transcript).join(""); if(e.results[e.results.length-1].isFinal) onResult(t); };
    r.onend = () => setRec(false); r.onerror = () => setRec(false);
    r.start(); rRef.current = r; setRec(true); haptic("light");
  }, [supported, onResult]);
  const stop = useCallback(() => { rRef.current?.stop(); setRec(false); }, []);
  return { rec, start, stop, supported };
}

// ---- STYLES ----
const css = (t) => `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:${t.bg};--sf:${t.surface};--sf2:${t.surfaceAlt};
  --br:${t.border};--br2:${t.borderBright};
  --ac:${t.accent};--acd:${t.accentDim};--ach:${t.accentHover};
  --dg:${t.danger};--wn:${t.warn};
  --tx:${t.text};--txd:${t.textDim};--txf:${t.textFaint};
  --glow:${t.glow};
  --r:12px;--rs:8px;--rx:5px;
  --fu:'Syne',sans-serif;--fc:'Space Mono',monospace;
}
html,body{height:100%;overflow:hidden;overscroll-behavior:none}
body{background:var(--bg);color:var(--tx);font-family:var(--fu);font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;user-select:none}

/* APP */
.app{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;position:relative}

/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
  background:var(--sf);border-bottom:1px solid var(--br);z-index:50;flex-shrink:0;
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.logo{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800;letter-spacing:-.5px}
.claw{width:34px;height:34px;background:var(--ac);border-radius:9px;display:flex;align-items:center;
  justify-content:center;font-size:17px;box-shadow:var(--glow);flex-shrink:0;transition:transform .2s}
.claw:active{transform:scale(.9)}
.hdr-btns{display:flex;gap:6px}

/* ICON BUTTONS */
.ib{width:36px;height:36px;border-radius:var(--rs);border:1px solid var(--br);background:var(--sf2);
  color:var(--txd);display:flex;align-items:center;justify-content:center;cursor:pointer;
  font-size:15px;transition:all .15s;touch-action:manipulation}
.ib:active{transform:scale(.88);background:var(--br)}
.ib.on{color:var(--ac);border-color:var(--ac);background:var(--acd)}

/* UPDATE BANNER */
.update-banner{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;
  background:var(--acd);border-bottom:1px solid var(--ac);font-size:12px;font-weight:700;
  color:var(--ac);flex-shrink:0;animation:slideDown .3s}
@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}

/* INSTALL BANNER */
.install-banner{display:flex;align-items:center;gap:10px;padding:10px 14px;
  background:var(--sf);border-bottom:1px solid var(--br);flex-shrink:0}
.install-text{flex:1;font-size:13px;font-weight:600;color:var(--tx)}
.install-sub{font-size:11px;color:var(--txd);font-weight:400}

/* PERSONA BAR */
.pbar{display:flex;gap:5px;padding:8px 14px 0;overflow-x:auto;flex-shrink:0;
  -webkit-overflow-scrolling:touch;scrollbar-width:none}
.pbar::-webkit-scrollbar{display:none}
.pchip{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;
  border:1px solid var(--br);background:var(--sf);font-size:12px;font-weight:600;
  color:var(--txd);white-space:nowrap;cursor:pointer;flex-shrink:0;transition:all .15s;touch-action:manipulation}
.pchip.on{border-color:var(--ac);background:var(--acd);color:var(--ac)}
.pchip:active{transform:scale(.95)}

/* RATE WARNING */
.rate-warn{margin:6px 14px;padding:9px 13px;background:#FFB80012;border:1px solid var(--wn);
  border-radius:var(--rs);font-size:12px;color:var(--wn);font-weight:700;display:flex;align-items:center;gap:7px}

/* FILE PREVIEW */
.file-strip{display:flex;gap:8px;padding:8px 14px;overflow-x:auto;flex-shrink:0;-webkit-overflow-scrolling:touch}
.file-chip{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--sf2);
  border:1px solid var(--br);border-radius:var(--rs);font-size:12px;font-weight:600;color:var(--txd);
  white-space:nowrap;flex-shrink:0;position:relative}
.file-chip-rm{margin-left:4px;cursor:pointer;color:var(--txf);font-size:14px}
.file-chip-rm:active{color:var(--dg)}

/* CHAT */
.chat{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 14px 8px;display:flex;
  flex-direction:column;gap:14px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.chat::-webkit-scrollbar{width:3px}
.chat::-webkit-scrollbar-thumb{background:var(--br);border-radius:2px}

/* VIRTUAL SPACER */
.v-top,.v-bot{flex-shrink:0}

/* MESSAGES */
.mw{display:flex;gap:9px;animation:mIn .3s cubic-bezier(.34,1.56,.64,1)}
.mw.user{flex-direction:row-reverse}
@keyframes mIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
.mav{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-size:13px;flex-shrink:0;align-self:flex-end}
.mw.assistant .mav{background:var(--acd);border:1px solid var(--ac)}
.mw.user .mav{background:var(--sf2);border:1px solid var(--br)}
.mb{max-width:83%;padding:11px 13px;border-radius:var(--r);font-size:14.5px;line-height:1.65;
  word-break:break-word;user-select:text;position:relative}
.mw.assistant .mb{background:var(--sf);border:1px solid var(--br);border-bottom-left-radius:4px}
.mw.user .mb{background:var(--ac);color:var(--bg);border-bottom-right-radius:4px;font-weight:500}
.mw.user .mb{user-select:text}
.mts{font-size:10px;color:var(--txf);font-family:var(--fc);margin-top:4px}
.mw.user .mts{text-align:right}
.sc::after{content:"▋";color:var(--ac);animation:bl .8s step-end infinite}
@keyframes bl{50%{opacity:0}}

/* MARKDOWN */
.mb h1{font-size:17px;font-weight:800;margin:10px 0 6px}
.mb h2{font-size:15px;font-weight:700;margin:9px 0 5px}
.mb h3{font-size:14px;font-weight:700;margin:8px 0 4px}
.mb p{margin-bottom:7px}.mb p:last-child{margin-bottom:0}
.mb ul,.mb ol{margin:6px 0 6px 16px}.mb li{margin-bottom:3px}
.mb blockquote{border-left:3px solid var(--ac);padding:4px 10px;opacity:.8;font-style:italic;margin:8px 0}
.mb hr{border:none;border-top:1px solid var(--br);margin:10px 0}
.code-wrap{position:relative;margin:8px 0}
.code-block{background:var(--bg);border:1px solid var(--br);border-radius:var(--rs);
  padding:10px 12px;overflow-x:auto;font-family:var(--fc);font-size:12px;
  -webkit-overflow-scrolling:touch;white-space:pre}
.code-block::before{content:attr(data-lang);position:absolute;top:6px;left:10px;
  font-size:10px;color:var(--txf);font-family:var(--fc);pointer-events:none}
.copy-code-btn{position:absolute;top:5px;right:5px;background:var(--sf2);border:1px solid var(--br);
  color:var(--txd);border-radius:var(--rx);font-size:10px;padding:3px 7px;cursor:pointer;
  font-family:var(--fc);z-index:2;touch-action:manipulation}
.copy-code-btn:active{background:var(--ac);color:var(--bg);border-color:var(--ac)}
.ic{background:var(--bg);border:1px solid var(--br);border-radius:4px;padding:1px 5px;
  font-family:var(--fc);font-size:12.5px;color:var(--ac)}

/* IMAGE ATTACHMENT in message */
.msg-img{max-width:100%;border-radius:var(--rs);margin-top:8px;border:1px solid var(--br)}

/* TYPING */
.typing{display:flex;gap:5px;padding:3px 2px;align-items:center}
.typing span{width:7px;height:7px;border-radius:50%;background:var(--txf);animation:td 1.2s ease-in-out infinite}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
@keyframes td{0%,60%,100%{transform:translateY(0);background:var(--txf)}30%{transform:translateY(-5px);background:var(--ac)}}

/* ERROR MESSAGE */
.msg-err{display:flex;gap:9px}
.err-bubble{max-width:83%;padding:11px 13px;border-radius:var(--r);font-size:13.5px;
  background:#FF474712;border:1px solid var(--dg);color:var(--dg);border-bottom-left-radius:4px;
  font-weight:600}

/* EMPTY STATE */
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:28px 20px;text-align:center}
.empty-icon{font-size:62px;animation:ep 3s ease-in-out infinite;
  filter:drop-shadow(0 0 18px var(--ac))}
@keyframes ep{0%,100%{transform:scale(1)}50%{transform:scale(1.06);filter:drop-shadow(0 0 30px var(--ac))}}
.empty-title{font-size:21px;font-weight:800}
.empty-sub{font-size:13.5px;color:var(--txd);max-width:240px;line-height:1.5}
.suggs{display:flex;flex-direction:column;gap:7px;width:100%;max-width:310px;margin-top:6px}
.sugg{background:var(--sf);border:1px solid var(--br);border-radius:var(--rs);padding:10px 13px;
  font-family:var(--fu);font-size:12.5px;font-weight:500;color:var(--txd);cursor:pointer;
  text-align:left;transition:all .15s;touch-action:manipulation}
.sugg:active{border-color:var(--ac);color:var(--ac);background:var(--acd)}

/* INPUT */
.ibar{padding:10px 14px;background:var(--sf);border-top:1px solid var(--br);flex-shrink:0;
  padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
.irow{display:flex;gap:7px;align-items:flex-end;background:var(--sf2);border:1px solid var(--br);
  border-radius:16px;padding:7px 7px 7px 13px;transition:border-color .2s}
.irow:focus-within{border-color:var(--ac)}
.tinput{flex:1;background:none;border:none;outline:none;font-family:var(--fu);font-size:15px;
  color:var(--tx);resize:none;max-height:120px;min-height:24px;line-height:1.5;overflow-y:auto;
  -webkit-overflow-scrolling:touch}
.tinput::placeholder{color:var(--txf)}
.tinput:disabled{opacity:.5}
.iacts{display:flex;gap:5px;align-items:flex-end;flex-shrink:0}
.att-btn{width:32px;height:32px;border-radius:50%;border:1px solid var(--br);background:var(--sf);
  color:var(--txd);display:flex;align-items:center;justify-content:center;cursor:pointer;
  font-size:14px;transition:all .15s;touch-action:manipulation}
.att-btn:active{transform:scale(.88);border-color:var(--ac);color:var(--ac)}
.vbtn{width:32px;height:32px;border-radius:50%;border:1px solid var(--br);background:var(--sf);
  color:var(--txd);display:flex;align-items:center;justify-content:center;cursor:pointer;
  font-size:14px;transition:all .15s;touch-action:manipulation}
.vbtn.on{background:var(--dg);border-color:var(--dg);color:white;animation:rp 1s ease-in-out infinite}
@keyframes rp{0%,100%{box-shadow:0 0 0 0 var(--dg)}50%{box-shadow:0 0 0 8px transparent}}
.sbtn{width:34px;height:34px;border-radius:50%;background:var(--ac);border:none;display:flex;
  align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:var(--bg);
  transition:all .2s;flex-shrink:0;touch-action:manipulation;font-weight:700}
.sbtn:disabled{background:var(--txf);cursor:not-allowed}
.sbtn:not(:disabled):active{transform:scale(.88)}
.imeta{display:flex;justify-content:space-between;align-items:center;margin-top:5px;padding:0 3px}
.cc{font-size:10px;font-family:var(--fc);color:var(--txf)}
.cc.w{color:var(--wn)}.cc.e{color:var(--dg)}
.mbadge{font-size:10px;font-family:var(--fc);color:var(--txf);display:flex;align-items:center;gap:3px}

/* SECURITY BAR */
.secbar{display:flex;align-items:center;gap:7px;padding:5px 14px;font-size:10.5px;
  font-family:var(--fc);color:var(--txf);background:var(--bg);border-top:1px solid var(--br);flex-shrink:0}
.secdot{width:5px;height:5px;border-radius:50%;background:var(--ac);flex-shrink:0}
.secdot.w{background:var(--wn)}.secdot.e{background:var(--dg)}

/* DRAWER */
.dov{position:fixed;inset:0;background:#00000060;z-index:200;opacity:0;pointer-events:none;transition:opacity .25s}
.dov.on{opacity:1;pointer-events:all}
.drw{position:fixed;left:0;top:0;bottom:0;width:80%;max-width:290px;background:var(--sf);
  border-right:1px solid var(--br);z-index:201;transform:translateX(-100%);
  transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
.drw.on{transform:translateX(0)}
.drw-hdr{padding:14px;border-bottom:1px solid var(--br);display:flex;align-items:center;
  justify-content:space-between;flex-shrink:0}
.drw-title{font-size:13px;font-weight:700;color:var(--txd);text-transform:uppercase;letter-spacing:1px}
.ncbtn{display:flex;align-items:center;gap:7px;padding:9px 13px;background:var(--acd);
  border:1px solid var(--ac);border-radius:var(--rs);color:var(--ac);font-family:var(--fu);
  font-size:13px;font-weight:700;cursor:pointer;width:100%;margin:10px 0 4px;transition:all .2s;touch-action:manipulation}
.ncbtn:active{background:var(--ac);color:var(--bg)}
.clist{flex:1;overflow-y:auto;padding:6px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.ci{padding:9px 11px;border-radius:var(--rs);cursor:pointer;transition:background .12s;
  border:1px solid transparent;margin-bottom:3px;touch-action:manipulation}
.ci.on,.ci:active{background:var(--sf2);border-color:var(--br)}
.ci-title{font-size:12.5px;font-weight:600;color:var(--tx);line-height:1.4;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;margin-right:24px}
.ci-meta{font-size:10px;color:var(--txf);margin-top:2px;font-family:var(--fc)}
.ci-del{float:right;font-size:13px;color:var(--txf);padding:0 3px;cursor:pointer;margin-top:-1px}
.ci-del:active{color:var(--dg)}
.drw-ftr{padding:10px;border-top:1px solid var(--br);flex-shrink:0}

/* SETTINGS PANEL */
.pov{position:fixed;inset:0;background:#00000070;z-index:300;display:flex;align-items:flex-end;
  opacity:0;pointer-events:none;transition:opacity .25s}
.pov.on{opacity:1;pointer-events:all}
.pnl{width:100%;background:var(--sf);border-top:1px solid var(--br);border-radius:18px 18px 0 0;
  max-height:92vh;overflow-y:auto;transform:translateY(100%);
  transition:transform .35s cubic-bezier(.4,0,.2,1);-webkit-overflow-scrolling:touch;
  padding-bottom:max(16px,env(safe-area-inset-bottom))}
.pov.on .pnl{transform:translateY(0)}
.phandle{width:38px;height:4px;background:var(--br);border-radius:2px;margin:11px auto 0}
.ptitle{font-size:18px;font-weight:800;padding:14px 18px 6px}
.psec{padding:14px 18px;border-top:1px solid var(--br)}
.slbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txd);margin-bottom:10px}
.ogrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.obtn{padding:9px 11px;border-radius:var(--rs);border:1px solid var(--br);background:var(--sf2);
  color:var(--txd);font-family:var(--fu);font-size:12.5px;font-weight:600;cursor:pointer;
  text-align:left;transition:all .12s;touch-action:manipulation;display:flex;align-items:center;gap:6px}
.obtn.on{border-color:var(--ac);background:var(--acd);color:var(--ac)}
.obtn:active{transform:scale(.96)}
.obtn-sub{font-size:9px;opacity:.7;display:block;margin-top:1px}
.apigrp{display:flex;flex-direction:column;gap:9px}
.apiin{width:100%;padding:11px 13px;background:var(--sf2);border:1px solid var(--br);
  border-radius:var(--rs);font-family:var(--fc);font-size:12.5px;color:var(--tx);
  outline:none;transition:border-color .2s}
.apiin:focus{border-color:var(--ac)}.apiin.err{border-color:var(--dg)}
.kst{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;
  padding:8px 11px;border-radius:var(--rs)}
.kst.ok{background:#00FFB212;color:var(--ac)}.kst.none{background:var(--sf2);color:var(--txd)}.kst.err{background:#FF474712;color:var(--dg)}
.kacts{display:flex;gap:7px}
.btn{padding:9px 16px;border-radius:var(--rs);font-family:var(--fu);font-size:12.5px;font-weight:700;
  cursor:pointer;transition:all .15s;touch-action:manipulation;border:1px solid transparent}
.btn-p{background:var(--ac);color:var(--bg)}.btn-p:active{background:var(--ach)}
.btn-s{background:var(--sf2);border-color:var(--br);color:var(--txd)}.btn-s:active{background:var(--br)}
.btn-d{background:transparent;border-color:var(--dg);color:var(--dg)}.btn-d:active{background:var(--dg);color:white}
.tr{display:flex;justify-content:space-between;align-items:center;padding:5px 0}
.tlbl{font-size:13.5px;font-weight:600;color:var(--tx)}
.tsub{font-size:11px;color:var(--txd);margin-top:1px}
.tgl{width:46px;height:25px;background:var(--sf2);border:1px solid var(--br);border-radius:13px;
  cursor:pointer;transition:all .25s;position:relative;flex-shrink:0}
.tgl.on{background:var(--ac);border-color:var(--ac)}
.tgl::after{content:"";position:absolute;width:19px;height:19px;background:white;border-radius:50%;
  top:2px;left:2px;transition:transform .25s cubic-bezier(.4,0,.2,1);box-shadow:0 1px 4px #0004}
.tgl.on::after{transform:translateX(21px)}
.secinfo{font-size:12.5px;color:var(--txd);line-height:1.7;font-family:var(--fc)}

/* TOAST */
.tstack{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:400;
  display:flex;flex-direction:column;gap:7px;pointer-events:none;align-items:center;width:90%;max-width:320px}
.tst{background:var(--sf);border:1px solid var(--br);border-radius:var(--rs);padding:9px 15px;
  font-size:12.5px;font-weight:700;text-align:center;box-shadow:0 4px 20px #0006;
  animation:tIn .3s cubic-bezier(.34,1.56,.64,1);color:var(--tx)}
.tst.success{border-color:var(--ac);color:var(--ac)}.tst.error{border-color:var(--dg);color:var(--dg)}.tst.warn{border-color:var(--wn);color:var(--wn)}
@keyframes tIn{from{opacity:0;transform:scale(.88) translateY(8px)}to{opacity:1;transform:none}}

/* LOW POWER */
.lp-banner{padding:5px 14px;background:#FFB80012;border-bottom:1px solid var(--wn);font-size:11px;
  color:var(--wn);font-weight:700;text-align:center;flex-shrink:0}

@supports(padding:max(0px)){
  .ibar{padding-bottom:max(10px,env(safe-area-inset-bottom))}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
}
`;

// ---- MAIN COMPONENT ----
export default function OpenClawAI() {
  // Init PWA
  useEffect(() => { registerSW(); }, []);

  const [themeMode, toggleTheme, t] = useTheme();
  const [toasts, toast] = useToast();
  const pwa = usePWAInstall();
  const lowPower = useBatteryMode();

  // Core state
  const [apiKey, setApiKey] = useState(sec.getKey);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState(() => sec.getKey() ? "ok" : "none");
  const [persistKey, setPersistKey] = useState(!!localStorage.getItem("oc_ak"));
  const [model, setModel] = useState(() => localStorage.getItem("oc_model") || MODELS[0].id);
  const [persona, setPersona] = useState(() => localStorage.getItem("oc_persona") || "assistant");
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rlMsg, setRlMsg] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [convList, setConvList] = useState(mem.list());
  const [streaming, setStreaming] = useState(true);
  const [mdEnabled, setMdEnabled] = useState(true);
  const [attachments, setAttachments] = useState([]);
  const [showUpdate, setShowUpdate] = useState(false);
  const [showInstall, setShowInstall] = useState(false);

  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const resize = useAutoResize(inputRef);

  useKeyboardAware(chatRef);

  // Virtual list for performance
  const { start: vStart, end: vEnd } = useVirtualList(msgs, 110, chatRef);

  // Show install prompt after 3rd message
  useEffect(() => {
    if (msgs.length === 3 && pwa.prompt && !pwa.installed) setShowInstall(true);
  }, [msgs.length, pwa.prompt, pwa.installed]);

  // SW update notification
  useEffect(() => {
    const h = () => setShowUpdate(true);
    window.addEventListener("sw-update", h);
    return () => window.removeEventListener("sw-update", h);
  }, []);

  // Init conversation
  useEffect(() => {
    if (!mem.active) mem.newConvo(persona);
    const c = mem.get();
    if (c) setMsgs([...c.msgs]);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [msgs.length, busy]);

  const refreshConvs = useCallback(() => setConvList(mem.list()), []);

  const newChat = useCallback(() => {
    mem.newConvo(persona); setMsgs([]); setAttachments([]);
    refreshConvs(); setDrawerOpen(false); haptic("medium");
    inputRef.current?.focus();
  }, [persona, refreshConvs]);

  const switchConv = useCallback(id => {
    mem.active = id;
    const c = mem.convos[id];
    if (c) { setMsgs([...c.msgs]); setPersona(c.persona); }
    setDrawerOpen(false); haptic("light");
  }, []);

  const deleteConv = useCallback((e, id) => {
    e.stopPropagation();
    mem.del(id);
    if (!mem.active) { mem.newConvo(persona); setMsgs([]); }
    refreshConvs(); haptic("medium"); toast("Deleted", "warn");
  }, [persona, refreshConvs, toast]);

  // File attachment
  const handleFile = useCallback(e => {
    const files = Array.from(e.target.files || []);
    const MAX_SIZE = 4 * 1024 * 1024; // 4MB
    const valid = files.filter(f => {
      if (f.size > MAX_SIZE) { toast(`${f.name} too large (max 4MB)`, "error"); return false; }
      return true;
    });
    setAttachments(prev => [...prev, ...valid].slice(0, 3));
    e.target.value = "";
    haptic("light");
  }, [toast]);

  const rmAttachment = useCallback(i => {
    setAttachments(prev => prev.filter((_,j) => j !== i));
    haptic("light");
  }, []);

  // SEND
  const send = useCallback(async (text) => {
    const clean = sec.sanitize(text.trim());
    if (!clean && attachments.length === 0) return;

    if (clean && sec.injection(clean)) {
      sec.flag("INJECTION", clean);
      toast("⚠️ Injection attempt blocked", "error");
      haptic("error"); return;
    }
    const rl = sec.rateCheck();
    if (!rl.ok) {
      setRlMsg(`Rate limit: wait ${rl.wait}s`);
      setTimeout(() => setRlMsg(null), rl.wait * 1000);
      haptic("error"); return;
    }
    const key = apiKey || sec.getKey();
    if (!key) { toast("Add API key in ⚙️ Settings", "warn"); setSettingsOpen(true); return; }

    const userMsg = mem.addMsg("user", clean, { files: attachments.map(f=>f.name) });
    setMsgs(prev => [...prev, userMsg]);
    setInput(""); setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "24px";
    setBusy(true); haptic("light");

    const apiMsgs = mem.apiMsgs();
    const currentPersona = PERSONAS.find(p => p.id === persona) || PERSONAS[0];
    const system = currentPersona.prompt + (lowPower ? "\n\nBe very concise to save battery." : "");
    const streamId = "s_" + Date.now();
    const placeholder = { id: streamId, role: "assistant", content: "", ts: Date.now(), streaming: true };
    setMsgs(prev => [...prev, placeholder]);

    if (streaming) {
      await streamAI({
        messages: apiMsgs, system, model, key,
        onChunk: (_, full) => setMsgs(prev => prev.map(m => m.id === streamId ? { ...m, content: full } : m)),
        onDone: full => {
          const ai = mem.addMsg("assistant", full);
          setMsgs(prev => prev.map(m => m.id === streamId ? { ...ai } : m));
          refreshConvs(); setBusy(false); haptic("success");
        },
        onError: err => {
          setMsgs(prev => [...prev.filter(m => m.id !== streamId),
            { id: "e_"+Date.now(), role: "error", content: err, ts: Date.now() }]);
          setBusy(false); haptic("error"); toast("Error: " + err, "error");
        },
      });
    } else {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 1024, system, messages: apiMsgs }),
        });
        const data = await res.json();
        const full = data.content?.[0]?.text || "";
        const ai = mem.addMsg("assistant", full);
        setMsgs(prev => prev.map(m => m.id === streamId ? { ...ai } : m));
        refreshConvs(); haptic("success");
      } catch(e) {
        setMsgs(prev => [...prev.filter(m => m.id !== streamId),
          { id:"e_"+Date.now(), role:"error", content: e.message, ts: Date.now() }]);
        toast("Error: " + e.message, "error"); haptic("error");
      } finally { setBusy(false); }
    }
  }, [apiKey, model, persona, streaming, attachments, lowPower, refreshConvs, toast]);

  const handleSend = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || busy) return;
    send(input);
  }, [input, busy, send, attachments]);

  const onKey = useCallback(e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const voice = useVoice(t => { setInput(p => p + t); resize(); });

  const copyMsg = useCallback(content => {
    navigator.clipboard?.writeText(content).then(() => { toast("Copied!", "success"); haptic("light"); });
  }, [toast]);

  const saveKey = useCallback(() => {
    const k = apiKeyInput.trim();
    if (!k) { setKeyStatus("none"); return; }
    if (!sec.validKey(k)) { setKeyStatus("err"); toast("Invalid key format", "error"); return; }
    sec.storeKey(k, persistKey);
    setApiKey(k); setKeyStatus("ok"); setApiKeyInput("");
    toast("🔒 Key saved", "success"); haptic("success");
  }, [apiKeyInput, persistKey, toast]);

  const clearKey = useCallback(() => {
    sec.clearKey(); setApiKey(""); setKeyStatus("none");
    toast("Key cleared", "warn"); haptic("medium");
  }, [toast]);

  const changePer = useCallback(pid => {
    setPersona(pid); localStorage.setItem("oc_persona", pid);
    const c = mem.get(); if (c) { c.persona = pid; mem._save(); }
    haptic("light");
  }, []);

  const changeMod = useCallback(mid => {
    setModel(mid); localStorage.setItem("oc_model", mid); haptic("light");
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm("Delete all conversations and settings?")) return;
    mem.clear(); sec.clearKey(); setMsgs([]); setApiKey(""); setKeyStatus("none");
    mem.newConvo(persona); refreshConvs();
    toast("All data cleared", "warn"); haptic("heavy");
  }, [persona, refreshConvs, toast]);

  const curPersona = PERSONAS.find(p => p.id === persona) || PERSONAS[0];
  const curModel = MODELS.find(m => m.id === model) || MODELS[0];
  const charClass = input.length > 7000 ? "e" : input.length > 5000 ? "w" : "";

  // Swipe to open/close drawer
  const swipe = useSwipeGesture(
    () => !drawerOpen && setDrawerOpen(true),
    () => drawerOpen && setDrawerOpen(false)
  );

  const styles = useMemo(() => css(t), [t]);

  // Visible messages (virtual list)
  const visibleMsgs = msgs.length > 50 ? msgs.slice(vStart, vEnd) : msgs;
  const topPad = msgs.length > 50 ? vStart * 110 : 0;
  const botPad = msgs.length > 50 ? (msgs.length - vEnd) * 110 : 0;

  return (
    <>
      <style>{styles}</style>

      {/* TOASTS */}
      <div className="tstack">
        {toasts.map(t => <div key={t.id} className={`tst ${t.type}`}>{t.msg}</div>)}
      </div>

      <div className="app" {...swipe}>

        {/* UPDATE BANNER */}
        {showUpdate && (
          <div className="update-banner">
            ✦ Update available
            <button className="btn btn-p" style={{fontSize:"11px",padding:"4px 10px"}}
              onClick={() => { navigator.serviceWorker?.controller?.postMessage({type:"SKIP_WAITING"}); window.location.reload(); }}>
              Reload
            </button>
          </div>
        )}

        {/* LOW POWER BANNER */}
        {lowPower && <div className="lp-banner">🔋 Low battery — responses shortened</div>}

        {/* HEADER */}
        <header className="hdr">
          <div className="logo" onClick={() => setDrawerOpen(true)}>
            <div className="claw">🦾</div>
            <span>OpenClaw</span>
          </div>
          <div className="hdr-btns">
            <button className="ib" onClick={toggleTheme} aria-label="Toggle theme">
              {themeMode === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="ib" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙️</button>
            <button className="ib" onClick={() => setDrawerOpen(true)} aria-label="Conversations">☰</button>
          </div>
        </header>

        {/* INSTALL PROMPT */}
        {showInstall && (
          <div className="install-banner">
            <span style={{fontSize:"22px"}}>🦾</span>
            <div className="install-text">
              Add to home screen
              <div className="install-sub">Works offline, no browser chrome</div>
            </div>
            <button className="btn btn-p" onClick={() => { pwa.install(); setShowInstall(false); }}>Install</button>
            <button className="ib" onClick={() => setShowInstall(false)}>✕</button>
          </div>
        )}

        {/* PERSONA BAR */}
        <div className="pbar" role="tablist" aria-label="AI Personas">
          {PERSONAS.map(p => (
            <button key={p.id} role="tab" aria-selected={persona === p.id}
              className={`pchip ${persona === p.id ? "on" : ""}`}
              onClick={() => changePer(p.id)}>
              <span aria-hidden="true">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {/* RATE LIMIT */}
        {rlMsg && <div className="rate-warn" role="alert">⚡ {rlMsg}</div>}

        {/* FILE PREVIEWS */}
        {attachments.length > 0 && (
          <div className="file-strip" aria-label="Attached files">
            {attachments.map((f, i) => (
              <div key={i} className="file-chip">
                📎 {f.name.slice(0,20)}{f.name.length>20?"…":""}
                <span className="file-chip-rm" onClick={() => rmAttachment(i)} role="button" aria-label="Remove attachment">✕</span>
              </div>
            ))}
          </div>
        )}

        {/* CHAT AREA */}
        <main className="chat" ref={chatRef} role="log" aria-label="Conversation" aria-live="polite">
          {msgs.length === 0 ? (
            <div className="empty" role="region" aria-label="Welcome">
              <div className="empty-icon" aria-hidden="true">🦾</div>
              <h1 className="empty-title">OpenClaw AI</h1>
              <p className="empty-sub">
                {curPersona.icon} {curPersona.label} mode · {curModel.icon} {curModel.label}
              </p>
              <div className="suggs" role="list" aria-label="Suggested prompts">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="sugg" role="listitem"
                    onClick={() => send(s.replace(/^[^\s]+\s/,""))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="v-top" style={{height: topPad}} aria-hidden="true" />
              {visibleMsgs.map(m => {
                if (m.role === "error") return (
                  <div key={m.id} className="msg-err" role="alert">
                    <div className="mav" aria-hidden="true">⚠️</div>
                    <div className="err-bubble">Error: {m.content}</div>
                  </div>
                );
                const isUser = m.role === "user";
                const ts = new Date(m.ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
                return (
                  <article key={m.id} className={`mw ${m.role}`} aria-label={`${m.role} message`}>
                    <div className="mav" aria-hidden="true">{isUser ? "👤" : "🦾"}</div>
                    <div>
                      <div
                        className={`mb ${m.streaming ? "sc" : ""}`}
                        onClick={() => !isUser && copyMsg(m.content)}
                        onKeyDown={e => e.key==="Enter" && !isUser && copyMsg(m.content)}
                        tabIndex={!isUser ? 0 : undefined}
                        role={!isUser ? "button" : undefined}
                        aria-label={!isUser ? "Tap to copy" : undefined}
                        dangerouslySetInnerHTML={!isUser && mdEnabled
                          ? { __html: md(m.content || "") }
                          : undefined
                        }
                      >
                        {(isUser || !mdEnabled) ? m.content : undefined}
                      </div>
                      {m.files?.length > 0 && (
                        <div style={{fontSize:"11px",color:"var(--txf)",marginTop:"4px",fontFamily:"var(--fc)"}}>
                          📎 {m.files.join(", ")}
                        </div>
                      )}
                      <div className="mts">{ts}{!isUser && !m.streaming && " · tap to copy"}</div>
                    </div>
                  </article>
                );
              })}
              <div className="v-bot" style={{height: botPad}} aria-hidden="true" />
              {busy && (
                <div className="mw assistant" aria-label="AI is responding">
                  <div className="mav" aria-hidden="true">🦾</div>
                  <div className="mb">
                    <div className="typing" aria-hidden="true"><span/><span/><span/></div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* INPUT BAR */}
        <footer className="ibar">
          <div className="irow">
            <textarea
              ref={inputRef}
              className="tinput"
              placeholder={`Message ${curPersona.label}…`}
              value={input}
              onChange={e => { setInput(e.target.value); resize(); }}
              onKeyDown={onKey}
              rows={1}
              maxLength={MAX_INPUT}
              disabled={busy}
              aria-label="Message input"
              aria-multiline="true"
            />
            <div className="iacts">
              <input ref={fileRef} type="file" style={{display:"none"}} multiple
                accept="image/*,.pdf,.txt,.md,.js,.ts,.py,.json,.csv"
                onChange={handleFile} />
              <button className="att-btn" onClick={() => fileRef.current?.click()}
                aria-label="Attach file" title="Attach file">📎</button>
              {voice.supported && (
                <button className={`vbtn ${voice.rec ? "on" : ""}`}
                  onClick={voice.rec ? voice.stop : voice.start}
                  aria-label={voice.rec ? "Stop recording" : "Start voice input"}
                  aria-pressed={voice.rec}>
                  {voice.rec ? "⏹" : "🎙"}
                </button>
              )}
              <button className="sbtn" onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || busy}
                aria-label="Send message">
                {busy ? "…" : "↑"}
              </button>
            </div>
          </div>
          <div className="imeta">
            <span className={`cc ${charClass}`}>
              {input.length > 4000 ? `${input.length}/${MAX_INPUT}` : ""}
            </span>
            <span className="mbadge">{curModel.icon} {curModel.label} · {curPersona.icon} {curPersona.label}</span>
          </div>
        </footer>

        {/* SECURITY BAR */}
        <div className="secbar" role="status" aria-live="off">
          <div className={`secdot ${keyStatus !== "ok" ? "w" : ""}`} aria-hidden="true" />
          <span>
            {keyStatus === "ok" ? "🔒 Encrypted" : "⚠️ No key"} ·
            {sec.log.length}/{RATE_LIMIT.max}/min ·
            {sec.session.slice(3,11)}
          </span>
        </div>
      </div>

      {/* ========== DRAWER ========== */}
      <div className={`dov ${drawerOpen ? "on" : ""}`} onClick={() => setDrawerOpen(false)}
        role="presentation" />
      <nav className={`drw ${drawerOpen ? "on" : ""}`} aria-label="Conversation history"
        aria-hidden={!drawerOpen}>
        <div className="drw-hdr">
          <span className="drw-title">Conversations</span>
          <button className="ib" onClick={() => setDrawerOpen(false)} aria-label="Close drawer">✕</button>
        </div>
        <div style={{padding:"0 10px"}}>
          <button className="ncbtn" onClick={newChat}>✦ New Conversation</button>
        </div>
        <div className="clist" role="list">
          {convList.length === 0 && (
            <p style={{padding:"18px 10px",textAlign:"center",color:"var(--txf)",fontSize:"12.5px"}}>
              No conversations yet
            </p>
          )}
          {convList.map(c => (
            <div key={c.id} role="listitem" className={`ci ${mem.active === c.id ? "on" : ""}`}
              onClick={() => switchConv(c.id)}>
              <span className="ci-del" onClick={e => deleteConv(e, c.id)} role="button" aria-label="Delete">🗑</span>
              <div className="ci-title">{c.title}</div>
              <div className="ci-meta">{c.msgs.length} msg · {new Date(c.at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
        <div className="drw-ftr">
          <p style={{fontSize:"10px",color:"var(--txf)",fontFamily:"var(--fc)",textAlign:"center"}}>
            OpenClaw AI v2.0 · End-to-end secure
          </p>
        </div>
      </nav>

      {/* ========== SETTINGS PANEL ========== */}
      <div className={`pov ${settingsOpen ? "on" : ""}`}
        onClick={e => e.target === e.currentTarget && setSettingsOpen(false)}
        role="dialog" aria-modal="true" aria-label="Settings" aria-hidden={!settingsOpen}>
        <div className="pnl">
          <div className="phandle" />
          <h2 className="ptitle">⚙️ Settings</h2>

          {/* API KEY */}
          <section className="psec">
            <div className="slbl">🔑 API Key</div>
            <div className="apigrp">
              <div className={`kst ${keyStatus}`}>
                {keyStatus==="ok" && "✓ API key active"}
                {keyStatus==="none" && "No key configured"}
                {keyStatus==="err" && "✗ Invalid key format"}
              </div>
              <input className={`apiin ${keyStatus==="err"?"err":""}`} type="password"
                placeholder="sk-ant-api03-..." value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                autoComplete="off" autoCorrect="off" spellCheck="false"
                aria-label="API Key input" />
              <div className="kacts">
                <button className="btn btn-p" onClick={saveKey}>Save Key</button>
                {keyStatus==="ok" && <button className="btn btn-d" onClick={clearKey}>Clear</button>}
              </div>
              <div className="tr">
                <div>
                  <div className="tlbl">Persist key</div>
                  <div className="tsub">Store in localStorage (less secure)</div>
                </div>
                <div className={`tgl ${persistKey?"on":""}`} onClick={() => setPersistKey(p=>!p)}
                  role="switch" aria-checked={persistKey} />
              </div>
            </div>
          </section>

          {/* MODEL */}
          <section className="psec">
            <div className="slbl">🤖 Model</div>
            <div className="ogrid">
              {MODELS.map(m => (
                <button key={m.id} className={`obtn ${model===m.id?"on":""}`}
                  onClick={() => changeMod(m.id)}>
                  {m.icon} {m.label}
                  <span className="obtn-sub">{m.tier}</span>
                </button>
              ))}
            </div>
          </section>

          {/* PERSONA */}
          <section className="psec">
            <div className="slbl">🎭 Persona</div>
            <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
              {PERSONAS.map(p => (
                <button key={p.id} className={`obtn ${persona===p.id?"on":""}`}
                  onClick={() => changePer(p.id)} style={{width:"100%"}}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </section>

          {/* PREFERENCES */}
          <section className="psec">
            <div className="slbl">🎛 Preferences</div>
            {[
              { label: "Streaming", sub: "Real-time text output", val: streaming, set: setStreaming },
              { label: "Markdown", sub: "Render code & formatting", val: mdEnabled, set: setMdEnabled },
              { label: themeMode==="dark"?"Dark Mode":"Light Mode", sub: "Toggle color scheme", val: themeMode==="dark", set: toggleTheme },
            ].map(item => (
              <div key={item.label} className="tr" style={{marginBottom:"4px"}}>
                <div>
                  <div className="tlbl">{item.label}</div>
                  <div className="tsub">{item.sub}</div>
                </div>
                <div className={`tgl ${item.val?"on":""}`}
                  onClick={() => typeof item.set === "function" && (item.label.includes("Mode") ? item.set() : item.set(v=>!v))}
                  role="switch" aria-checked={!!item.val} />
              </div>
            ))}
          </section>

          {/* PWA */}
          {pwa.prompt && !pwa.installed && (
            <section className="psec">
              <div className="slbl">📱 Install App</div>
              <button className="btn btn-p" style={{width:"100%"}} onClick={pwa.install}>
                Add OpenClaw to Home Screen
              </button>
            </section>
          )}

          {/* SECURITY */}
          <section className="psec">
            <div className="slbl">🔒 Security Info</div>
            <div className="secinfo">
              <div>▸ Injection detection: active</div>
              <div>▸ Input sanitization: active</div>
              <div>▸ Rate limit: {sec.log.length}/{RATE_LIMIT.max} req/min</div>
              <div>▸ Context window: last {MAX_CONTEXT} messages</div>
              <div>▸ Violations: {sec.violations}</div>
              <div>▸ Session: {sec.session.slice(0,18)}…</div>
              <div>▸ API key: {keyStatus==="ok" ? "✓ Stored (encoded)" : "Not set"}</div>
            </div>
          </section>

          {/* DANGER */}
          <section className="psec">
            <div className="slbl" style={{color:"var(--dg)"}}>⚠️ Danger Zone</div>
            <button className="btn btn-d" style={{width:"100%"}} onClick={clearAll}>
              Clear All Data & Conversations
            </button>
          </section>

          <div style={{padding:"14px 18px"}}>
            <button className="btn btn-s" style={{width:"100%"}} onClick={() => setSettingsOpen(false)}>
              Close Settings
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
