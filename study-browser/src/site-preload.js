"use strict";
/*
 * Runs in the embedded site and EVERY iframe (nodeIntegrationInSubFrames).
 * It injects a hook into the page's real JS world (so it works no matter how the
 * call SDK is bundled) that wraps getUserMedia and RTCPeerConnection. When you
 * turn your mic/camera off, the matching outgoing tracks are disabled — the call
 * stays connected but sends silence / a blank frame, exactly like pressing mute.
 * "Hide video" hides <video> elements on your screen only. It only affects your
 * own side and sends nothing anywhere.
 *
 * Desired state travels main process -> this preload (ipc 'av') -> a data-cmb-av
 * attribute on <html> -> the injected hook (via MutationObserver). Using a DOM
 * attribute keeps it working across the isolated/main world boundary.
 */
const { ipcRenderer } = require("electron");

const HOOK = "(function(){" +
  "if(window.__cmbHook)return;window.__cmbHook=true;" +
  "var state={mic:true,cam:true,hideVid:false};var tracks=new Set();var senders=new Set();var styleEl=null;" +
  "function applyTracks(){tracks.forEach(function(t){try{if(!t||t.readyState==='ended'){tracks.delete(t);return;}if(t.kind==='audio')t.enabled=state.mic;if(t.kind==='video')t.enabled=state.cam;}catch(e){}});" +
  "senders.forEach(function(s){try{var t=s&&s.track;if(t){if(t.kind==='audio')t.enabled=state.mic;if(t.kind==='video')t.enabled=state.cam;}}catch(e){}});}" +
  "function applyHide(){try{if(state.hideVid&&!styleEl){styleEl=document.createElement('style');styleEl.textContent='video{visibility:hidden !important;}';(document.head||document.documentElement).appendChild(styleEl);}else if(!state.hideVid&&styleEl){styleEl.remove();styleEl=null;}}catch(e){}}" +
  "function apply(){applyTracks();applyHide();}" +
  "try{var md=navigator.mediaDevices;if(md&&md.getUserMedia){var o=md.getUserMedia.bind(md);md.getUserMedia=function(c){return o(c).then(function(st){try{st.getTracks().forEach(function(t){tracks.add(t);t.addEventListener('ended',function(){tracks.delete(t);});});}catch(e){}applyTracks();return st;});};}}catch(e){}" +
  "try{var RP=window.RTCPeerConnection||window.webkitRTCPeerConnection;if(RP&&RP.prototype){var aT=RP.prototype.addTrack;if(aT)RP.prototype.addTrack=function(){var s=null;try{s=aT.apply(this,arguments);}catch(e){}try{if(s)senders.add(s);var t=arguments[0];if(t)tracks.add(t);}catch(e){}applyTracks();return s;};var aS=RP.prototype.addStream;if(aS)RP.prototype.addStream=function(st){try{st.getTracks().forEach(function(t){tracks.add(t);});}catch(e){}applyTracks();return aS.apply(this,arguments);};}}catch(e){}" +
  "function read(){try{return JSON.parse(document.documentElement.getAttribute('data-cmb-av')||'{}');}catch(e){return {};}}" +
  "function sync(){var s=read();if('mic' in s)state.mic=!!s.mic;if('cam' in s)state.cam=!!s.cam;if('hideVid' in s)state.hideVid=!!s.hideVid;apply();}" +
  "try{new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-cmb-av']});}catch(e){}" +
  "sync();" +
  "try{console.log('[CuemathBrowser] mic/cam hook installed @ '+location.href);}catch(e){}" +
  "})();";

function install() {
  try {
    const root = document.documentElement;
    if (!root) return false;
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

ipcRenderer.on("av", (e, st) => setAttr(st));
try { ipcRenderer.send("av:request"); } catch (e) {}

function announce() { try { ipcRenderer.sendToHost("av-ready"); } catch (e) {} }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
else announce();
