"use strict";
/*
 * Injected into the embedded site (Cuemath, etc.). Runs with contextIsolation
 * disabled so it shares the page's window and can wrap getUserMedia.
 *
 * It lets YOU turn your OWN microphone and camera on/off: when off, the matching
 * tracks are disabled (track.enabled = false), which keeps the call connected but
 * sends silence / a blank frame — identical to pressing mute in the call itself.
 * It only ever affects your own outgoing media. It does not touch, read, or alter
 * anyone else's stream, and it sends nothing anywhere.
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

  try {
    const md = navigator.mediaDevices;
    if (md && typeof md.getUserMedia === "function") {
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
    }
  } catch (e) {}

  // Toolbar -> guest: { mic: bool, cam: bool }
  ipcRenderer.on("av", (event, s) => {
    if (s && typeof s === "object") Object.assign(state, s);
    apply();
  });
})();
