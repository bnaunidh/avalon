"use strict";
const { app, BrowserWindow, session, ipcMain, shell, Menu, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");

app.setName("Cuemath Browser");

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

const DEFAULTS = {
  provider: "anthropic",
  anthropicKey: "",
  groqKey: "",
  anthropicModel: "claude-sonnet-5-5",
  groqModel: "meta-llama/llama-4-scout-17b-16e-instruct",
  homepage: "https://leap.cuemath.com/",
  passcode: ""
};

function readSettings() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")));
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}
function writeSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2), "utf8");
    return true;
  } catch (e) { return false; }
}

let win;
let guestWC = null;                       // the embedded <webview>'s webContents
let currentAv = { mic: true, cam: true, hideVid: false };

function broadcastAv() {
  if (!guestWC || guestWC.isDestroyed()) return;
  try {
    for (const f of guestWC.mainFrame.framesInSubtree) {
      try { f.send("av", currentAv); } catch (e) {}
    }
  } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: "#ffffff",
    title: "Cuemath Browser",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));

  // Track the embedded browser's webContents so we can reach all its frames.
  win.webContents.on("did-attach-webview", (e, guest) => {
    guestWC = guest;
    const rb = () => broadcastAv();
    guest.on("did-navigate", rb);
    guest.on("did-frame-navigate", rb);
    guest.on("dom-ready", rb);
    // Escape always exits focus mode, even when the embedded page has focus.
    guest.on("before-input-event", (ev, input) => {
      if (input.type === "keyDown" && input.key === "Escape" && win && !win.isDestroyed()) {
        win.webContents.send("esc-key");
      }
    });
  });

  win.on("closed", () => { win = null; guestWC = null; });
}

// Grant camera / mic / fullscreen to the embedded site so video calls work.
// Turning your OWN mic/camera off is done live in site-preload.js (track.enabled).
function configureGuestSession() {
  const ses = session.fromPartition("persist:web");
  const ALLOW = new Set(["media", "display-capture", "fullscreen", "clipboard-read", "clipboard-sanitized-write", "notifications", "pointerLock"]);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOW.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ALLOW.has(permission));

  // Screen sharing: Cuemath calls getDisplayMedia; without a handler it is
  // auto-denied. Use the native macOS picker where available, otherwise grant
  // the primary screen so sharing just works.
  try {
    ses.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
        if (!sources || !sources.length) { callback({}); return; }
        const screen = sources.find((s) => (s.id || "").startsWith("screen:")) || sources[0];
        const grant = { video: screen };
        if (process.platform === "win32") grant.audio = "loopback";
        callback(grant);
      }).catch(() => callback({}));
    }, { useSystemPicker: true });
  } catch (e) {
    // Older Electron without options arg
    try {
      ses.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
          const screen = (sources || []).find((s) => (s.id || "").startsWith("screen:")) || (sources || [])[0];
          callback(screen ? { video: screen } : {});
        }).catch(() => callback({}));
      });
    } catch (e2) {}
  }
  // Drop Content-Security-Policy so our in-page mic/camera hook can be injected
  // into the real page world (including the call iframe).
  ses.webRequest.onHeadersReceived((details, cb) => {
    const h = details.responseHeaders || {};
    for (const k of Object.keys(h)) {
      if (/^content-security-policy/i.test(k) || /^x-webkit-csp/i.test(k)) delete h[k];
    }
    cb({ responseHeaders: h });
  });
}

app.on("web-contents-created", (event, contents) => {
  if (contents.getType && contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) contents.loadURL(url);
      return { action: "deny" };
    });
  }
});

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (e, patch) => {
  const next = Object.assign(readSettings(), patch || {});
  writeSettings(next);
  return next;
});
ipcMain.handle("window:fullscreen", (e, on) => {
  if (!win) return false;
  win.setFullScreen(typeof on === "boolean" ? on : !win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle("open-external", (e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });

// A/V: toolbar sets desired state; every frame of the embedded site receives it.
ipcMain.on("av:set", (e, s) => { currentAv = Object.assign(currentAv, s || {}); broadcastAv(); });
// Each frame pulls the current state as it loads (covers late-loading iframes).
ipcMain.on("av:request", (e) => { try { e.senderFrame.send("av", currentAv); } catch (err) {} });

// Live captions: transcribe a remote-audio chunk with Groq Whisper, send text back.
let capWarned = false;
ipcMain.on("caption:audio", async (e, payload) => {
  const s = readSettings();
  const key = (s.groqKey || "").trim();
  if (!key) {
    if (!capWarned && win && !win.isDestroyed()) { capWarned = true; win.webContents.send("caption:text", { text: "Live captions need a Groq API key (Settings).", meta: true }); }
    return;
  }
  try {
    const buf = Buffer.from(payload.b64 || "", "base64");
    if (!buf.length) return;
    const form = new FormData();
    form.append("model", "whisper-large-v3");
    form.append("response_format", "text");
    form.append("file", new Blob([buf], { type: payload.mime || "audio/webm" }), "audio.webm");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "authorization": "Bearer " + key },
      body: form
    });
    const txt = await res.text();
    if (!win || win.isDestroyed()) return;
    if (res.ok) { const t = txt.trim(); if (t) win.webContents.send("caption:text", { text: t }); }
    else win.webContents.send("caption:text", { text: "[caption error] " + txt.slice(0, 140), meta: true });
  } catch (err) { /* drop this chunk */ }
});

// Type the saved passcode into whatever field is focused in the embedded page.
ipcMain.handle("fill-passcode", () => {
  const s = readSettings();
  if (!s.passcode || !guestWC || guestWC.isDestroyed()) return false;
  const focused = guestWC.focusedFrame || guestWC.mainFrame;
  try { guestWC.focus(); } catch (e) {}
  try { guestWC.insertText(s.passcode); return true; } catch (e) { return false; }
});

/* ---------- AI tutor: Anthropic or Groq (OpenAI-compatible) ---------- */
const SYSTEM =
  "You are a warm, patient math tutor helping a student who is still learning. " +
  "Explain how to solve the problem step by step, showing the reasoning and naming the rule used at each step, " +
  "so the student understands the method and can handle the next one on their own. " +
  "Give the final answer as well, but always with the working that leads to it. " +
  "If an image is included, read the problem from it. Be clear, concise and encouraging; use plain language.";

// Neutral message: { role, parts:[{type:'text',text} | {type:'image',media_type,data}] }
function toAnthropic(m) {
  return { role: m.role, content: m.parts.map(p => p.type === "image"
    ? { type: "image", source: { type: "base64", media_type: p.media_type, data: p.data } }
    : { type: "text", text: p.text }) };
}
function toOpenAI(m) {
  if (m.role === "assistant") {
    return { role: "assistant", content: m.parts.filter(p => p.type === "text").map(p => p.text).join("\n") };
  }
  return { role: "user", content: m.parts.map(p => p.type === "image"
    ? { type: "image_url", image_url: { url: "data:" + p.media_type + ";base64," + p.data } }
    : { type: "text", text: p.text }) };
}

ipcMain.handle("ai:ask", async (e, payload) => {
  const s = readSettings();
  const provider = s.provider === "groq" ? "groq" : "anthropic";
  const key = (provider === "groq" ? s.groqKey : (s.anthropicKey || s.apiKey)) || "";
  if (!key.trim()) return { ok: false, error: "no-key", provider };
  const sys = (payload && payload.system) || SYSTEM;

  try {
    if (provider === "groq") {
      const model = s.groqModel || DEFAULTS.groqModel;
      const messages = [{ role: "system", content: sys }].concat(payload.messages.map(toOpenAI));
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + key.trim() },
        body: JSON.stringify({ model, max_tokens: 2000, messages })
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: "api", provider, message: (data && data.error && data.error.message) || ("HTTP " + res.status) };
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return { ok: true, text: (text || "").trim() || "(No answer returned.)" };
    } else {
      const model = s.anthropicModel || s.model || DEFAULTS.anthropicModel;
      const messages = payload.messages.map(toAnthropic);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key.trim(), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2000, system: sys, messages })
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: "api", provider, message: (data && data.error && data.error.message) || ("HTTP " + res.status) };
      const text = Array.isArray(data.content) ? data.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim() : "";
      return { ok: true, text: text || "(No answer returned.)" };
    }
  } catch (err) {
    return { ok: false, error: "network", provider, message: String(err && err.message || err) };
  }
});

// List the Groq models this key can actually use (for the Settings picker).
ipcMain.handle("groq:models", async () => {
  const s = readSettings();
  const key = (s.groqKey || "").trim();
  if (!key) return { ok: false, message: "No Groq key entered." };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { "authorization": "Bearer " + key } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: (data && data.error && data.error.message) || ("HTTP " + res.status) };
    const ids = Array.isArray(data.data) ? data.data.map((m) => m.id).filter(Boolean).sort() : [];
    return { ok: true, ids };
  } catch (err) { return { ok: false, message: String(err && err.message || err) }; }
});

// Quick connectivity/key check for the Settings "Test" button.
ipcMain.handle("ai:test", async () => {
  const s = readSettings();
  const provider = s.provider === "groq" ? "groq" : "anthropic";
  const key = (provider === "groq" ? s.groqKey : s.anthropicKey) || "";
  if (!key.trim()) return { ok: false, message: "No " + (provider === "groq" ? "Groq" : "Claude") + " key entered." };
  try {
    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + key.trim() },
        body: JSON.stringify({ model: s.groqModel || DEFAULTS.groqModel, max_tokens: 5, messages: [{ role: "user", content: "ping" }] })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, message: "Groq key works." };
      return { ok: false, message: (data && data.error && data.error.message) || ("HTTP " + res.status) };
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key.trim(), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: s.anthropicModel || DEFAULTS.anthropicModel, max_tokens: 5, messages: [{ role: "user", content: "ping" }] })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, message: "Claude key works." };
      return { ok: false, message: (data && data.error && data.error.message) || ("HTTP " + res.status) };
    }
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }
});

app.whenReady().then(() => {
  configureGuestSession();
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
