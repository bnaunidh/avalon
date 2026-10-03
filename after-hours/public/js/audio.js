// Every sound is synthesized with WebAudio, so there are no assets to load.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Sound {
  constructor() {
    this.ctx = null;
    this.lx = 0;
    this.ly = 0;
    this.losFn = null;
    this.hbT = 0;
    this.ambT = 8;
    this.whisperT = 12;
    this.siren = null;
    this.volume = 0.85;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.white = this.makeNoise(2, false);
    this.brown = this.makeNoise(4, true);
    this.dist = this.makeCurve(60);
    this.startAmbient();
    this.startChaseLayer();
  }

  get ok() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  makeNoise(seconds, brown) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  makeCurve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  // yaw: the direction the listener faces (map angle); sounds pan relative to it.
  setListener(x, y, losFn, yaw = -Math.PI / 2) {
    this.lx = x;
    this.ly = y;
    this.losFn = losFn;
    this.yaw = yaw;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---------- routing
  out(vol = 1) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    g.connect(this.master);
    return g;
  }

  out3d(x, y, vol = 1, maxD = 18) {
    if (!this.ok) return null;
    const dx = x - this.lx;
    const dy = y - this.ly;
    const d = Math.hypot(dx, dy);
    if (d > maxD) return null;
    const ctx = this.ctx;
    const muffled = this.losFn ? !this.losFn(x, y) : false;
    const g = ctx.createGain();
    g.gain.value = Math.pow(1 - d / maxD, 1.5) * vol * (muffled ? 0.7 : 1);
    let head = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      const yaw = this.yaw ?? -Math.PI / 2;
      p.pan.value = clamp((dx * -Math.sin(yaw) + dy * Math.cos(yaw)) / 7, -0.85, 0.85);
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    if (muffled) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.connect(g);
      head = lp;
    }
    return head;
  }

  noise(dest, t0, dur, { type = 'bandpass', f = 1000, q = 1, vol = 0.5, attack = 0.003, brown = false, f2 = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.white;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t0);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    src.loop = true;
    src.start(t0, Math.random() * (src.buffer.duration - 0.2));
    src.stop(t0 + dur + 0.05);
  }

  tone(dest, t0, dur, { type = 'sine', f = 440, f2 = 0, vol = 0.3, attack = 0.005, release = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    if (release) g.gain.setValueAtTime(vol, t0 + dur - release);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  // ---------- beds
  startAmbient() {
    const ctx = this.ctx;
    const air = ctx.createBufferSource();
    air.buffer = this.brown;
    air.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const ag = ctx.createGain();
    ag.gain.value = 0.11;
    air.connect(lp);
    lp.connect(ag);
    ag.connect(this.master);
    air.start();
    this.drone = ctx.createGain();
    this.drone.gain.value = 0.0001;
    this.drone.connect(this.master);
    for (const [f, v] of [[55, 0.05], [55.7, 0.05], [82.4, 0.02], [116.5, 0.008]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      o.connect(g);
      g.connect(this.drone);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.35;
    lfo.connect(lg);
    lg.connect(this.drone.gain);
    lfo.start();
  }

  startChaseLayer() {
    const ctx = this.ctx;
    this.chase = ctx.createGain();
    this.chase.gain.value = 0;
    this.chase.connect(this.master);
    const bass = ctx.createOscillator();
    bass.type = 'sawtooth';
    bass.frequency.value = 43.65;
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 180;
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 2.6;
    const pg = ctx.createGain();
    pg.gain.value = 0.5;
    pulse.connect(pg);
    pg.connect(gate.gain);
    bass.connect(blp);
    blp.connect(gate);
    const bv = ctx.createGain();
    bv.gain.value = 0.35;
    gate.connect(bv);
    bv.connect(this.chase);
    for (const f of [1174.7, 1244.5, 1661]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const trem = ctx.createGain();
      trem.gain.value = 0.012;
      const l = ctx.createOscillator();
      l.frequency.value = 7 + Math.random() * 4;
      const lg = ctx.createGain();
      lg.gain.value = 0.01;
      l.connect(lg);
      lg.connect(trem.gain);
      o.connect(trem);
      trem.connect(this.chase);
      o.start();
      l.start();
    }
    bass.start();
    pulse.start();
  }

  // Called every frame. danger: 0..1 (how close the monster is), chase: 0..1
  update(dt, { danger = 0, chase = 0, dark = 0, hidden = false, active = true } = {}) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    this.chase.gain.setTargetAtTime(active ? chase * 0.9 : 0, now, 0.4);
    this.drone.gain.setTargetAtTime(active ? 0.5 + danger * 0.6 : 0.2, now, 1.5);
    const hb = Math.max(danger, chase * 0.9);
    this.hbT -= dt;
    if (active && hb > 0.12 && this.hbT <= 0) {
      const bpm = 62 + hb * 100;
      this.hbT = 60 / bpm;
      this.heartbeat(0.12 + hb * (hidden ? 0.75 : 0.5));
    }
    if (!active) return;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 14 + Math.random() * 26;
      this.distant();
    }
    this.whisperT -= dt * (0.4 + dark + danger * 1.5);
    if (this.whisperT <= 0) {
      this.whisperT = 18 + Math.random() * 25;
      this.whisper();
    }
  }

  // ---------- one-shots
  heartbeat(v) {
    const t = this.ctx.currentTime;
    const o = this.out(1);
    this.tone(o, t, 0.16, { f: 62, f2: 38, vol: v });
    this.tone(o, t + 0.2, 0.14, { f: 55, f2: 36, vol: v * 0.7 });
  }

  footstep(kind) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const v = kind === 2 ? 0.3 : kind === 1 ? 0.14 : 0.05;
    const o = this.out(1);
    this.noise(o, t, 0.07, { f: 300 + Math.random() * 400, q: 1.3, vol: v });
    this.tone(o, t, 0.06, { f: 95, f2: 50, vol: v * 0.6 });
  }

  footstepAt(x, y, kind) {
    const o = this.out3d(x, y, kind === 2 ? 0.9 : kind === 1 ? 0.45 : 0.15, 14);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.noise(o, t, 0.07, { f: 300 + Math.random() * 400, q: 1.3, vol: 0.35 });
    this.tone(o, t, 0.06, { f: 95, f2: 50, vol: 0.2 });
  }

  monsterStep(x, y, fast) {
    const o = this.out3d(x, y, fast ? 1.25 : 1, 24);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.tone(o, t, 0.2, { f: 58, f2: 32, vol: 0.75 });
    this.noise(o, t, 0.12, { type: 'lowpass', f: 300, vol: 0.4 });
    // the click of long fingers on tile
    this.noise(o, t + 0.05, 0.025, { type: 'highpass', f: 3800, vol: 0.32 });
    this.noise(o, t + 0.1, 0.02, { type: 'highpass', f: 4500, vol: 0.22 });
  }

  growl(x, y) {
    const o = this.out3d(x, y, 0.9, 16);
    if (!o) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.2 + Math.random() * 0.8;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(52 + Math.random() * 12, t);
    osc.frequency.linearRampToValueAtTime(40, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.Q.value = 6;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9 + Math.random() * 6;
    const lg = ctx.createGain();
    lg.gain.value = 0.25;
    lfo.connect(lg);
    lg.connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp);
    lp.connect(am);
    am.connect(env);
    env.connect(o);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
    this.noise(o, t, dur, { f: 700, q: 4, vol: 0.06, attack: 0.3 });
  }

  screech(x, y, loud = 1) {
    const o = x == null ? this.out(loud) : this.out3d(x, y, loud, 34);
    if (!o) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.dist;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.04);
    g.gain.setValueAtTime(0.32, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    shaper.connect(g);
    g.connect(o);
    for (const f of [820, 1190, 1560]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.7, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.25);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 1.5);
      const vib = ctx.createOscillator();
      vib.frequency.value = 23;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.04;
      vib.connect(vg);
      vg.connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = 0.12;
      osc.connect(og);
      og.connect(shaper);
      osc.start(t);
      vib.start(t);
      osc.stop(t + 1.6);
      vib.stop(t + 1.6);
    }
    this.noise(o, t, 1.3, { f: 2600, q: 1.5, vol: 0.25, attack: 0.03 });
  }

  jumpscare() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(1);
    this.screech(null, null, 1.1);
    this.noise(o, t, 0.9, { type: 'lowpass', f: 5000, vol: 0.9, attack: 0.001 });
    this.tone(o, t, 1.2, { f: 70, f2: 24, vol: 0.9, type: 'triangle' });
  }

  door(x, y, open, bang) {
    const o = this.out3d(x, y, bang ? 1.3 : 0.8, bang ? 30 : 18);
    if (!o) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (bang) {
      this.tone(o, t, 0.4, { f: 70, f2: 30, vol: 0.9 });
      this.noise(o, t, 0.35, { type: 'lowpass', f: 900, vol: 0.8, attack: 0.001 });
      this.noise(o, t + 0.03, 0.2, { f: 2400, q: 3, vol: 0.2 });
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 110 + Math.random() * 60;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.4, t + 0.25);
    osc.frequency.linearRampToValueAtTime(base * 0.9, t + 0.55);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(bp);
    bp.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.65);
    if (!open) this.tone(o, t + 0.5, 0.18, { f: 90, f2: 45, vol: 0.5 });
  }

  locker(x, y, hard = false) {
    const o = this.out3d(x, y, hard ? 1.3 : 0.8, hard ? 26 : 16);
    if (!o) return;
    const t = this.ctx.currentTime;
    const parts = [[420, 0.4], [1180, 0.25], [2230, 0.16], [3390, 0.1]];
    for (const [f, d] of parts) this.tone(o, t, d * (hard ? 1.6 : 1), { f: f * (0.95 + Math.random() * 0.1), vol: hard ? 0.18 : 0.1 });
    this.noise(o, t, 0.05, { type: 'highpass', f: 1500, vol: 0.4 });
    if (hard) this.tone(o, t, 0.3, { f: 80, f2: 40, vol: 0.8 });
  }

  pickup() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(1);
    this.tone(o, t, 0.12, { f: 880, vol: 0.12 });
    this.tone(o, t + 0.07, 0.18, { f: 1320, vol: 0.1 });
  }

  click() {
    if (!this.ok) return;
    this.noise(this.out(1), this.ctx.currentTime, 0.03, { type: 'highpass', f: 2500, vol: 0.3 });
  }

  fuse(x, y) {
    const o = this.out3d(x, y, 1, 30);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.noise(o, t, 0.15, { type: 'lowpass', f: 700, vol: 0.8, attack: 0.001 });
    this.tone(o, t + 0.05, 1.4, { type: 'sawtooth', f: 45, f2: 120, vol: 0.08 });
    this.noise(o, t + 0.1, 0.3, { type: 'highpass', f: 5000, vol: 0.15 });
  }

  powerOn() {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(1);
    this.noise(o, t, 0.5, { type: 'lowpass', f: 400, vol: 1, attack: 0.001 });
    this.tone(o, t, 2.5, { type: 'sawtooth', f: 30, f2: 60, vol: 0.12 });
    if (this.siren) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.9;
    const lg = ctx.createGain();
    lg.gain.value = 140;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.8);
    g.gain.linearRampToValueAtTime(0.045, t + 1.6);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    osc.start(t + 0.8);
    lfo.start(t + 0.8);
    this.siren = { osc, lfo, g };
  }

  stopSiren() {
    if (!this.siren) return;
    const t = this.ctx.currentTime;
    this.siren.g.gain.setTargetAtTime(0.0001, t, 0.2);
    this.siren.osc.stop(t + 1);
    this.siren.lfo.stop(t + 1);
    this.siren = null;
  }

  splash(x, y, self) {
    const o = self ? (this.ok ? this.out(0.8) : null) : this.out3d(x, y, 0.9, 16);
    if (!o) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 3; k++) this.noise(o, t + k * 0.05, 0.14, { f: 1200 + Math.random() * 900, q: 1.2, vol: 0.35 - k * 0.08 });
  }

  gasp(x, y) {
    const o = x == null ? (this.ok ? this.out(1) : null) : this.out3d(x, y, 1, 14);
    if (!o) return;
    const t = this.ctx.currentTime;
    this.noise(o, t, 0.45, { f: 1100, q: 2, vol: 0.5, attack: 0.04, f2: 700 });
    this.noise(o, t + 0.5, 0.6, { f: 800, q: 1.5, vol: 0.25, attack: 0.1 });
  }

  breath(v = 0.08) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.noise(this.out(1), t, 0.45, { f: 750, q: 1, vol: v, attack: 0.15 });
  }

  scream(x, y) {
    const o = this.out3d(x, y, 1.2, 30);
    if (!o) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.linearRampToValueAtTime(760, t + 0.25);
    osc.frequency.exponentialRampToValueAtTime(330, t + 1.1);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vg = ctx.createGain();
    vg.gain.value = 30;
    vib.connect(vg);
    vg.connect(osc.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    osc.connect(bp);
    bp.connect(g);
    g.connect(o);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 1.2);
    vib.stop(t + 1.2);
  }

  clockBeep(x, y) {
    const o = this.out3d(x, y, 0.8, 28);
    if (!o) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 4; k++) this.tone(o, t + k * 0.12, 0.07, { type: 'square', f: 2100, vol: 0.09, attack: 0.002 });
  }

  can() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(1);
    this.noise(o, t, 0.08, { type: 'highpass', f: 3000, vol: 0.4 });
    this.noise(o, t + 0.06, 0.5, { f: 4000, q: 0.7, vol: 0.12, attack: 0.02 });
  }

  bell() {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.05);
    g.gain.setValueAtTime(0.14, t + 2.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    lp.connect(g);
    g.connect(this.master);
    for (const f of [2350, 2620, 3110]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 24;
      const lg = ctx.createGain();
      lg.gain.value = 0.15;
      lfo.connect(lg);
      lg.connect(am.gain);
      o.connect(am);
      am.connect(lp);
      o.start(t);
      lfo.start(t);
      o.stop(t + 3.5);
      lfo.stop(t + 3.5);
    }
  }

  chime() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(1);
    [659, 523, 392].forEach((f, i) => this.tone(o, t + i * 0.42, 0.9, { f, vol: 0.11, attack: 0.01 }));
    for (let k = 0; k < 14; k++) this.noise(o, t + Math.random() * 1.4, 0.03, { type: 'highpass', f: 3000, vol: 0.05 });
  }

  speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.2;
      u.rate = 0.78;
      u.volume = 0.85;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((q) => /en[-_]/i.test(q.lang) && /male|david|daniel|fred|alex/i.test(q.name)) || voices.find((q) => /^en/i.test(q.lang));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      setTimeout(() => speechSynthesis.speak(u), 1300);
    } catch {
      /* speech is optional */
    }
  }

  distant() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createGain();
    o.gain.value = 0.5;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    o.connect(lp);
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      lp.connect(pan);
      pan.connect(this.master);
    } else lp.connect(this.master);
    const kind = Math.floor(Math.random() * 4);
    if (kind === 0) {
      this.tone(o, t, 0.5, { f: 60, f2: 35, vol: 0.5 });
      this.noise(o, t, 0.4, { type: 'lowpass', f: 500, vol: 0.4 });
    } else if (kind === 1) {
      for (let k = 0; k < 5; k++) this.tone(o, t + k * (0.6 + Math.random() * 0.5), 0.12, { f: 1300 + Math.random() * 500, f2: 900, vol: 0.1 });
    } else if (kind === 2) {
      this.tone(o, t, 2.2, { type: 'sawtooth', f: 75, f2: 55, vol: 0.12, attack: 0.5 });
      this.noise(o, t, 2, { f: 400, q: 6, vol: 0.12, attack: 0.6 });
    } else {
      this.locker(this.lx + (Math.random() - 0.5) * 30, this.ly + (Math.random() - 0.5) * 30);
    }
  }

  whisper() {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    if (pan) {
      pan.pan.value = Math.random() < 0.5 ? -0.9 : 0.9;
      g.connect(pan);
      pan.connect(this.master);
    } else g.connect(this.master);
    const syl = 3 + Math.floor(Math.random() * 5);
    let tt = t;
    for (let k = 0; k < syl; k++) {
      const d = 0.08 + Math.random() * 0.18;
      this.noise(g, tt, d, { f: 1800 + Math.random() * 2400, q: 4 + Math.random() * 4, vol: 0.05, attack: 0.03 });
      tt += d + Math.random() * 0.08;
    }
  }

  escape() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(1);
    [392, 494, 587, 784].forEach((f, i) => this.tone(o, t + i * 0.12, 1.6, { f, vol: 0.08, attack: 0.02 }));
    this.noise(o, t, 1.4, { type: 'lowpass', f: 600, f2: 3000, vol: 0.2, attack: 0.4 });
  }
}
