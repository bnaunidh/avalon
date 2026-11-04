/* Injected into the page's real JS world (every frame). Controls YOUR OWN
 * outgoing media only: mute mic/camera (track.enabled), hide <video> on your
 * screen, or replace your camera with an uploaded image via a canvas stream.
 * Optionally taps the REMOTE (incoming) audio to produce live captions — the
 * audio is posted to the app, transcribed, and shown back; nothing is stored.
 * It never alters anyone else's feed. */
(function () {
  if (window.__cmbHook) return; window.__cmbHook = true;

  var state = { mic: true, cam: true, hideVid: false, cover: false, coverSrc: "", captions: false };
  var tracks = new Set();
  var pcs = new Set();
  var remoteAudio = new Set();
  var origByCover = new Map();
  var styleEl = null;
  var coverCanvas = null, coverImg = null, coverStream = null, coverTrack = null, coverSrcCur = "", coverTimer = null;
  // captions
  var capActive = false, capCtx = null, capDest = null, capRec = null, capCycle = null, capSources = new Map();

  function applyTracks() {
    tracks.forEach(function (t) {
      try {
        if (!t || t.readyState === "ended") { tracks.delete(t); return; }
        if (t.kind === "audio") t.enabled = state.mic;
        if (t.kind === "video") t.enabled = state.cam;
      } catch (e) {}
    });
    if (coverTrack) { try { coverTrack.enabled = state.cam; } catch (e) {} }
  }
  function applyHide() {
    try {
      if (state.hideVid && !styleEl) { styleEl = document.createElement("style"); styleEl.textContent = "video{visibility:hidden !important;}"; (document.head || document.documentElement).appendChild(styleEl); }
      else if (!state.hideVid && styleEl) { styleEl.remove(); styleEl = null; }
    } catch (e) {}
  }

  /* ---- Camera cover image ---- */
  function coverDraw() {
    try {
      if (coverCanvas && coverImg) {
        var ctx = coverCanvas.getContext("2d");
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, coverCanvas.width, coverCanvas.height);
        var iw = coverImg.naturalWidth || coverImg.width, ih = coverImg.naturalHeight || coverImg.height;
        if (iw && ih) { var r = Math.min(coverCanvas.width / iw, coverCanvas.height / ih); var w = iw * r, h = ih * r; ctx.drawImage(coverImg, (coverCanvas.width - w) / 2, (coverCanvas.height - h) / 2, w, h); }
      }
    } catch (e) {}
    coverTimer = setTimeout(coverDraw, 80);
  }
  function ensureCover() {
    if (!state.coverSrc) return;
    if (coverSrcCur === state.coverSrc && coverTrack) return;
    coverSrcCur = state.coverSrc;
    var img = new Image();
    img.onload = function () {
      coverImg = img;
      if (!coverCanvas) { coverCanvas = document.createElement("canvas"); coverCanvas.width = 640; coverCanvas.height = 480; }
      if (!coverTimer) coverDraw();
      if (!coverStream) { try { coverStream = coverCanvas.captureStream(12); coverTrack = coverStream.getVideoTracks()[0]; } catch (e) {} }
      applyCover(); applyTracks();
    };
    img.onerror = function () {};
    img.src = state.coverSrc;
  }
  function applyCover() {
    pcs.forEach(function (pc) {
      var ss; try { ss = pc.getSenders(); } catch (e) { return; }
      ss.forEach(function (s) {
        try {
          var cur = s.track;
          if (state.cover && coverTrack) {
            if (cur && cur.kind === "video" && cur !== coverTrack) { if (!origByCover.has(s)) origByCover.set(s, cur); s.replaceTrack(coverTrack); }
          } else if (origByCover.has(s)) {
            var o = origByCover.get(s); origByCover.delete(s); if (o) s.replaceTrack(o);
          }
        } catch (e) {}
      });
    });
  }

  /* ---- Live captions (remote audio -> app) ---- */
  function b64(blob, cb) {
    try { var fr = new FileReader(); fr.onload = function () { var r = fr.result || ""; var i = r.indexOf(","); cb(i >= 0 ? r.slice(i + 1) : ""); }; fr.onerror = function () { cb(""); }; fr.readAsDataURL(blob); }
    catch (e) { cb(""); }
  }
  function gatherRemote() {
    pcs.forEach(function (pc) { try { pc.getReceivers().forEach(function (r) { if (r.track && r.track.kind === "audio") remoteAudio.add(r.track); }); } catch (e) {} });
  }
  function buildMix() {
    try {
      if (!capCtx) { capCtx = new (window.AudioContext || window.webkitAudioContext)(); capDest = capCtx.createMediaStreamDestination(); }
      if (capCtx.state === "suspended") { try { capCtx.resume(); } catch (e) {} }
      remoteAudio.forEach(function (t) {
        if (!capSources.has(t) && t.readyState !== "ended") {
          try { var src = capCtx.createMediaStreamSource(new MediaStream([t])); src.connect(capDest); capSources.set(t, src); } catch (e) {}
        }
      });
    } catch (e) {}
  }
  function pickMime() {
    var list = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
    for (var i = 0; i < list.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return "";
  }
  function recCycle() {
    if (!capActive) return;
    gatherRemote(); buildMix();
    if (!capDest || capSources.size === 0) { capCycle = setTimeout(recCycle, 1500); return; }
    try {
      var mime = pickMime();
      capRec = mime ? new MediaRecorder(capDest.stream, { mimeType: mime }) : new MediaRecorder(capDest.stream);
      var chunks = [];
      capRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      capRec.onstop = function () {
        if (chunks.length) {
          var mt = (capRec && capRec.mimeType) || "audio/webm";
          var blob = new Blob(chunks, { type: mt });
          b64(blob, function (s) { if (s) { try { window.postMessage({ source: "cmb", kind: "caption", mime: mt, b64: s }, "*"); } catch (e) {} } });
        }
        if (capActive) recCycle();
      };
      capRec.start();
      capCycle = setTimeout(function () { try { if (capRec && capRec.state !== "inactive") capRec.stop(); } catch (e) {} }, 6000);
    } catch (e) { capCycle = setTimeout(recCycle, 2000); }
  }
  function startCap() { if (capActive) return; capActive = true; gatherRemote(); buildMix(); recCycle(); }
  function stopCap() { capActive = false; clearTimeout(capCycle); try { if (capRec && capRec.state !== "inactive") capRec.stop(); } catch (e) {} }

  function apply() {
    ensureCover(); applyTracks(); applyHide(); applyCover();
    if (state.captions && !capActive) startCap();
    else if (!state.captions && capActive) stopCap();
  }

  /* ---- Hooks ---- */
  try {
    var md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      var gum = md.getUserMedia.bind(md);
      md.getUserMedia = function (c) {
        return gum(c).then(function (st) {
          try { st.getTracks().forEach(function (t) { tracks.add(t); t.addEventListener("ended", function () { tracks.delete(t); }); }); } catch (e) {}
          applyTracks(); return st;
        });
      };
    }
  } catch (e) {}

  try {
    var RP = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (RP) {
      var Patched = function (a, b) {
        var pc = new RP(a, b);
        try { pcs.add(pc); } catch (e) {}
        try { pc.addEventListener("track", function (ev) { if (ev.track && ev.track.kind === "audio") { remoteAudio.add(ev.track); if (capActive) buildMix(); } }); } catch (e) {}
        return pc;
      };
      Patched.prototype = RP.prototype;
      try { Object.setPrototypeOf(Patched, RP); } catch (e) {}
      window.RTCPeerConnection = Patched;
      try { window.webkitRTCPeerConnection = Patched; } catch (e) {}
      var aT = RP.prototype.addTrack;
      if (aT) RP.prototype.addTrack = function () { var s = aT.apply(this, arguments); try { pcs.add(this); var t = arguments[0]; if (t) tracks.add(t); } catch (e) {} applyTracks(); applyCover(); return s; };
    }
  } catch (e) {}

  function read() { try { return JSON.parse(document.documentElement.getAttribute("data-cmb-av") || "{}"); } catch (e) { return {}; } }
  function sync() {
    var s = read();
    if ("mic" in s) state.mic = !!s.mic;
    if ("cam" in s) state.cam = !!s.cam;
    if ("hideVid" in s) state.hideVid = !!s.hideVid;
    if ("cover" in s) state.cover = !!s.cover;
    if ("coverSrc" in s) state.coverSrc = s.coverSrc || "";
    if ("captions" in s) state.captions = !!s.captions;
    apply();
  }
  try { new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-cmb-av"] }); } catch (e) {}
  sync();
  try { console.log("[CuemathBrowser] hook installed @ " + location.href); } catch (e) {}
})();
