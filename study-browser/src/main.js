"use strict";
const { app, BrowserWindow, session, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
  } catch (e) {
    return { apiKey: "", model: "claude-sonnet-5-5", homepage: "https://www.cuemath.com/" };
  }
}
function writeSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#0e1520",
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

// Grant camera / microphone / fullscreen to the embedded site so video calls work.
// Turning your own mic/camera OFF is handled live in site-preload.js (track.enabled),
// which keeps the call connected but sends silence / a blank frame — exactly like a mute.
function configureGuestSession() {
  const ses = session.fromPartition("persist:web");
  const ALLOW = new Set(["media", "fullscreen", "clipboard-read", "clipboard-sanitized-write", "notifications"]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(ALLOW.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => ALLOW.has(permission));
}

// Any popup / target=_blank inside the embedded browser loads in the same view
// instead of spawning a chrome-less window.
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

ipcMain.handle("open-external", (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// The AI tutor: calls the Claude API from the main process (avoids browser CORS).
// Uses the user's own API key, stored locally. Non-streaming for robustness.
ipcMain.handle("ai:ask", async (e, payload) => {
  const settings = readSettings();
  const apiKey = (settings.apiKey || "").trim();
  if (!apiKey) return { ok: false, error: "no-key" };
  const model = (payload && payload.model) || settings.model || "claude-sonnet-5-5";
  const SYSTEM =
    "You are a warm, patient math tutor helping a student who is still learning. " +
    "Explain how to solve the problem step by step, showing the reasoning and naming the rule used at each step, " +
    "so the student understands the method and can handle the next one on their own. " +
    "Give the final answer as well, but always with the working that leads to it. " +
    "If an image is included, read the problem from it. Be clear, concise and encouraging; use plain language.";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 2000,
        system: SYSTEM,
        messages: payload.messages
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + res.status);
      return { ok: false, error: "api", message: msg };
    }
    const text = Array.isArray(data.content)
      ? data.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim()
      : "";
    return { ok: true, text: text || "(No answer returned.)" };
  } catch (err) {
    return { ok: false, error: "network", message: String(err && err.message || err) };
  }
});

app.whenReady().then(() => {
  configureGuestSession();
  // Minimal native menu so standard shortcuts (copy/paste, quit, devtools) work.
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
