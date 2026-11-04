"use strict";
/*
 * Injected into the embedded site AND every iframe (nodeIntegrationInSubFrames),
 * with contextIsolation disabled so it shares each frame's window and can wrap
 * getUserMedia wherever the video call actually runs.
 *
 * It lets YOU turn your OWN microphone and camera on/off: when off, the matching
 * tracks are disabled (track.enabled = false) — the call stays connected but sends
 * silence / a blank frame, exactly like pressing mute in the call. "Hide video"
 * hides <video> elements in this frame on your screen only. It only ever affects
 * your own side and sends nothing anywhere.
 */
const { ipcRenderer } = require("electron");

(function () {
  const state = { mic: true, cam: true, hideVid: false };
  const tracked = new Set();
  let styleEl = null;

  function applyTracks() {
    tracked.forEach((t) => {
      try {
        if (t.readyState === "ended") { tracked.delete(t); return; }
        if (t.kind === "audio") t.enabled = state.mic;
        if (t.kind === "video") t.enabled = state.cam;
      } catch (e) {}
    });
  }
  function applyHide() {
    try {
      if (state.hideVid && !styleEl) {
        styleEl = document.createElement("style");
        styleEl.textContent = "video{visibility:hidden !important;}";
        (document.head || document.documentElement).appendChild(styleEl);
      } else if (!state.hideVid && styleEl) {
        styleEl.remove(); styleEl = null;
      }
    } catch (e) {}
  }
  function apply() { applyTracks(); applyHide(); }

  function hook(md) {
    if (!md || typeof md.getUserMedia !== "function" || md.__sdHooked) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = function (constraints) {
      return orig(constraints).then((stream) => {
        stream.getTracks().forEach((t) => {
          tracked.add(t);
          t.addEventListener("ended", () => tracked.delete(t));
        });
        applyTracks();
        return stream;
      });
    };
    md.__sdHooked = true;
  }
  try { hook(navigator.mediaDevices); } catch (e) {}

  // Receive desired state from the main process (delivered to every frame).
  ipcRenderer.on("av", (event, s) => {
    if (s && typeof s === "object") Object.assign(state, s);
    apply();
  });

  // Pull the current state as soon as this frame loads.
  try { ipcRenderer.send("av:request"); } catch (e) {}

  // Let the toolbar know a hook is live somewhere (for user feedback).
  function announce() { try { ipcRenderer.sendToHost("av-ready"); } catch (e) {} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
  else announce();
})();
