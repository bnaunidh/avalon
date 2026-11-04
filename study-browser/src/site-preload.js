"use strict";
/*
 * Injected into the embedded site (Cuemath, etc.). Runs with contextIsolation
 * disabled so it shares the page's window and can wrap getUserMedia.
 *
 * It lets YOU turn your OWN microphone and camera on/off: when off, the matching
 * tracks are disabled (track.enabled = false), which keeps the call connected but
 * sends silence / a blank frame — identical to pressing mute in the call itself.
 * It only ever affects your own outgoing media and sends nothing anywhere.
 */
const { ipcRenderer } = require("electron");

(function () {
  const state = { mic: true, cam: true };
  const tracked = new Set();

  function apply() {
    tracked.forEach((t) => {
      try {
        if (t.readyState === "ended") { tracked.delete(t); return; }
        if (t.kind === "audio") t.enabled = state.mic;
        if (t.kind === "video") t.enabled = state.cam;
      } catch (e) {}
    });
  }

  function hook(md) {
    if (!md || typeof md.getUserMedia !== "function" || md.__sdHooked) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = function (constraints) {
      return orig(constraints).then((stream) => {
        stream.getTracks().forEach((t) => {
          tracked.add(t);
          t.addEventListener("ended", () => tracked.delete(t));
        });
        apply();
        return stream;
      });
    };
    md.__sdHooked = true;
  }

  try { hook(navigator.mediaDevices); } catch (e) {}

  // Toolbar -> guest
  ipcRenderer.on("av", (event, s) => {
    if (s && typeof s === "object") Object.assign(state, s);
    apply();
  });

  // Tell the toolbar the A/V hook is live on this page.
  function announce() { try { ipcRenderer.sendToHost("av-ready"); } catch (e) {} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
  else announce();
  window.addEventListener("load", announce);
})();
