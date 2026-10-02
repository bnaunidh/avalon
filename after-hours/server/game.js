// Authoritative game simulation: items, doors, hiding, reviving and the monster AI.
import { T, F, DIFFICULTY, PA } from '../shared/constants.js';
import { generateSchool } from './mapgen.js';
import { los, walkMon, opaqueAt, angDiff } from '../shared/grid.js';
import { findPath } from './pathfind.js';

export const DT = 0.05;
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const rand = Math.random;

export class Game {
  constructor(roster, diffKey, io) {
    this.io = io;
    this.diffKey = DIFFICULTY[diffKey] ? diffKey : 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    this.seed = (rand() * 2 ** 31) >>> 0;
    const map = (this.map = generateSchool(this.seed, { players: roster.length, difficulty: this.diffKey }));
    this.items = map.items.map((it, i) => ({ id: i, k: it.k, x: it.x, y: it.y, taken: false }));
    this.nextItem = this.items.length;
    this.players = new Map();
    roster.forEach((lp, i) => {
      const sp = map.spawns[i % map.spawns.length];
      this.players.set(lp.id, {
        id: lp.id, name: lp.name, color: lp.color,
        x: sp.x + 0.5, y: sp.y + 0.5, a: rand() * Math.PI * 2,
        fl: true, cr: false, sp: false, mv: false, br: false,
        st: 'alive', h: -1, downT: 0, downs: 0, rvBy: null, rvT: 0,
        inv: { f: 0, c: 1, d: 0 }, stepT: 0, splashT: 0,
        stats: { fuses: 0, revives: 0, spotted: 0, downs: 0, escapedAt: 0, takenAt: 0 },
      });
    });
    this.fusesNeeded = map.fusesNeeded;
    this.fusesIn = 0;
    this.power = false;
    const count = roster.length >= 5 ? this.diff.monsters[1] : this.diff.monsters[0];
    this.monsters = [];
    for (let i = 0; i < count; i++) {
      const s = map.monsterSpawns[i % map.monsterSpawns.length];
      this.monsters.push(new Monster(this, i, s.x + 0.5, s.y + 0.5));
    }
    this.time = 0;
    this.calm = 0;
    this.clocks = [];
    this.clockId = 1;
    this.over = false;
    this.paQueue = [{ at: 2.5, text: PA.start }];
    this.nextPA = 70 + rand() * 30;
    this.scareT = 35 + rand() * 20;
    this.bellT = 140 + rand() * 80;
    this.lastLine = -1;
    this.awakeAnnounced = false;
  }

  // ---------- io helpers
  ev(o) {
    o.t = 'ev';
    this.io.broadcast(o);
  }
  pa(text, delay = 0) {
    this.paQueue.push({ at: this.time + delay, text });
  }

  startPayload(forId) {
    const m = this.map;
    return {
      t: 'start',
      you: forId,
      diff: this.diffKey,
      map: {
        w: m.w, h: m.h,
        tiles: Array.from(m.tiles), furn: Array.from(m.furn), fdir: Array.from(m.fdir), roomAt: Array.from(m.roomAt),
        rooms: m.rooms, doors: m.doors.map((d) => ({ x: d.x, y: d.y, ax: d.ax, open: d.open })),
        hides: m.hides, decor: m.decor, lights: m.lights, fusebox: m.fusebox, exit: m.exit, exitOpen: m.exitOpen,
      },
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, x: r2(p.x), y: r2(p.y), a: r2(p.a), st: p.st, h: p.h })),
      items: this.items.filter((i) => !i.taken).map((i) => ({ id: i.id, k: i.k, x: i.x, y: i.y })),
      monsters: this.monsters.map((mm) => ({ x: r2(mm.x), y: r2(mm.y), a: r2(mm.a), st: mm.state })),
      clocks: this.clocks.map((c) => ({ id: c.id, x: c.x, y: c.y, t: c.t })),
      fusesIn: this.fusesIn, fusesNeeded: this.fusesNeeded, power: this.power, time: this.time,
      downsAllowed: this.diff.downs,
    };
  }

  // ---------- client messages
  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p || this.over) return;
    switch (m.t) {
      case 'in': {
        if (p.st !== 'alive' && p.st !== 'down') return;
        p.a = num(m.a, p.a);
        p.br = !!m.br;
        p.fl = !!m.fl;
        if (p.h >= 0) return;
        const x = num(m.x, p.x);
        const y = num(m.y, p.y);
        if (x > 0 && y > 0 && x < this.map.w && y < this.map.h && Math.hypot(x - p.x, y - p.y) < 4) {
          p.x = x;
          p.y = y;
        }
        p.cr = !!m.cr;
        p.sp = !!m.sp && p.st === 'alive';
        p.mv = !!m.mv;
        break;
      }
      case 'door': this.toggleDoor(p, m.i | 0); break;
      case 'hide': this.hide(p, m.i | 0); break;
      case 'unhide': this.unhide(p); break;
      case 'pick': this.pick(p, m.i | 0); break;
      case 'fuse': this.insertFuses(p); break;
      case 'revive': this.reviveReq(p, m.id | 0, !!m.on); break;
      case 'throw': this.throwClock(p, num(m.x, p.x), num(m.y, p.y)); break;
      case 'drink':
        if (p.st === 'alive' && p.inv.d > 0) {
          p.inv.d--;
          this.ev({ e: 'drink', id: p.id });
        }
        break;
      case 'gasp':
        if (p.st === 'alive' && p.h >= 0) {
          this.noise(p.x, p.y, 6, 'gasp', { hide: p.h });
          this.ev({ e: 'noise', k: 'gasp', x: r2(p.x), y: r2(p.y), id: p.id });
        }
        break;
      default: break;
    }
  }

  doorBusy(d) {
    const cx = d.x + 0.5;
    const cy = d.y + 0.5;
    for (const p of this.players.values()) {
      if ((p.st === 'alive' || p.st === 'down') && p.h < 0 && Math.hypot(p.x - cx, p.y - cy) < 0.8) return true;
    }
    for (const m of this.monsters) if (Math.hypot(m.x - cx, m.y - cy) < 0.9) return true;
    return false;
  }

  setDoor(i, open, bang) {
    const d = this.map.doors[i];
    if (!d || d.open === open) return;
    d.open = open;
    this.ev({ e: 'door', i, o: open ? 1 : 0, b: bang ? 1 : 0 });
  }

  toggleDoor(p, i) {
    const d = this.map.doors[i];
    if (!d || p.st !== 'alive' || p.h >= 0) return;
    if (Math.hypot(p.x - (d.x + 0.5), p.y - (d.y + 0.5)) > 2.0) return;
    if (d.open && this.doorBusy(d)) return;
    this.setDoor(i, !d.open, false);
    this.noise(d.x + 0.5, d.y + 0.5, 5, 'door');
  }

  hidePlayer(i) {
    for (const p of this.players.values()) if (p.st === 'alive' && p.h === i) return p;
    return null;
  }

  hide(p, i) {
    const h = this.map.hides[i];
    if (!h || p.st !== 'alive' || p.h >= 0) return;
    if (Math.hypot(p.x - (h.fx + 0.5), p.y - (h.fy + 0.5)) > 1.5) return;
    if (this.hidePlayer(i)) return;
    p.h = i;
    p.x = h.fx + 0.5;
    p.y = h.fy + 0.5;
    p.sp = false;
    p.mv = false;
    this.ev({ e: 'hidden', id: p.id, h: i, x: p.x, y: p.y });
    this.noise(p.x, p.y, 3, 'locker');
    for (const m of this.monsters) if (m.sawHiding(p)) m.startGrab(i);
  }

  unhide(p) {
    if (p.h < 0) return;
    const h = this.map.hides[p.h];
    p.h = -1;
    p.x = h.fx + 0.5;
    p.y = h.fy + 0.5;
    this.ev({ e: 'hidden', id: p.id, h: -1, x: p.x, y: p.y });
    this.noise(p.x, p.y, 3, 'locker');
  }

  pick(p, i) {
    const it = this.items.find((q) => q.id === i);
    if (!it || it.taken || p.st !== 'alive' || p.h >= 0) return;
    if (Math.hypot(p.x - it.x, p.y - it.y) > 1.3) return;
    it.taken = true;
    if (it.k === 'fuse') p.inv.f++;
    else if (it.k === 'clock') p.inv.c++;
    else if (it.k === 'drink') p.inv.d++;
    this.ev({ e: 'pick', i, by: p.id, k: it.k });
  }

  insertFuses(p) {
    const fb = this.map.fusebox;
    if (!fb || p.st !== 'alive' || p.inv.f <= 0 || this.power) return;
    if (Math.hypot(p.x - (fb.fx + 0.5), p.y - (fb.fy + 0.5)) > 2.0) return;
    const n = p.inv.f;
    p.inv.f = 0;
    p.stats.fuses += n;
    this.fusesIn = Math.min(this.fusesNeeded, this.fusesIn + n);
    this.noise(fb.fx + 0.5, fb.fy + 0.5, 10, 'fuse');
    this.ev({ e: 'fuse', n: this.fusesIn, need: this.fusesNeeded, by: p.id });
    if (this.fusesIn >= this.fusesNeeded) this.powerOn();
  }

  powerOn() {
    this.power = true;
    this.map.exitOpen = true;
    for (const m of this.monsters) {
      m.frenzy = true;
      m.senseT = 3;
    }
    this.ev({ e: 'power' });
    this.pa(PA.power, 1.5);
  }

  reviveReq(p, targetId, on) {
    const t = this.players.get(targetId);
    if (!t || t.st !== 'down') return;
    if (on) {
      if (p.st !== 'alive' || p.h >= 0 || p === t) return;
      if (Math.hypot(p.x - t.x, p.y - t.y) > 1.8) return;
      if (t.rvBy !== p.id) t.rvT = 0;
      t.rvBy = p.id;
    } else if (t.rvBy === p.id) {
      t.rvBy = null;
      t.rvT = 0;
    }
  }

  throwClock(p, tx, ty) {
    if (p.st !== 'alive' || p.h >= 0 || p.inv.c <= 0) return;
    p.inv.c--;
    let dx = tx - p.x;
    let dy = ty - p.y;
    let d = Math.hypot(dx, dy);
    if (d < 0.01) {
      dx = Math.cos(p.a);
      dy = Math.sin(p.a);
      d = 1;
    } else {
      dx /= d;
      dy /= d;
    }
    d = Math.min(d, 8);
    let lx = p.x;
    let ly = p.y;
    for (let s = 0.1; s <= d; s += 0.1) {
      const x = p.x + dx * s;
      const y = p.y + dy * s;
      if (opaqueAt(this.map, Math.floor(x), Math.floor(y))) break;
      lx = x;
      ly = y;
    }
    const c = { id: this.clockId++, x: r2(lx), y: r2(ly), t: 9, nt: 0.5 };
    this.clocks.push(c);
    this.ev({ e: 'clock', id: c.id, x: c.x, y: c.y, fx: r2(p.x), fy: r2(p.y), dur: c.t });
  }

  noise(x, y, r, kind, extra = {}) {
    const playerMade = kind === 'run' || kind === 'walk' || kind === 'splash' || kind === 'gasp' || kind === 'door' || kind === 'locker';
    const n = { x, y, r: playerMade ? r * this.diff.hearing : r, kind, ...extra };
    for (const m of this.monsters) m.hear(n);
  }

  dropFuses(p) {
    if (p.inv.f <= 0) return;
    const dropped = [];
    for (let k = 0; k < p.inv.f; k++) {
      const it = { id: this.nextItem++, k: 'fuse', x: r2(p.x + (rand() - 0.5) * 0.4), y: r2(p.y + (rand() - 0.5) * 0.4), taken: false };
      this.items.push(it);
      dropped.push({ id: it.id, k: it.k, x: it.x, y: it.y });
    }
    p.inv.f = 0;
    this.ev({ e: 'drop', items: dropped });
  }

  downPlayer(p) {
    if (p.h >= 0) {
      const h = this.map.hides[p.h];
      p.h = -1;
      p.x = h.fx + 0.5;
      p.y = h.fy + 0.5;
    }
    p.stats.downs++;
    p.sp = false;
    this.noise(p.x, p.y, 12, 'scream');
    if (p.downs >= this.diff.downs) {
      p.downs++;
      this.ev({ e: 'down', id: p.id, x: r2(p.x), y: r2(p.y), fatal: 1 });
      this.take(p);
    } else {
      p.downs++;
      p.st = 'down';
      p.downT = 45;
      p.rvBy = null;
      p.rvT = 0;
      this.ev({ e: 'down', id: p.id, x: r2(p.x), y: r2(p.y), fatal: 0 });
    }
  }

  take(p) {
    p.st = 'taken';
    p.h = -1;
    p.stats.takenAt = this.time;
    this.dropFuses(p);
    this.ev({ e: 'taken', id: p.id });
    if (rand() < 0.6) this.pa(PA.taken, 3);
  }

  escape(p) {
    p.st = 'escaped';
    p.h = -1;
    p.stats.escapedAt = this.time;
    this.ev({ e: 'escaped', id: p.id });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.st === 'alive' || p.st === 'down') this.dropFuses(p);
    for (const q of this.players.values()) if (q.rvBy === id) q.rvBy = null;
    this.players.delete(id);
    this.ev({ e: 'left', id });
  }

  isExit(p) {
    const ex = this.map.exit;
    return p.y >= ex.y - 0.05 && p.x >= ex.x0 && p.x <= ex.x1 + 1;
  }

  awareOf(p) {
    let a = 0;
    for (const m of this.monsters) a = Math.max(a, m.aw.get(p.id) || 0);
    return a;
  }

  chasing(p) {
    return this.monsters.some((m) => m.state === 'chase' && m.target === p.id);
  }

  randomNear(c, r) {
    const m = this.map;
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(c.x + (rand() * 2 - 1) * r);
      const y = Math.floor(c.y + (rand() * 2 - 1) * r);
      if (walkMon(m, x, y) && m.tiles[y * m.w + x] !== T.DOOR) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: c.x, y: c.y };
  }

  passMon(x, y) {
    const m = this.map;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!walkMon(m, tx, ty)) return false;
    const i = ty * m.w + tx;
    return !(m.tiles[i] === T.DOOR && !m.doors[m.doorAt[i]].open);
  }

  clearLine(x0, y0, x1, y1, r) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return true;
    const ux = dx / d;
    const uy = dy / d;
    const px = -uy * r;
    const py = ux * r;
    for (let s = 0; s <= d; s += 0.2) {
      const x = x0 + ux * s;
      const y = y0 + uy * s;
      if (!this.passMon(x, y) || !this.passMon(x + px, y + py) || !this.passMon(x - px, y - py)) return false;
    }
    return this.passMon(x1, y1);
  }

  // ---------- main loop
  tick() {
    if (this.over) return;
    const dt = DT;
    this.time += dt;
    this.calm += dt;
    const map = this.map;

    for (const p of this.players.values()) {
      if (p.st === 'alive' && p.h < 0) {
        p.stepT -= dt;
        if (p.mv && p.stepT <= 0) {
          if (p.sp) {
            this.noise(p.x, p.y, 8.5, 'run');
            p.stepT = 0.3;
          } else if (!p.cr) {
            this.noise(p.x, p.y, 2.4, 'walk');
            p.stepT = 0.5;
          } else {
            p.stepT = 0.5;
          }
        }
        p.splashT -= dt;
        const fi = map.furn[Math.floor(p.y) * map.w + Math.floor(p.x)];
        if (fi === F.PUDDLE && p.mv && !p.cr && p.splashT <= 0) {
          this.noise(p.x, p.y, 7, 'splash');
          this.ev({ e: 'noise', k: 'splash', x: r2(p.x), y: r2(p.y), id: p.id });
          p.splashT = 0.7;
        }
        if (this.power && this.isExit(p)) this.escape(p);
      } else if (p.st === 'alive' && p.h >= 0) {
        // Breathing in a hiding spot gives you away if the monster is right outside.
        for (const m of this.monsters) {
          if (!m.active() || m.state === 'grab' || m.state === 'feed') continue;
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < 2.6 && !p.br && rand() < 0.32 * dt * this.diff.hearing) m.startGrab(p.h);
        }
      } else if (p.st === 'down') {
        p.downT -= dt;
        if (this.power && this.isExit(p)) {
          this.escape(p);
          continue;
        }
        if (p.rvBy != null) {
          const r = this.players.get(p.rvBy);
          if (r && r.st === 'alive' && r.h < 0 && Math.hypot(r.x - p.x, r.y - p.y) < 1.9) {
            p.rvT += dt;
            if (p.rvT >= 3) {
              p.st = 'alive';
              p.rvBy = null;
              p.rvT = 0;
              r.stats.revives++;
              this.ev({ e: 'revived', id: p.id, by: r.id });
            }
          } else {
            p.rvBy = null;
            p.rvT = 0;
          }
        }
        if (p.st === 'down' && p.downT <= 0) this.take(p);
      }
    }

    for (const m of this.monsters) m.update(dt);

    for (const c of this.clocks) {
      c.t -= dt;
      c.nt -= dt;
      if (c.nt <= 0) {
        this.noise(c.x, c.y, 24, 'clock', { pri: 6 });
        c.nt = 1;
      }
    }
    this.clocks = this.clocks.filter((c) => c.t > 0);

    // Atmosphere: PA announcements, poltergeist doors, the school bell.
    for (const q of this.paQueue) {
      if (q.at <= this.time) {
        this.ev({ e: 'pa', text: q.text });
        q.done = true;
      }
    }
    this.paQueue = this.paQueue.filter((q) => !q.done);
    if (!this.awakeAnnounced && this.monsters.some((m) => m.active())) {
      this.awakeAnnounced = true;
      this.pa(PA.awake, 2);
    }
    this.nextPA -= dt;
    if (this.nextPA <= 0) {
      this.nextPA = 60 + rand() * 45;
      let i = Math.floor(rand() * PA.random.length);
      if (i === this.lastLine) i = (i + 1) % PA.random.length;
      this.lastLine = i;
      this.pa(PA.random[i]);
    }
    this.scareT -= dt;
    if (this.scareT <= 0) {
      this.scareT = 30 + rand() * 30;
      this.poltergeist();
    }
    this.bellT -= dt;
    if (this.bellT <= 0) {
      this.bellT = 160 + rand() * 120;
      this.ev({ e: 'bell' });
    }

    // End conditions.
    const ps = [...this.players.values()];
    const standing = ps.filter((p) => p.st === 'alive').length;
    const downed = ps.filter((p) => p.st === 'down').length;
    if (!ps.length || (standing === 0 && (!this.power || downed === 0))) {
      for (const p of ps) if (p.st === 'down') p.st = 'taken';
      this.end();
      return;
    }

    this.io.broadcast(this.snapshot());
  }

  poltergeist() {
    const alive = [...this.players.values()].filter((p) => p.st === 'alive');
    if (!alive.length) return;
    const p = alive[Math.floor(rand() * alive.length)];
    const near = this.map.doors
      .map((d, i) => ({ d, i, dist: Math.hypot(d.x + 0.5 - p.x, d.y + 0.5 - p.y) }))
      .filter((o) => o.dist > 5 && o.dist < 13);
    if (!near.length) return;
    const o = near[Math.floor(rand() * near.length)];
    if (o.d.open) {
      if (!this.doorBusy(o.d)) this.setDoor(o.i, false, true);
    } else {
      this.setDoor(o.i, true, false);
    }
  }

  snapshot() {
    const p = [];
    for (const q of this.players.values()) {
      p.push({
        id: q.id, x: r2(q.x), y: r2(q.y), a: r2(q.a),
        fl: q.fl ? 1 : 0, cr: q.cr ? 1 : 0, sp: q.sp ? 1 : 0, mv: q.mv ? 1 : 0,
        st: q.st, h: q.h, inv: [q.inv.f, q.inv.c, q.inv.d],
        dt: q.st === 'down' ? r1(q.downT) : 0,
        rv: q.rvBy != null ? r2(q.rvT / 3) : 0,
        aw: r2(Math.min(1, this.awareOf(q))),
        ch: this.chasing(q) ? 1 : 0,
        dn: q.downs,
      });
    }
    const m = this.monsters.map((mm) => ({ x: r2(mm.x), y: r2(mm.y), a: r2(mm.a), st: mm.state, tg: mm.state === 'chase' ? mm.target : -1 }));
    return { t: 's', tm: r1(this.time), p, m, f: this.fusesIn };
  }

  results() {
    const ps = [...this.players.values()];
    const out = ps.map((p) => ({
      id: p.id, name: p.name, color: p.color,
      fate: p.st === 'escaped' ? 'escaped' : 'taken',
      stats: p.stats, title: '',
    }));
    const by = (f) => [...out].sort((a, b) => f(b) - f(a))[0];
    const give = (r, t) => {
      if (r && !r.title) r.title = t;
    };
    if (out.length) {
      const mostFuses = by((r) => r.stats.fuses);
      if (mostFuses.stats.fuses > 0) give(mostFuses, 'Teacher\'s Pet');
      const medic = by((r) => r.stats.revives);
      if (medic.stats.revives > 0) give(medic, 'School Nurse');
      const ghost = out.find((r) => r.fate === 'escaped' && r.stats.spotted === 0);
      give(ghost, 'Hall Pass');
      const clown = by((r) => r.stats.spotted);
      if (clown.stats.spotted > 1) give(clown, 'Class Clown');
      const taken = out.filter((r) => r.fate === 'taken').sort((a, b) => a.stats.takenAt - b.stats.takenAt);
      give(taken[0], 'First Period');
      for (const r of out) give(r, r.fate === 'escaped' ? 'Survivor' : 'Permanent Detention');
    }
    return out;
  }

  end() {
    if (this.over) return;
    this.over = true;
    const results = this.results();
    const won = results.some((r) => r.fate === 'escaped');
    this.io.onEnd({ t: 'end', won, results, time: r1(this.time), fusesIn: this.fusesIn, fusesNeeded: this.fusesNeeded });
  }
}

// ======================================================================
// The Hall Monitor
// ======================================================================
const BASE_SPEED = { patrol: 2.0, investigate: 3.2, search: 2.4, chase: 4.35, grab: 3.8 };

class Monster {
  constructor(g, i, x, y) {
    this.g = g;
    this.i = i;
    this.x = x;
    this.y = y;
    this.a = rand() * Math.PI * 2;
    this.state = 'dormant';
    this.t = g.diff.dormant + i * 18;
    this.goal = null;
    this.goalPri = 0;
    this.path = null;
    this.pi = 0;
    this.pathGoal = -1;
    this.repathT = 0;
    this.aw = new Map();
    this.target = -1;
    this.lastSeen = null;
    this.lostT = 0;
    this.doorWait = 0;
    this.doorIdx = -1;
    this.idleT = 0;
    this.grabHide = -1;
    this.searchC = null;
    this.frenzy = false;
    this.senseT = 8;
    this.stuckT = 0;
    this.stuckX = x;
    this.stuckY = y;
  }

  active() {
    return this.state !== 'dormant';
  }

  speed(kind) {
    let s = (BASE_SPEED[kind] || 2) * this.g.diff.speed * (1 + 0.035 * this.g.fusesIn);
    if (this.frenzy) s *= 1.15;
    return s;
  }

  setState(s) {
    this.state = s;
    this.path = null;
    this.goal = null;
    this.goalPri = 0;
    this.idleT = 0;
    this.doorWait = 0;
  }

  update(dt) {
    const g = this.g;
    if (this.state === 'dormant') {
      this.t -= dt;
      if (this.t <= 0 || g.power) {
        this.setState('patrol');
        g.ev({ e: 'awake', m: this.i, x: r2(this.x), y: r2(this.y) });
      }
      return;
    }
    if (this.state === 'feed') {
      this.t -= dt;
      if (this.t <= 0) this.setState('patrol');
      return;
    }
    this.perceive(dt);
    if (this.frenzy && (this.state === 'patrol' || this.state === 'search')) {
      this.senseT -= dt;
      if (this.senseT <= 0) {
        this.senseT = 9;
        let best = null;
        let bd = 1e9;
        for (const p of g.players.values()) {
          if (p.st !== 'alive' || p.h >= 0) continue;
          const d = Math.hypot(p.x - this.x, p.y - this.y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          this.setState('investigate');
          this.goal = { x: best.x, y: best.y };
          this.goalPri = 3;
        }
      }
    }
    switch (this.state) {
      case 'patrol': this.doPatrol(dt); break;
      case 'investigate':
        if (this.moveTo(this.goal, this.speed('investigate'), dt)) this.beginSearch(this.goal || this, 6);
        break;
      case 'search': this.doSearch(dt); break;
      case 'chase': this.doChase(dt); break;
      case 'grab': this.doGrab(dt); break;
      default: break;
    }
    this.checkStuck(dt);
  }

  checkStuck(dt) {
    this.stuckT += dt;
    if (this.stuckT < 2.5) return;
    const moved = Math.hypot(this.x - this.stuckX, this.y - this.stuckY);
    this.stuckT = 0;
    this.stuckX = this.x;
    this.stuckY = this.y;
    if (moved > 0.3 || this.idleT > 0 || this.doorWait > 0) return;
    if (this.state === 'patrol' || this.state === 'search' || this.state === 'investigate') {
      this.setState('patrol');
    } else {
      this.path = null;
    }
  }

  doPatrol(dt) {
    if (this.idleT > 0) {
      this.idleT -= dt;
      this.a += Math.sin(this.g.time * 1.7 + this.i * 3) * dt * 1.6;
      return;
    }
    if (!this.goal) this.goal = this.pickPatrolGoal();
    if (this.moveTo(this.goal, this.speed('patrol'), dt)) {
      this.goal = null;
      this.path = null;
      this.idleT = 0.8 + rand() * 1.8;
    }
  }

  pickPatrolGoal() {
    const g = this.g;
    const alive = [...g.players.values()].filter((p) => p.st === 'alive');
    const bias = g.power ? 0.9 : Math.min(0.85, 0.5 + g.calm * 0.004);
    if (alive.length && rand() < bias) {
      const p = alive[Math.floor(rand() * alive.length)];
      return g.randomNear(p, g.power ? 4 : 9);
    }
    const rooms = g.map.rooms;
    const r = rooms[Math.floor(rand() * rooms.length)];
    return g.randomNear({ x: (r.x0 + r.x1) / 2 + 0.5, y: (r.y0 + r.y1) / 2 + 0.5 }, 2);
  }

  beginSearch(c, dur) {
    this.setState('search');
    this.searchC = { x: c.x, y: c.y };
    this.t = dur;
  }

  doSearch(dt) {
    this.t -= dt;
    if (this.t <= 0) {
      this.setState('patrol');
      return;
    }
    if (this.idleT > 0) {
      this.idleT -= dt;
      this.a += dt * 2.4 * (this.i % 2 ? 1 : -1);
      return;
    }
    if (!this.goal) this.goal = this.g.randomNear(this.searchC, 4.5);
    if (this.moveTo(this.goal, this.speed('search'), dt)) {
      this.goal = null;
      this.idleT = 0.4 + rand() * 0.9;
    }
  }

  startChase(p) {
    const was = this.state === 'chase';
    this.setState('chase');
    this.target = p.id;
    this.lastSeen = { x: p.x, y: p.y };
    this.lostT = 0;
    this.g.calm = 0;
    if (!was) {
      p.stats.spotted++;
      this.g.ev({ e: 'screech', m: this.i, x: r2(this.x), y: r2(this.y), tg: p.id });
    }
  }

  doChase(dt) {
    const g = this.g;
    const p = g.players.get(this.target);
    if (!p || p.st !== 'alive') {
      this.beginSearch(this.lastSeen || this, 6);
      return;
    }
    if (p.h >= 0) {
      // They slipped into a hiding spot out of sight; sniff around where they vanished.
      this.beginSearch(this.lastSeen || this, 10);
      return;
    }
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    const visible = this.lostT === 0;
    if (visible && d < 0.8) {
      this.attack(p);
      return;
    }
    if (this.lostT > 5) {
      this.beginSearch(this.lastSeen, 10);
      return;
    }
    let spd = this.speed('chase');
    if (visible && d < 2.6) spd *= 1.22; // lunge
    if (visible && d < 7 && g.clearLine(this.x, this.y, p.x, p.y, 0.3)) {
      this.stepToward(p.x, p.y, spd, dt);
      this.path = null;
      return;
    }
    const arrived = this.moveTo(this.lastSeen, spd, dt);
    if (arrived && !visible) this.beginSearch(this.lastSeen, 10);
  }

  attack(p) {
    this.g.downPlayer(p);
    this.aw.set(p.id, 0);
    this.target = -1;
    this.setState('feed');
    this.t = 2.8;
  }

  sawHiding(p) {
    if (!this.active() || this.state === 'feed') return false;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > 14) return false;
    const chasingThem = this.state === 'chase' && this.target === p.id && this.lostT < 0.5;
    const suspicious = (this.aw.get(p.id) || 0) > 0.55;
    return (chasingThem || suspicious) && los(this.g.map, this.x, this.y, p.x, p.y);
  }

  startGrab(hideIdx) {
    if (!this.active() || this.state === 'feed' || this.state === 'grab') return;
    this.setState('grab');
    this.grabHide = hideIdx;
    this.g.calm = 0;
  }

  doGrab(dt) {
    const g = this.g;
    const h = g.map.hides[this.grabHide];
    if (!h) {
      this.setState('patrol');
      return;
    }
    const fx = h.fx + 0.5;
    const fy = h.fy + 0.5;
    const near = Math.hypot(fx - this.x, fy - this.y) < 0.7;
    if (near || this.moveTo({ x: fx, y: fy }, this.speed('grab'), dt)) {
      this.a = Math.atan2(h.y + 0.5 - this.y, h.x + 0.5 - this.x);
      const occ = g.hidePlayer(this.grabHide);
      g.ev({ e: 'grab', m: this.i, h: this.grabHide, hit: occ ? occ.id : -1 });
      if (occ) {
        g.downPlayer(occ);
        this.aw.set(occ.id, 0);
        this.setState('feed');
        this.t = 3;
      } else {
        this.beginSearch({ x: fx, y: fy }, 5);
      }
    }
  }

  perceive(dt) {
    const g = this.g;
    let best = null;
    let bestD = 1e9;
    for (const p of g.players.values()) {
      let a = this.aw.get(p.id) || 0;
      const isTarget = this.state === 'chase' && p.id === this.target;
      if (p.st !== 'alive' || p.h >= 0) {
        this.aw.set(p.id, Math.max(0, a - dt * 0.5));
        if (isTarget) this.lostT += dt;
        continue;
      }
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      let vis = false;
      let range = 0;
      if (d < 20) {
        const shining = p.fl && d < 12 && Math.abs(angDiff(p.a, Math.atan2(-dy, -dx))) < 0.5;
        range = p.cr ? 3.2 : 5.2;
        if (p.fl) range = 10.5;
        if (shining) range = 14;
        if (g.power) range += 2;
        if (isTarget) range = 20;
        const fov = Math.abs(angDiff(this.a, Math.atan2(dy, dx))) < (isTarget ? Math.PI : 1.25);
        if (d < range && (fov || shining || d < 2)) vis = los(g.map, this.x, this.y, p.x, p.y);
      }
      if (vis) {
        let rate;
        if (d < 1.6 || isTarget) rate = 50;
        else {
          rate = (0.5 + 1.9 * (1 - d / range)) * (p.fl ? 1.35 : 1) * (p.sp ? 1.5 : 1);
          if (this.state === 'investigate' || this.state === 'search' || this.frenzy) rate *= 1.6;
          if (p.cr && !p.fl) rate *= 0.6;
        }
        a = Math.min(1.5, a + rate * dt);
        if (a >= 1 && d < bestD) {
          bestD = d;
          best = p;
        }
        if (isTarget) {
          this.lastSeen = { x: p.x, y: p.y };
          this.lostT = 0;
        } else if (a > 0.35 && a < 1 && (this.state === 'patrol' || this.state === 'search')) {
          // "Did something move over there?"
          this.setState('investigate');
          this.goal = { x: p.x, y: p.y };
          this.goalPri = 4;
        }
      } else {
        a = Math.max(0, a - dt * 0.3);
        if (isTarget) this.lostT += dt;
      }
      this.aw.set(p.id, a);
    }
    if (best && (this.state !== 'chase' || (best.id !== this.target && this.lostT > 0))) this.startChase(best);
  }

  hear(n) {
    if (!this.active() || this.state === 'feed' || this.state === 'chase' || this.state === 'grab') return;
    const d = Math.hypot(n.x - this.x, n.y - this.y);
    if (d > n.r) return;
    let r = n.r;
    if (!los(this.g.map, this.x, this.y, n.x, n.y)) r *= 0.65;
    if (d > r) return;
    if (n.kind === 'gasp' && n.hide != null && d < 4.5) {
      this.startGrab(n.hide);
      return;
    }
    const pri = (n.pri || 0) + (r - d);
    if (this.state === 'investigate' && pri < this.goalPri - 1) return;
    if (this.state !== 'investigate') this.setState('investigate');
    this.goal = { x: n.x, y: n.y };
    this.goalPri = pri;
  }

  stepToward(tx, ty, spd, dt) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) this.a += angDiff(Math.atan2(dy, dx), this.a) * Math.min(1, dt * 9);
    const step = spd * dt;
    if (d <= step) {
      this.x = tx;
      this.y = ty;
      return true;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  // Returns true once the goal is reached (or unreachable).
  moveTo(goal, spd, dt) {
    const g = this.g;
    const m = g.map;
    if (!goal) return true;
    if (this.doorWait > 0) {
      this.doorWait -= dt;
      if (this.doorWait <= 0) {
        const d = m.doors[this.doorIdx];
        if (d && !d.open) g.setDoor(this.doorIdx, true, true);
      }
      return false;
    }
    if (Math.hypot(goal.x - this.x, goal.y - this.y) < 0.3) return true;
    this.repathT -= dt;
    const gk = Math.floor(goal.y) * m.w + Math.floor(goal.x);
    if (!this.path || this.repathT <= 0 || this.pathGoal !== gk) {
      this.path = findPath(m, Math.floor(this.x), Math.floor(this.y), Math.floor(goal.x), Math.floor(goal.y));
      this.pathGoal = gk;
      this.pi = 0;
      this.repathT = this.state === 'chase' ? 0.4 : 3;
      if (!this.path) return true;
    }
    for (let k = 0; k < 4 && this.pi + 1 < this.path.length; k++) {
      const nx = this.path[this.pi + 1];
      if (g.clearLine(this.x, this.y, nx[0] + 0.5, nx[1] + 0.5, 0.32)) this.pi++;
      else break;
    }
    let tx;
    let ty;
    if (this.pi >= this.path.length) {
      tx = goal.x;
      ty = goal.y;
    } else {
      const node = this.path[this.pi];
      const ti = node[1] * m.w + node[0];
      if (m.tiles[ti] === T.DOOR) {
        const di = m.doorAt[ti];
        if (!m.doors[di].open) {
          this.doorWait = this.state === 'chase' ? 0.35 : 0.9;
          this.doorIdx = di;
          this.a = Math.atan2(node[1] + 0.5 - this.y, node[0] + 0.5 - this.x);
          return false;
        }
      }
      const last = this.pi === this.path.length - 1;
      tx = last && this.passMonGoal(goal) ? goal.x : node[0] + 0.5;
      ty = last && this.passMonGoal(goal) ? goal.y : node[1] + 0.5;
    }
    const reached = this.stepToward(tx, ty, spd, dt);
    if (reached && this.pi < this.path.length) this.pi++;
    if (this.pi >= this.path.length && reached) return true;
    return Math.hypot(goal.x - this.x, goal.y - this.y) < 0.3;
  }

  passMonGoal(goal) {
    return this.g.passMon(goal.x, goal.y);
  }
}
