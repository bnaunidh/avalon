"use strict";
const { app, BrowserWindow, session, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

const DEFAULTS = {
  provider: "anthropic",
  anthropicKey: "",
  groqKey: "",
  anthropicModel: "claude-sonnet-5-5",
  groqModel: "meta-llama/llama-4-scout-17b-16e-instruct",
  homepage: "https://www.cuemath.com/"
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

function createWindow() {
  win = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: "#ffffff",
    title: "Study Desk Browser",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.on("closed", () => { win = null; });
}

// Grant camera / mic / fullscreen to the embedded site so video calls work.
// Turning your OWN mic/camera off is done live in site-preload.js (track.enabled).
function configureGuestSession() {
  const ses = session.fromPartition("persist:web");
  const ALLOW = new Set(["media", "fullscreen", "clipboard-read", "clipboard-sanitized-write", "notifications", "pointerLock"]);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOW.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ALLOW.has(permission));
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

  try {
    if (provider === "groq") {
      const model = s.groqModel || DEFAULTS.groqModel;
      const messages = [{ role: "system", content: SYSTEM }].concat(payload.messages.map(toOpenAI));
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
        body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM, messages })
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
