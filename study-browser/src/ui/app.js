"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $("view");

  /* ---------- Toast ---------- */
  const toastEl = $("toast"); let toastT;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), 1700); }

  /* ---------- Settings + webview boot ---------- */
  let settings = { apiKey: "", model: "claude-sonnet-5-5", homepage: "https://www.cuemath.com/" };
  let viewReady = false;

  view.setAttribute("preload", window.desk.sitePreload);

  window.desk.settings.get().then((s) => {
    settings = Object.assign(settings, s || {});
    view.src = settings.homepage || "https://www.cuemath.com/";
    $("apiKey").value = settings.apiKey || "";
    $("model").value = settings.model || "claude-sonnet-5-5";
    $("homepage").value = settings.homepage || "https://www.cuemath.com/";
  });

  view.addEventListener("dom-ready", () => { viewReady = true; applyAv(); });
  view.addEventListener("did-navigate", (e) => { $("address").value = e.url; });
  view.addEventListener("did-navigate-in-page", (e) => { if (e.isMainFrame) $("address").value = e.url; });
  view.addEventListener("page-title-updated", (e) => { document.title = e.title + " — Study Desk"; });

  /* ---------- Navigation ---------- */
  $("back").addEventListener("click", () => view.canGoBack() && view.goBack());
  $("fwd").addEventListener("click", () => view.canGoForward() && view.goForward());
  $("reload").addEventListener("click", () => view.reload());
  $("home").addEventListener("click", () => view.loadURL(settings.homepage || "https://www.cuemath.com/"));

  $("addressForm").addEventListener("submit", (e) => {
    e.preventDefault();
    let v = $("address").value.trim();
    if (!v) return;
    let url;
    if (/^https?:\/\//i.test(v)) url = v;
    else if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(v)) url = "https://" + v;
    else url = "https://www.google.com/search?q=" + encodeURIComponent(v);
    view.loadURL(url);
    $("address").blur();
  });

  /* ---------- A/V controls ---------- */
  const av = { audioMuted: false, mic: true, cam: true, hideVid: false };
  let hideCssKey = null;

  function applyAv() {
    if (!viewReady) return;
    try { view.setAudioMuted(av.audioMuted); } catch (e) {}
    try { view.send("av", { mic: av.mic, cam: av.cam }); } catch (e) {}
    // hide video (your screen only) via injected CSS
    try {
      if (av.hideVid && hideCssKey == null) {
        view.insertCSS("video{visibility:hidden !important;}").then((k) => { hideCssKey = k; });
      } else if (!av.hideVid && hideCssKey != null) {
        const k = hideCssKey; hideCssKey = null; view.removeInsertedCSS(k).catch(() => {});
      }
    } catch (e) {}
  }

  $("muteAudio").addEventListener("click", function () {
    av.audioMuted = !av.audioMuted;
    this.classList.toggle("on", av.audioMuted);
    this.querySelector(".g").textContent = av.audioMuted ? "🔇" : "🔊";
    applyAv(); toast(av.audioMuted ? "Page sound muted (your speakers)" : "Page sound on");
  });
  $("micBtn").addEventListener("click", function () {
    av.mic = !av.mic; this.classList.toggle("on", av.mic);
    applyAv(); toast(av.mic ? "Your mic on" : "Your mic off");
  });
  $("camBtn").addEventListener("click", function () {
    av.cam = !av.cam; this.classList.toggle("on", av.cam);
    applyAv(); toast(av.cam ? "Your camera on" : "Your camera off");
  });
  $("hideVid").addEventListener("click", function () {
    av.hideVid = !av.hideVid; this.classList.toggle("on", av.hideVid);
    applyAv(); toast(av.hideVid ? "Video hidden on your screen" : "Video shown");
  });

  /* ---------- Focus mode ---------- */
  $("focusBtn").addEventListener("click", () => {
    document.body.classList.toggle("focus");
    toast(document.body.classList.contains("focus") ? "Focus mode — press Esc to exit" : "");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("focus")) document.body.classList.remove("focus");
  });

  /* ---------- Drawer / panels ---------- */
  const titles = { calc: "Calculator", tutor: "Math tutor", snips: "Quick text", settings: "Settings" };
  let activePanel = null;
  function openPanel(name) {
    if (activePanel === name) { closeDrawer(); return; }
    activePanel = name;
    $("drawer").hidden = false;
    $("drawerTitle").textContent = titles[name];
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
    document.querySelectorAll(".feat-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
    if (name === "tutor") { $("keyWarn").hidden = !!settings.apiKey; setTimeout(() => $("tutorInput").focus(), 20); }
  }
  function closeDrawer() {
    activePanel = null; $("drawer").hidden = true;
    document.querySelectorAll(".feat-btn").forEach((b) => b.classList.remove("active"));
  }
  document.querySelectorAll(".feat-btn").forEach((b) => b.addEventListener("click", () => openPanel(b.dataset.panel)));
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
    if (st.length !== 1) throw new Error("incomplete");
    return st[0];
  }
  function evaluate(s) { return evalRPN(toRPN(tokenize(s.replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")))); }
  function fmt(n) { if (!isFinite(n)) throw new Error("not finite"); if (Math.abs(n) < 1e-12) n = 0; const r = Math.round(n * 1e10) / 1e10; if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0)) return r.toExponential(6).replace(/\.?0+e/, "e"); return String(r); }

  function cInsert(str) {
    if (justEval) { if (/[0-9.(]/.test(str) || /^(sin|cos|tan|ln|log|sqrt|π|abs)/.test(str)) expr = ""; else expr = (lastAnswer !== null ? String(lastAnswer) : ""); justEval = false; }
    expr += str; renderExpr();
  }
  function cEval() {
    if (!expr.trim()) return;
    try { const out = fmt(evaluate(expr)); outEl.textContent = out; outEl.classList.remove("err"); lastAnswer = out; justEval = true; history.unshift({ e: expr.replace(/\*/g, "×").replace(/\//g, "÷"), o: out }); history = history.slice(0, 15); try { localStorage.setItem("sd_hist", JSON.stringify(history)); } catch (e) {} renderHist(); }
    catch (err) { outEl.textContent = err.message || "Error"; outEl.classList.add("err"); }
  }
  function renderHist() {
    const ul = $("histList"); if (!history.length) { ul.innerHTML = '<li class="empty">Past calculations appear here.</li>'; return; }
    ul.innerHTML = "";
    history.forEach((h) => { const li = document.createElement("li"); const a = document.createElement("span"); a.textContent = h.e; const b = document.createElement("span"); b.className = "ho"; b.textContent = "= " + h.o; li.append(a, b); li.addEventListener("click", () => { expr = String(h.o); justEval = true; renderExpr(); outEl.textContent = h.o; outEl.classList.remove("err"); }); ul.appendChild(li); });
  }
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
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast("Copied — paste with ⌘V")).catch(() => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t) { const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied — paste with ⌘V"); } catch (e) { toast("Couldn't copy"); } document.body.removeChild(ta); }
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
    if (el && (tag === "input" || tag === "textarea") && !el.readOnly) {
      const a = el.selectionStart, b = el.selectionEnd; el.value = el.value.slice(0, a) + hit.text + el.value.slice(b); el.selectionStart = el.selectionEnd = a + hit.text.length; toast("Inserted “" + (hit.name || "snippet") + "”");
    } else copyText(hit.text);
  });

  /* ================= SETTINGS ================= */
  $("getKey").addEventListener("click", (e) => { e.preventDefault(); window.desk.openExternal("https://console.anthropic.com/settings/keys"); });
  $("saveSettings").addEventListener("click", async () => {
    const patch = { apiKey: $("apiKey").value.trim(), model: $("model").value, homepage: $("homepage").value.trim() || "https://www.cuemath.com/" };
    settings = await window.desk.settings.set(patch);
    $("savedMsg").hidden = false; setTimeout(() => ($("savedMsg").hidden = true), 1500);
    $("keyWarn").hidden = !!settings.apiKey;
    toast("Settings saved");
  });

  /* ================= TUTOR ================= */
  const chat = $("chat"), tutorInput = $("tutorInput"), sendBtn = $("sendBtn"), attachRow = $("attachRow");
  const messages = []; // API-shaped conversation
  let pending = []; // {dataUrl, media_type, base64}
  let busy = false;

  function autoGrow() { tutorInput.style.height = "auto"; tutorInput.style.height = Math.min(tutorInput.scrollHeight, 120) + "px"; }
  tutorInput.addEventListener("input", autoGrow);

  function pushImage(dataUrl) {
    const media_type = dataUrl.slice(5, dataUrl.indexOf(";"));
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (pending.length >= 4) { toast("Up to 4 images"); return; }
    pending.push({ dataUrl, media_type, base64 }); renderAttach();
  }
  function renderAttach() {
    attachRow.innerHTML = "";
    pending.forEach((p, i) => { const c = document.createElement("span"); c.className = "chip"; const s = document.createElement("span"); s.textContent = "image " + (i + 1); const x = document.createElement("button"); x.textContent = "×"; x.addEventListener("click", () => { pending.splice(i, 1); renderAttach(); }); c.append(s, x); attachRow.appendChild(c); });
  }

  $("attachBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    [...e.target.files].forEach((f) => { const r = new FileReader(); r.onload = () => pushImage(r.result); r.readAsDataURL(f); });
    e.target.value = "";
  });
  $("capBtn").addEventListener("click", async () => {
    if (!viewReady) { toast("Page not ready yet"); return; }
    try { const img = await view.capturePage(); pushImage(img.toDataURL()); toast("Screen captured — add a question and Ask"); }
    catch (err) { toast("Couldn't capture the screen"); }
  });
  tutorInput.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) if (it.type.indexOf("image") === 0) { const f = it.getAsFile(); if (f) { const r = new FileReader(); r.onload = () => pushImage(r.result); r.readAsDataURL(f); e.preventDefault(); } }
  });

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
    if (!settings.apiKey) { $("keyWarn").hidden = false; toast("Add your API key in Settings first"); openPanel("settings"); return; }

    busy = true; sendBtn.disabled = true; sendBtn.textContent = "…";
    addBubble("me", text || "(see image)", imgs);

    const content = [];
    imgs.forEach((p) => content.push({ type: "image", source: { type: "base64", media_type: p.media_type, data: p.base64 } }));
    content.push({ type: "text", text: text || "Please read and solve the math problem shown in the image, step by step." });
    messages.push({ role: "user", content });

    tutorInput.value = ""; autoGrow(); pending = []; renderAttach();
    const bubble = addBubble("ai", "Thinking…");

    try {
      const res = await window.desk.ai({ messages, model: settings.model });
      if (res.ok) { bubble.textContent = res.text; messages.push({ role: "assistant", content: res.text }); }
      else {
        messages.pop();
        if (res.error === "no-key") { bubble.textContent = "Add your Claude API key in ⚙️ Settings to use the tutor."; openPanel("settings"); }
        else if (res.error === "api") bubble.textContent = "The API said: " + (res.message || "error") + "\n(Check your key and model in Settings.)";
        else bubble.textContent = "Couldn't reach the tutor: " + (res.message || "network error");
      }
    } catch (err) { messages.pop(); bubble.textContent = "Something went wrong: " + String(err); }
    finally { busy = false; sendBtn.disabled = false; sendBtn.textContent = "Ask"; chat.scrollTop = chat.scrollHeight; }
  }
  sendBtn.addEventListener("click", ask);
  tutorInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
})();
