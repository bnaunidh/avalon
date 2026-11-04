"use strict";
/*
 * Runs in the embedded site and EVERY iframe (nodeIntegrationInSubFrames).
 * Injects site-hook.js into the page's real JS world, relays desired A/V state
 * in (via a data-cmb-av attribute), and relays caption audio chunks out.
 */
const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

let HOOK = "";
try { HOOK = fs.readFileSync(path.join(__dirname, "site-hook.js"), "utf8"); } catch (e) { HOOK = ""; }

function install() {
  try {
    const root = document.documentElement;
    if (!root || !HOOK) return false;
    const s = document.createElement("script");
    s.textContent = HOOK;
    root.appendChild(s);
    s.remove();
    return true;
  } catch (e) { return false; }
}
function setAttr(st) { try { document.documentElement.setAttribute("data-cmb-av", JSON.stringify(st)); } catch (e) {} }

if (!install()) {
  const iv = setInterval(() => { if (install()) clearInterval(iv); }, 10);
  document.addEventListener("DOMContentLoaded", () => { install(); clearInterval(iv); });
}

// Desired A/V state in.
ipcRenderer.on("av", (e, st) => setAttr(st));
try { ipcRenderer.send("av:request"); } catch (e) {}

// Caption audio chunks out (posted by the injected hook via window.postMessage).
window.addEventListener("message", (ev) => {
  const d = ev && ev.data;
  if (d && d.source === "cmb" && d.kind === "caption" && d.b64) {
    try { ipcRenderer.send("caption:audio", { mime: d.mime, b64: d.b64 }); } catch (e) {}
  }
});

function announce() { try { ipcRenderer.sendToHost("av-ready"); } catch (e) {} }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
else announce();
