"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");

contextBridge.exposeInMainWorld("desk", {
  // Absolute file:// path of the preload injected into the embedded site (for A/V control).
  sitePreload: "file://" + path.join(__dirname, "site-preload.js"),

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch)
  },

  ai: (payload) => ipcRenderer.invoke("ai:ask", payload),

  // Set desired A/V state; main broadcasts it to every frame of the embedded site.
  av: (state) => ipcRenderer.send("av:set", state),

  setFullScreen: (on) => ipcRenderer.invoke("window:fullscreen", on),
  openExternal: (url) => ipcRenderer.invoke("open-external", url)
});
