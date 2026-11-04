"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $("view");

  /* ---------- Notifications ---------- */
  const ICONS = {
    speaker: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
    speakerOff: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micOff: '<path d="M9 9v2a3 3 0 0 0 5 2.2M15 11V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.5 2.6M12 18v3"/><path d="m3 3 18 18"/>',
    cam: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/>',
    camOff: '<path d="M16 16v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m4 0h4a2 2 0 0 1 2 2v2l4-3v9"/><path d="m3 3 18 18"/>',
    eye: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a18 18 0 0 1-3.2 4M6.2 6.2A18 18 0 0 0 1.5 12S5 19 12 19a10.8 10.8 0 0 0 4.3-.9"/><path d="M9.5 9.6a3 3 0 0 0 4.2 4.3"/><path d="m3 3 18 18"/>',
    warn: '<path d="M12 9v4M12 17h0M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h0"/>'
  };
  const notes = $("notes");
  function notify(kind, icon, title, body, ms) {
    const n = document.createElement("div");
    n.className = "note " + (kind || "info");
    n.innerHTML =
      '<div class="nicon"><svg viewBox="0 0 24 24">' + (ICONS[icon] || ICONS.info) + '</svg></div>' +
      '<div class="ntext"><div class="ntitle"></div><div class="nbody"></div></div>' +
      '<button class="nclose" aria-label="Dismiss"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
    n.querySelector(".ntitle").textContent = title;
    n.querySelector(".nbody").textContent = body;
    const close = () => { if (!n.parentNode) return; n.classList.add("out"); setTimeout(() => n.remove(), 220); };
    n.querySelector(".nclose").addEventListener("click", close);
    notes.appendChild(n);
    setTimeout(close, ms || 2900);
  }
  const toastEl = $("toast"); let toastT;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), 1600); }

  /* ---------- Settings + webview boot ---------- */
  let settings = {};
  let viewReady = false, avHookReady = false;

  view.setAttribute("preload", window.desk.sitePreload);

  window.desk.settings.get().then((s) => {
    settings = s || {};
    view.src = settings.homepage || "https://www.cuemath.com/";
    fillSettings();
  });

  view.addEventListener("dom-ready", () => { viewReady = true; avHookReady = false; applyAv(); });
  view.addEventListener("did-navigate", (e) => { $("address").value = e.url; });
  view.addEventListener("did-navigate-in-page", (e) => { if (e.isMainFrame) $("address").value = e.url; });
  view.addEventListener("page-title-updated", (e) => { document.title = e.title + " — Cuemath Browser"; });
  view.addEventListener("ipc-message", (e) => { if (e.channel === "av-ready") { avHookReady = true; applyAv(); } });

  /* ---------- Navigation ---------- */
  $("back").addEventListener("click", () => view.canGoBack() && view.goBack());
  $("fwd").addEventListener("click", () => view.canGoForward() && view.goForward());
  $("reload").addEventListener("click", () => view.reload());
  $("home").addEventListener("click", () => view.loadURL(settings.homepage || "https://www.cuemath.com/"));
  $("addressForm").addEventListener("submit", (e) => {
    e.preventDefault();
    let v = $("address").value.trim(); if (!v) return;
    let url;
    if (/^https?:\/\//i.test(v)) url = v;
    else if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(v)) url = "https://" + v;
    else url = "https://www.google.com/search?q=" + encodeURIComponent(v);
    view.loadURL(url); $("address").blur();
  });

  /* ---------- A/V controls ---------- */
  const av = { audioMuted: false, mic: true, cam: true, hideVid: false };

  function applyAv() {
    // mic / camera / hide-video go to every frame via the main process.
    try { window.desk.av({ mic: av.mic, cam: av.cam, hideVid: av.hideVid }); } catch (e) {}
    // page audio output is muted on the whole webContents (all frames).
    if (viewReady) { try { view.setAudioMuted(av.audioMuted); } catch (e) {} }
  }
  function callWarnIfNeeded() {
    if (!avHookReady) notify("info", "info", "No call detected yet", "This will take effect once a page with a video call is open.");
  }

  $("muteAudio").addEventListener("click", function () {
    av.audioMuted = !av.audioMuted; this.classList.toggle("off", av.audioMuted);
    this.setAttribute("aria-pressed", String(av.audioMuted)); applyAv();
    if (av.audioMuted) notify("info", "speakerOff", "Page muted", "This site is silent on your speakers.");
    else notify("good", "speaker", "Sound on", "You'll hear the page again.");
  });
  $("micBtn").addEventListener("click", function () {
    av.mic = !av.mic; this.classList.toggle("off", !av.mic);
    this.setAttribute("aria-pressed", String(!av.mic)); applyAv();
    if (!av.mic) { notify("danger", "micOff", "Mic muted", "Your tutor can't hear you now."); callWarnIfNeeded(); }
    else notify("good", "mic", "Mic on", "Your tutor can hear you again.");
  });
  $("camBtn").addEventListener("click", function () {
    av.cam = !av.cam; this.classList.toggle("off", !av.cam);
    this.setAttribute("aria-pressed", String(!av.cam)); applyAv();
    if (!av.cam) { notify("danger", "camOff", "Camera off", "Your tutor can't see you now."); callWarnIfNeeded(); }
    else notify("good", "cam", "Camera on", "Your tutor can see you again.");
  });
  $("hideVid").addEventListener("click", function () {
    av.hideVid = !av.hideVid; this.classList.toggle("off", av.hideVid);
    this.setAttribute("aria-pressed", String(av.hideVid)); applyAv();
    if (av.hideVid) notify("info", "eyeOff", "Video hidden", "Hidden on your screen only — the call keeps running.");
    else notify("info", "eye", "Video shown", "Video is visible again.");
  });

  /* ---------- Focus mode ---------- */
  $("focusBtn").addEventListener("click", () => {
    const on = document.body.classList.toggle("focus");
    if (on) notify("info", "info", "Focus mode", "Everything but the page is hidden. Press Esc to exit.");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("focus")) document.body.classList.remove("focus"); });
  // Escape relayed from the embedded page (works even when the webview has focus).
  window.desk.onEsc(() => { if (document.body.classList.contains("focus")) document.body.classList.remove("focus"); });

  /* ---------- Passcode fill ---------- */
  async function fillPass() {
    const ok = await window.desk.fillPasscode();
    if (ok) notify("good", "info", "Passcode filled", "Typed into the focused field.");
    else notify("warn", "warn", "Nothing to fill", "Save a passcode in Settings, then click the login box first.");
  }
  $("fillPass").addEventListener("click", fillPass);
  document.addEventListener("keydown", (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key || "").toLowerCase() === "p") { e.preventDefault(); fillPass(); } });

  /* ---------- Drawer ---------- */
  const titles = { calc: "Calculator", tutor: "Math tutor", notes: "Easy notes", snips: "Quick text", settings: "Settings" };
  let activePanel = null;
  function openPanel(name) {
    if (activePanel === name) { closeDrawer(); return; }
    activePanel = name; $("drawer").hidden = false; $("drawerTitle").textContent = titles[name];
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
    document.querySelectorAll(".pill").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
    if (name === "tutor") { $("keyWarn").hidden = hasKey(); setTimeout(() => $("tutorInput").focus(), 20); }
  }
  function closeDrawer() { activePanel = null; $("drawer").hidden = true; document.querySelectorAll(".pill").forEach((b) => b.classList.remove("active")); }
  document.querySelectorAll(".pill").forEach((b) => b.addEventListener("click", () => openPanel(b.dataset.panel)));
  $("drawerClose").addEventListener("click", closeDrawer);

  /* ================= CALCULATOR ================= */
  const exprEl = $("calcExpr"), outEl = $("calcOut");
  let expr = "", angleMode = "deg", lastAnswer = null, justEval = false, history = [];
  try { history = JSON.parse(localStorage.getItem("sd_hist") || "[]"); } catch (e) {}
  function renderExpr() { exprEl.textContent = (expr.replace(/\*/g, "×").replace(/\//g, "÷").replace(/sqrt\(/g, "√(")) || " "; }
  function tokenize(s) {
    const funcs = ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "ln", "log", "abs"];
    const tk = []; let i = 0, prev = null;
    while (i < s.length) {
      const c = s[i];
      if (c === " ") { i++; continue; }
      if (/[0-9.]/.test(c)) { let n = ""; while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++]; if ((n.match(/\./g) || []).length > 1) throw new Error("bad number"); tk.push({ t: "num", v: parseFloat(n) }); prev = "num"; continue; }
      let m = false;
      for (const f of funcs) if (s.substr(i, f.length) === f) { tk.push({ t: "func", v: f }); i += f.length; prev = "func"; m = true; break; }
      if (m) continue;
      if (s.substr(i, 2) === "pi") { tk.push({ t: "num", v: Math.PI }); i += 2; prev = "num"; continue; }
      if (c === "e" && !/[a-z]/.test(s[i + 1] || "")) { tk.push({ t: "num", v: Math.E }); i++; prev = "num"; continue; }
      if (c === "(") { tk.push({ t: "lp" }); i++; prev = "lp"; continue; }
      if (c === ")") { tk.push({ t: "rp" }); i++; prev = "rp"; continue; }
      if (c === "!") { tk.push({ t: "fact" }); i++; prev = "fact"; continue; }
      if ("+-*/^".indexOf(c) >= 0) { const u = (c === "-" && (prev === null || prev === "op" || prev === "lp")); tk.push({ t: "op", v: u ? "u-" : c }); i++; prev = "op"; continue; }
      throw new Error("bad char");
    }
    return tk;
  }
  function toRPN(tokens) {
    const out = [], ops = [], prec = { "u-": 5, "^": 4, "*": 3, "/": 3, "+": 2, "-": 2 }, rt = { "^": 1, "u-": 1 };
    for (const tk of tokens) {
      if (tk.t === "num" || tk.t === "fact") out.push(tk);
      else if (tk.t === "func") ops.push(tk);
      else if (tk.t === "op") { while (ops.length) { const top = ops[ops.length - 1]; if (top.t === "op" && (prec[top.v] > prec[tk.v] || (prec[top.v] === prec[tk.v] && !rt[tk.v]))) out.push(ops.pop()); else if (top.t === "func") out.push(ops.pop()); else break; } ops.push(tk); }
      else if (tk.t === "lp") ops.push(tk);
      else if (tk.t === "rp") { while (ops.length && ops[ops.length - 1].t !== "lp") out.push(ops.pop()); if (!ops.length) throw new Error("mismatched )"); ops.pop(); if (ops.length && ops[ops.length - 1].t === "func") out.push(ops.pop()); }
    }
    while (ops.length) { const o = ops.pop(); if (o.t === "lp") throw new Error("mismatched ("); out.push(o); }
    return out;
  }
  const toRad = (x) => angleMode === "deg" ? x * Math.PI / 180 : x;
  function factorial(n) { if (n < 0 || n !== Math.floor(n)) throw new Error("n! needs whole ≥ 0"); if (n > 170) throw new Error("too big"); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; }
  function evalRPN(rpn) {
    const st = [];
    for (const tk of rpn) {
      if (tk.t === "num") st.push(tk.v);
      else if (tk.t === "fact") st.push(factorial(st.pop()));
      else if (tk.t === "op") {
        if (tk.v === "u-") { st.push(-st.pop()); continue; }
        const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) throw new Error("incomplete");
        if (tk.v === "+") st.push(a + b); else if (tk.v === "-") st.push(a - b); else if (tk.v === "*") st.push(a * b);
        else if (tk.v === "/") { if (b === 0) throw new Error("can't ÷ by 0"); st.push(a / b); } else if (tk.v === "^") st.push(Math.pow(a, b));
      } else if (tk.t === "func") {
        const x = st.pop(); let r;
        switch (tk.v) {
          case "sin": r = Math.sin(toRad(x)); break; case "cos": r = Math.cos(toRad(x)); break; case "tan": r = Math.tan(toRad(x)); break;
          case "asin": r = Math.asin(x); break; case "acos": r = Math.acos(x); break; case "atan": r = Math.atan(x); break;
          case "sqrt": if (x < 0) throw new Error("√ of negative"); r = Math.sqrt(x); break;
          case "ln": if (x <= 0) throw new Error("ln needs > 0"); r = Math.log(x); break;
          case "log": if (x <= 0) throw new Error("log needs > 0"); r = Math.log10(x); break;
          case "abs": r = Math.abs(x); break;
        }
        st.push(r);
      }
    }
    if (st.length !== 1) throw new Error("incomplete"); return st[0];
  }
  function evaluate(s) { return evalRPN(toRPN(tokenize(s.replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")))); }
  function fmt(n) { if (!isFinite(n)) throw new Error("not finite"); if (Math.abs(n) < 1e-12) n = 0; const r = Math.round(n * 1e10) / 1e10; if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0)) return r.toExponential(6).replace(/\.?0+e/, "e"); return String(r); }
  function cInsert(str) { if (justEval) { if (/[0-9.(]/.test(str) || /^(sin|cos|tan|ln|log|sqrt|π|abs)/.test(str)) expr = ""; else expr = (lastAnswer !== null ? String(lastAnswer) : ""); justEval = false; } expr += str; renderExpr(); }
  function cEval() { if (!expr.trim()) return; try { const out = fmt(evaluate(expr)); outEl.textContent = out; outEl.classList.remove("err"); lastAnswer = out; justEval = true; history.unshift({ e: expr.replace(/\*/g, "×").replace(/\//g, "÷"), o: out }); history = history.slice(0, 15); try { localStorage.setItem("sd_hist", JSON.stringify(history)); } catch (e) {} renderHist(); } catch (err) { outEl.textContent = err.message || "Error"; outEl.classList.add("err"); } }
  function renderHist() { const ul = $("histList"); if (!history.length) { ul.innerHTML = '<li class="empty">Past calculations appear here.</li>'; return; } ul.innerHTML = ""; history.forEach((h) => { const li = document.createElement("li"); const a = document.createElement("span"); a.textContent = h.e; const b = document.createElement("span"); b.className = "ho"; b.textContent = "= " + h.o; li.append(a, b); li.addEventListener("click", () => { expr = String(h.o); justEval = true; renderExpr(); outEl.textContent = h.o; outEl.classList.remove("err"); }); ul.appendChild(li); }); }
  renderHist();
  $("calcKeys").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.ins != null) cInsert(b.dataset.ins); else if (b.dataset.act === "eq") cEval(); else if (b.dataset.act === "del") { justEval = false; expr = expr.slice(0, -1); renderExpr(); } else if (b.dataset.act === "clear") { expr = ""; justEval = false; renderExpr(); outEl.textContent = "0"; outEl.classList.remove("err"); } });
  $("angleToggle").addEventListener("click", function (e) { const b = e.target.closest("button"); if (!b) return; angleMode = b.dataset.ang; [...this.children].forEach((c) => c.classList.toggle("on", c === b)); });
  document.addEventListener("keydown", (e) => {
    if (activePanel !== "calc") return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (/[0-9]/.test(k) || "+-*/^().".indexOf(k) >= 0) { cInsert(k); e.preventDefault(); }
    else if (k === "Enter" || k === "=") { cEval(); e.preventDefault(); }
    else if (k === "Backspace") { justEval = false; expr = expr.slice(0, -1); renderExpr(); e.preventDefault(); }
    else if (k === "Escape" || k === "Delete") { expr = ""; justEval = false; renderExpr(); outEl.textContent = "0"; outEl.classList.remove("err"); e.preventDefault(); }
    else if (k === "!") { cInsert("!"); e.preventDefault(); }
  });

  /* ================= SNIPPETS ================= */
  let snippets = [];
  try { snippets = JSON.parse(localStorage.getItem("sd_snips") || "null"); } catch (e) {}
  if (!snippets) { snippets = [{ id: sid(), name: "Working shown", key: "w", text: "Here's my working:\n" }, { id: sid(), name: "Final answer", key: "a", text: "Final answer: " }]; saveSnips(); }
  function sid() { return Math.random().toString(36).slice(2, 9); }
  function saveSnips() { try { localStorage.setItem("sd_snips", JSON.stringify(snippets)); } catch (e) {} }
  function copyText(t) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast("Copied — paste with ⌘V")).catch(() => fb(t)); else fb(t); function fb(x) { const ta = document.createElement("textarea"); ta.value = x; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied — paste with ⌘V"); } catch (e) { toast("Couldn't copy"); } document.body.removeChild(ta); } }
  function renderSnips() {
    const list = $("snipList"); list.innerHTML = "";
    if (!snippets.length) { list.innerHTML = '<p class="muted small">No snippets yet.</p>'; return; }
    snippets.forEach((s) => {
      const row = document.createElement("div"); row.className = "snip";
      const hot = document.createElement("div"); hot.className = "hot"; hot.textContent = s.key ? "⌥" + s.key.toUpperCase() : "—";
      const b = document.createElement("div"); b.className = "b";
      const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = s.name || "(untitled)";
      const tx = document.createElement("div"); tx.className = "tx"; tx.textContent = s.text; b.append(nm, tx);
      const a = document.createElement("div"); a.className = "a";
      const cp = document.createElement("button"); cp.className = "cp"; cp.textContent = "Copy"; cp.addEventListener("click", () => copyText(s.text));
      const dl = document.createElement("button"); dl.textContent = "Delete"; dl.addEventListener("click", () => { snippets = snippets.filter((x) => x.id !== s.id); saveSnips(); renderSnips(); });
      a.append(cp, dl); row.append(hot, b, a); list.appendChild(row);
    });
  }
  renderSnips();
  $("snipAdd").addEventListener("click", () => {
    const name = $("snipName").value.trim(), key = $("snipKey").value.trim().slice(0, 1).toLowerCase(), text = $("snipText").value;
    if (!text) { toast("Add some text first"); return; }
    if (key && snippets.some((s) => s.key === key)) { toast("That key is taken"); return; }
    snippets.push({ id: sid(), name, key, text }); saveSnips(); renderSnips();
    $("snipName").value = ""; $("snipKey").value = ""; $("snipText").value = ""; toast("Snippet added");
  });
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = (e.key || "").toLowerCase(); if (k.length !== 1) return;
    const hit = snippets.find((s) => s.key === k); if (!hit) return;
    e.preventDefault();
    const el = document.activeElement, tag = (el && el.tagName || "").toLowerCase();
    if (el && (tag === "input" || tag === "textarea") && !el.readOnly) { const a = el.selectionStart, b = el.selectionEnd; el.value = el.value.slice(0, a) + hit.text + el.value.slice(b); el.selectionStart = el.selectionEnd = a + hit.text.length; toast("Inserted “" + (hit.name || "snippet") + "”"); }
    else copyText(hit.text);
  });

  /* ================= SETTINGS ================= */
  function hasKey() { return !!((settings.provider === "groq" ? settings.groqKey : settings.anthropicKey) || "").trim(); }
  function fillSettings() {
    $("provider").value = settings.provider || "anthropic";
    $("anthropicKey").value = settings.anthropicKey || "";
    $("groqKey").value = settings.groqKey || "";
    $("anthropicModel").value = settings.anthropicModel || "claude-sonnet-5-5";
    $("groqModel").value = settings.groqModel || "meta-llama/llama-4-scout-17b-16e-instruct";
    $("homepage").value = settings.homepage || "https://leap.cuemath.com/";
    $("passcode").value = settings.passcode || "";
    syncProvBlocks();
  }
  function syncProvBlocks() {
    const p = $("provider").value;
    document.querySelectorAll(".prov-block").forEach((b) => { b.hidden = b.dataset.prov !== p; });
  }
  $("provider").addEventListener("change", syncProvBlocks);
  document.querySelectorAll("[data-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); window.desk.openExternal(a.dataset.link); }));
  $("saveSettings").addEventListener("click", async () => {
    const patch = {
      provider: $("provider").value,
      anthropicKey: $("anthropicKey").value.trim(),
      groqKey: $("groqKey").value.trim(),
      anthropicModel: $("anthropicModel").value,
      groqModel: $("groqModel").value,
      homepage: $("homepage").value.trim() || "https://leap.cuemath.com/",
      passcode: $("passcode").value
    };
    settings = await window.desk.settings.set(patch);
    $("keyWarn").hidden = hasKey();
    notify("good", "info", "Settings saved", (settings.provider === "groq" ? "Using Groq" : "Using Claude") + (hasKey() ? " — tutor ready." : " — add a key to finish."));
  });
  $("testKey").addEventListener("click", async () => {
    const msg = $("testMsg"); msg.textContent = "Testing…"; msg.style.color = "var(--muted)";
    // Save current field values first so the test uses them.
    await window.desk.settings.set({ provider: $("provider").value, anthropicKey: $("anthropicKey").value.trim(), groqKey: $("groqKey").value.trim(), anthropicModel: $("anthropicModel").value, groqModel: $("groqModel").value });
    const res = await window.desk.testKey();
    msg.textContent = (res.ok ? "✓ " : "✗ ") + res.message;
    msg.style.color = res.ok ? "var(--good)" : "var(--danger)";
  });

  /* ================= EASY NOTES ================= */
  const NOTE_SYS = "You are a friendly tutor. Give a SHORT, kid-friendly definition of the concept the student names, then one simple worked example. Keep it under 90 words, plain language, no headings.";
  let notesSaved = [];
  try { notesSaved = JSON.parse(localStorage.getItem("sd_notes") || "[]"); } catch (e) {}
  function saveNotes() { try { localStorage.setItem("sd_notes", JSON.stringify(notesSaved)); } catch (e) {} }
  function renderNotes() {
    const list = $("noteList"); list.innerHTML = "";
    if (!notesSaved.length) { list.innerHTML = '<p class="muted small">No saved notes yet.</p>'; return; }
    notesSaved.forEach((n, i) => {
      const d = document.createElement("div"); d.className = "note-card";
      const h = document.createElement("div"); h.className = "nt"; h.textContent = n.term;
      const b = document.createElement("div"); b.className = "nb"; b.textContent = n.text;
      const x = document.createElement("button"); x.className = "nx"; x.textContent = "Delete"; x.addEventListener("click", () => { notesSaved.splice(i, 1); saveNotes(); renderNotes(); });
      d.append(h, b, x); list.appendChild(d);
    });
  }
  renderNotes();
  let noteBusy = false;
  async function explainTerm() {
    if (noteBusy) return;
    const term = $("noteTerm").value.trim();
    if (!term) { toast("Type a concept first"); return; }
    if (!hasKey()) { notify("warn", "warn", "No API key", "Add a key in Settings to use notes."); openPanel("settings"); return; }
    noteBusy = true;
    const out = $("noteOut"); out.hidden = false; out.innerHTML = '<div class="nb">Thinking…</div>';
    const res = await window.desk.ai({ system: NOTE_SYS, messages: [{ role: "user", parts: [{ type: "text", text: "Explain this math concept: " + term }] }] });
    if (res.ok) {
      out.innerHTML = "";
      const b = document.createElement("div"); b.className = "nb"; b.textContent = res.text;
      const save = document.createElement("button"); save.className = "mini"; save.textContent = "Save this note"; save.style.marginTop = "8px";
      save.addEventListener("click", () => { notesSaved.unshift({ term: term, text: res.text }); saveNotes(); renderNotes(); toast("Note saved"); });
      out.append(b, save);
    } else {
      out.innerHTML = '<div class="nb">' + (res.error === "no-key" ? "Add an API key in Settings." : ("Couldn't fetch that: " + (res.message || res.error))) + "</div>";
    }
    noteBusy = false;
  }
  $("noteGo").addEventListener("click", explainTerm);
  $("noteTerm").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); explainTerm(); } });

  /* ================= TUTOR ================= */
  const chat = $("chat"), tutorInput = $("tutorInput"), sendBtn = $("sendBtn"), attachRow = $("attachRow");
  const messages = []; let pending = []; let busy = false;
  function autoGrow() { tutorInput.style.height = "auto"; tutorInput.style.height = Math.min(tutorInput.scrollHeight, 120) + "px"; }
  tutorInput.addEventListener("input", autoGrow);
  function pushImage(dataUrl) {
    const media_type = dataUrl.slice(5, dataUrl.indexOf(";"));
    const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (pending.length >= 4) { toast("Up to 4 images"); return; }
    pending.push({ dataUrl, media_type, data }); renderAttach();
  }
  function renderAttach() { attachRow.innerHTML = ""; pending.forEach((p, i) => { const c = document.createElement("span"); c.className = "chip"; const s = document.createElement("span"); s.textContent = "image " + (i + 1); const x = document.createElement("button"); x.textContent = "×"; x.addEventListener("click", () => { pending.splice(i, 1); renderAttach(); }); c.append(s, x); attachRow.appendChild(c); }); }
  $("attachBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { [...e.target.files].forEach((f) => { const r = new FileReader(); r.onload = () => pushImage(r.result); r.readAsDataURL(f); }); e.target.value = ""; });
  $("capBtn").addEventListener("click", async () => {
    if (!viewReady) { toast("Page not ready yet"); return; }
    try { const img = await view.capturePage(); pushImage(img.toDataURL()); notify("good", "info", "Screen captured", "Add a question and tap Ask."); }
    catch (err) { toast("Couldn't capture the screen"); }
  });
  tutorInput.addEventListener("paste", (e) => { const items = (e.clipboardData && e.clipboardData.items) || []; for (const it of items) if (it.type.indexOf("image") === 0) { const f = it.getAsFile(); if (f) { const r = new FileReader(); r.onload = () => pushImage(r.result); r.readAsDataURL(f); e.preventDefault(); } } });
  function addBubble(who, text, imgs) {
    const intro = $("tutorIntro"); if (intro) intro.remove();
    const w = document.createElement("div"); w.className = "msg " + (who === "me" ? "me" : "ai");
    const l = document.createElement("div"); l.className = "who"; l.textContent = who === "me" ? "You" : "Tutor"; w.appendChild(l);
    if (imgs) imgs.forEach((p) => { const im = document.createElement("img"); im.className = "thumb"; im.src = p.dataUrl; w.appendChild(im); });
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = text; w.appendChild(b);
    chat.appendChild(w); chat.scrollTop = chat.scrollHeight; return b;
  }
  async function ask() {
    if (busy) return;
    const text = tutorInput.value.trim(); const imgs = pending.slice();
    if (!text && !imgs.length) { toast("Type a question or add an image"); return; }
    if (!hasKey()) { $("keyWarn").hidden = false; notify("warn", "warn", "No API key", "Add a " + (settings.provider === "groq" ? "Groq" : "Claude") + " key in Settings to use the tutor."); openPanel("settings"); return; }
    busy = true; sendBtn.disabled = true; sendBtn.textContent = "…";
    addBubble("me", text || "(see image)", imgs);
    const parts = [];
    imgs.forEach((p) => parts.push({ type: "image", media_type: p.media_type, data: p.data }));
    parts.push({ type: "text", text: text || "Please read and solve the math problem shown in the image, step by step." });
    messages.push({ role: "user", parts });
    tutorInput.value = ""; autoGrow(); pending = []; renderAttach();
    const bubble = addBubble("ai", "Thinking…");
    try {
      const res = await window.desk.ai({ messages });
      if (res.ok) { bubble.textContent = res.text; messages.push({ role: "assistant", parts: [{ type: "text", text: res.text }] }); }
      else {
        messages.pop();
        if (res.error === "no-key") { bubble.textContent = "Add your API key in Settings to use the tutor."; openPanel("settings"); }
        else if (res.error === "api") bubble.textContent = "The " + (res.provider === "groq" ? "Groq" : "Claude") + " API said:\n" + (res.message || "error") + "\n\n(Check your key and model in Settings.)";
        else bubble.textContent = "Couldn't reach the tutor: " + (res.message || "network error");
      }
    } catch (err) { messages.pop(); bubble.textContent = "Something went wrong: " + String(err); }
    finally { busy = false; sendBtn.disabled = false; sendBtn.textContent = "Ask"; chat.scrollTop = chat.scrollHeight; }
  }
  sendBtn.addEventListener("click", ask);
  tutorInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
})();
