// Client: lobby UI, networking, local movement, interactions, HUD.
import { T, F, PLAYER, COLORS, DIFFICULTY, ITEM_NAMES } from '../shared/constants.js';
import { solidAt, los } from '../shared/grid.js';
import { Sound } from './audio.js';
import { Renderer } from './render.js';
import { LocalLink } from './local.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const R = new Renderer(canvas);
const A = new Sound();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const lerpAng = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

// Static hosting (GitHub Pages, file://) has no game server: run solo in the page.
const STATIC_HOST = location.protocol === 'file:' || location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('solo');
const S = {
  myId: null, screen: 'menu', ws: null, name: '', solo: STATIC_HOST,
  lobby: null, addrs: [],
  map: null, players: new Map(), monsters: [], items: [], clocks: [],
  me: null, specId: null,
  fusesIn: 0, fusesNeeded: 0, power: false, time: 0, t: 0, downsAllowed: 1,
  explored: null, exploredDirty: false, bubbles: new Map(),
  showMap: false, chatOpen: false, showHelp: false,
  cam: { x: 0, y: 0 }, shake: 0, flash: 0, chaseLevel: 0, flick: 1, flickT: 0,
  scare: null, target: null, view: null, awake: false,
};
const L = {};
function resetLocal() {
  Object.assign(L, {
    stamina: PLAYER.stamina, exhausted: false, restT: 0, battery: 100, fl: true, crouch: false,
    breath: PLAYER.breath, holding: false, gaspLock: 0, drinkT: 0, stepAcc: 0, reviving: null,
    sendT: 0, exploreT: 0, hudT: 0, breathT: 0, lastRoom: -2, lowWarned: false, dangerT: 0,
  });
}
resetLocal();
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };

// ------------------------------------------------------------------ screens
function showScreen(name) {
  S.screen = name;
  for (const id of ['menu', 'lobby', 'end', 'conn']) $(id).classList.toggle('hidden', id !== name);
  $('hud').classList.toggle('hidden', name !== 'game');
  canvas.style.visibility = name === 'game' ? 'visible' : 'hidden';
  if (name !== 'game') closeChat();
}

// ------------------------------------------------------------------ menu
let myColor = store.get('ah_color', COLORS[0]);
if (!COLORS.includes(myColor)) myColor = COLORS[0];
$('name').value = store.get('ah_name', '');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.title = c;
  b.onclick = () => {
    myColor = c;
    refreshSwatches();
  };
  b.dataset.c = c;
  $('colors').appendChild(b);
}
function refreshSwatches() {
  for (const b of $('colors').children) b.classList.toggle('on', b.dataset.c === myColor);
}
refreshSwatches();
$('join').onclick = () => join(STATIC_HOST);
$('solo').onclick = () => join(true);
$('soloInstead').onclick = () => {
  S.ws = null;
  join(true);
};
if (STATIC_HOST) {
  $('join').textContent = 'Enter the school (solo)';
  $('solo').classList.add('hidden');
  $('staticNote').classList.remove('hidden');
}
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join(STATIC_HOST);
});
$('reconnect').onclick = () => location.reload();
$('name').focus();

function join(solo) {
  A.init();
  S.solo = !!solo;
  const name = $('name').value.trim().slice(0, 16) || 'Student';
  store.set('ah_name', name);
  store.set('ah_color', myColor);
  S.name = name;
  $('join').disabled = true;
  connect(() => send({ t: 'join', name, color: myColor }));
}

// ------------------------------------------------------------------ lobby
for (const [k, d] of Object.entries(DIFFICULTY)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = d.label;
  $('diff').appendChild(o);
}
$('diff').onchange = () => send({ t: 'diff', v: $('diff').value });
$('readyBtn').onclick = () => {
  const me = S.lobby?.players.find((p) => p.id === S.myId);
  send({ t: 'ready', v: !me?.ready });
};
$('startBtn').onclick = () => {
  A.init();
  send({ t: 'start' });
};
$('lchatIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) send({ t: 'chat', m: v });
    e.target.value = '';
  }
});

function renderLobby() {
  const lb = S.lobby;
  if (!lb) return;
  const isHost = lb.host === S.myId;
  $('plist').innerHTML = lb.players
    .map(
      (p) =>
        `<li><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}${p.id === S.myId ? ' <i>(you)</i>' : ''}${
          p.id === lb.host ? ' <span title="host">★</span>' : ''
        }</span><span class="rd ${p.ready ? 'yes' : ''}">${p.ready ? 'READY' : 'waiting'}</span></li>`,
    )
    .join('');
  const me = lb.players.find((p) => p.id === S.myId);
  $('readyBtn').textContent = me?.ready ? 'Ready ✓' : 'I\'m ready';
  $('readyBtn').classList.toggle('on', !!me?.ready);
  $('startBtn').classList.toggle('hidden', !isHost);
  $('diff').value = lb.diff;
  $('diff').disabled = !isHost;
  const notReady = lb.players.filter((p) => !p.ready).length;
  let note;
  if (lb.phase === 'playing') note = 'A round is in progress. You will join the next one.';
  else if (lb.phase === 'results') note = 'Round finishing…';
  else if (isHost) note = notReady ? `You are the host. ${notReady} player(s) not ready — you can start anyway.` : 'Everyone is ready. Lock the doors.';
  else note = 'Waiting for the host to lock the doors…';
  $('lobbyNote').textContent = note;
  $('startBtn').disabled = lb.phase !== 'lobby';
  $('invite').classList.toggle('hidden', S.solo);
  $('readyBtn').classList.toggle('hidden', S.solo);
  $('soloNote').classList.toggle('hidden', !S.solo);
  const addrs = S.addrs.length ? S.addrs : [location.origin];
  $('addrs').innerHTML = addrs.map((a) => `<div>${esc(a)}</div>`).join('');
}

// ------------------------------------------------------------------ network
function connect(onOpen) {
  if (S.ws && S.ws.readyState <= 1) {
    onOpen();
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = S.solo ? new LocalLink() : new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = onOpen;
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    try {
      handle(m);
    } catch (err) {
      console.error(err);
    }
  };
  ws.onclose = () => {
    A.stopSiren();
    showScreen('conn');
  };
}
function send(o) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o));
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      S.myId = m.id;
      S.addrs = m.addrs || [];
      break;
    case 'lobby':
      S.lobby = m;
      renderLobby();
      if (S.screen === 'menu' || (S.screen === 'end' && m.phase === 'lobby') || (S.screen === 'game' && m.phase === 'lobby')) showScreen('lobby');
      break;
    case 'start':
      startRound(m);
      break;
    case 's':
      onSnap(m);
      break;
    case 'ev':
      onEvent(m);
      break;
    case 'chat':
      onChat(m);
      break;
    case 'end':
      onEnd(m);
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ round
function startRound(m) {
  const mp = m.map;
  const map = {
    w: mp.w, h: mp.h,
    tiles: Uint8Array.from(mp.tiles), furn: Uint8Array.from(mp.furn), fdir: Uint8Array.from(mp.fdir), roomAt: Int16Array.from(mp.roomAt),
    rooms: mp.rooms, doors: mp.doors, hides: mp.hides, decor: mp.decor, lights: mp.lights,
    fusebox: mp.fusebox, exit: mp.exit, exitOpen: !!mp.exitOpen,
  };
  map.doorAt = new Int16Array(map.w * map.h).fill(-1);
  map.doors.forEach((d, i) => {
    map.doorAt[d.y * map.w + d.x] = i;
  });
  S.map = map;
  S.players = new Map();
  for (const p of m.players) {
    S.players.set(p.id, {
      ...p, tx: p.x, ty: p.y, ta: p.a, fl: 1, cr: 0, sp: 0, mv: 0, inv: [0, 1, 0],
      downT: 0, rv: 0, aw: 0, ch: 0, dn: 0, walk: 0, stepAcc: 0,
    });
  }
  S.me = S.players.get(S.myId) || null;
  S.monsters = m.monsters.map((mm) => ({ ...mm, tx: mm.x, ty: mm.y, ta: mm.a, walk: 0, stepAcc: 0, growlT: 4 + Math.random() * 6 }));
  S.items = m.items.map((i) => ({ ...i, taken: false }));
  S.clocks = (m.clocks || []).map((c) => ({ ...c, beepT: 0 }));
  S.fusesIn = m.fusesIn;
  S.fusesNeeded = m.fusesNeeded;
  S.power = m.power;
  S.time = m.time;
  S.downsAllowed = m.downsAllowed;
  S.explored = new Uint8Array(map.w * map.h);
  S.exploredDirty = true;
  S.bubbles = new Map();
  S.scare = null;
  S.showMap = false;
  S.flash = 0;
  S.shake = 0;
  S.awake = m.monsters.some((mm) => mm.st !== 'dormant');
  S.specId = null;
  resetLocal();
  R.setMap(map);
  const v = S.me || [...S.players.values()][0] || { x: map.w / 2, y: map.h / 2 };
  S.cam.x = v.x;
  S.cam.y = v.y;
  $('chatlog').innerHTML = '';
  $('downmsg').classList.add('hidden');
  A.stopSiren();
  showScreen('game');
  if (S.me) {
    bigMsg('11:52 PM', 'You wake up in detention. The lights are out. The doors are locked.', 5);
    setTimeout(() => {
      if (S.screen === 'game') setHelp(true);
    }, 3500);
    setTimeout(() => setHelp(false), 18000);
  } else {
    toast('A round is in progress — you are watching. [Space] switches player.', 6);
  }
}

function onSnap(m) {
  if (!S.map) return;
  S.time = m.tm;
  S.fusesIn = m.f;
  for (const sp of m.p) {
    const p = S.players.get(sp.id);
    if (!p) continue;
    p.st = sp.st;
    p.inv = sp.inv;
    p.downT = sp.dt;
    p.rv = sp.rv;
    p.aw = sp.aw;
    p.ch = sp.ch;
    p.dn = sp.dn;
    p.h = sp.h;
    if (p === S.me) continue; // our own position is simulated locally
    p.tx = sp.x;
    p.ty = sp.y;
    p.ta = sp.a;
    p.fl = sp.fl;
    p.cr = sp.cr;
    p.sp = sp.sp;
    p.mv = sp.mv;
  }
  m.m.forEach((mm, i) => {
    const mo = S.monsters[i];
    if (!mo) return;
    mo.tx = mm.x;
    mo.ty = mm.y;
    mo.ta = mm.a;
    mo.st = mm.st;
    mo.tg = mm.tg;
  });
}

function onEvent(e) {
  const map = S.map;
  if (!map) return;
  const me = S.me;
  const P = (id) => S.players.get(id);
  switch (e.e) {
    case 'door': {
      const d = map.doors[e.i];
      if (!d) break;
      d.open = !!e.o;
      A.door(d.x + 0.5, d.y + 0.5, d.open, e.b);
      if (e.b) {
        const v = viewer();
        if (v && Math.hypot(v.x - d.x, v.y - d.y) < 10) S.shake = Math.max(S.shake, 6);
      }
      break;
    }
    case 'pick': {
      const it = S.items.find((i) => i.id === e.i);
      if (it) it.taken = true;
      if (e.by === S.myId) {
        if (e.k === 'battery') L.battery = Math.min(100, L.battery + PLAYER.batteryPack);
        A.pickup();
        const extra = { fuse: ' — bring it to the fuse box', clock: ' — [G] to throw', drink: ' — [Q] to drink', battery: '' }[e.k] || '';
        toast(`Picked up ${ITEM_NAMES[e.k]}${extra}`);
      }
      break;
    }
    case 'hidden': {
      const p = P(e.id);
      if (!p) break;
      p.h = e.h;
      if (e.x != null) {
        p.x = p.tx = e.x;
        p.y = p.ty = e.y;
      }
      A.locker(e.x, e.y);
      if (p === me) L.holding = false;
      break;
    }
    case 'down': {
      const p = P(e.id);
      if (!p) break;
      p.st = e.fatal ? 'taken' : 'down';
      p.h = -1;
      p.x = p.tx = e.x;
      p.y = p.ty = e.y;
      if (p === me) {
        stopRevive();
        S.scare = { t: 0, dur: 1.15, fatal: !!e.fatal };
        A.jumpscare();
      } else {
        A.scream(e.x, e.y);
        if (e.fatal) bigMsg(`${p.name} was taken.`, '');
        else bigMsg(`${p.name} was caught!`, 'Find them and hold [E] to revive.');
      }
      break;
    }
    case 'taken': {
      const p = P(e.id);
      if (!p) break;
      p.st = 'taken';
      if (p !== me) toast(`${p.name} is gone. Detention… forever.`);
      break;
    }
    case 'revived': {
      const p = P(e.id);
      const by = P(e.by);
      if (p) p.st = 'alive';
      if (p === me) {
        bigMsg('BACK ON YOUR FEET', (me.dn || 0) >= S.downsAllowed ? 'Next time it won\'t let go.' : 'Stay out of its sight.');
        L.stamina = PLAYER.stamina;
        $('downmsg').classList.add('hidden');
      } else if (by === me) toast(`You revived ${p?.name}.`);
      else toast(`${by?.name} revived ${p?.name}.`);
      break;
    }
    case 'fuse': {
      S.fusesIn = e.n;
      const fb = map.fusebox;
      if (fb) A.fuse(fb.fx + 0.5, fb.fy + 0.5);
      const by = P(e.by);
      if (e.n < e.need) bigMsg(`FUSE ${e.n} / ${e.need}`, by === me ? 'The panel clanks. That was loud…' : `${by?.name || 'Someone'} inserted a fuse.`, 3);
      break;
    }
    case 'power':
      S.power = true;
      map.exitOpen = true;
      A.powerOn();
      bigMsg('POWER RESTORED', 'The front doors are open. RUN.', 4);
      S.shake = 16;
      break;
    case 'escaped': {
      const p = P(e.id);
      if (p) p.st = 'escaped';
      if (p === me) {
        A.escape();
        A.stopSiren();
        bigMsg('YOU ESCAPED', 'Cold night air. You made it.', 5);
      } else toast(`${p?.name} made it out!`);
      break;
    }
    case 'screech':
      A.screech(e.x, e.y);
      if (e.tg === S.myId) {
        S.shake = Math.max(S.shake, 10);
        toast('IT SEES YOU — RUN, BREAK ITS LINE OF SIGHT, HIDE', 3);
      }
      break;
    case 'awake':
      if (!S.awake) {
        S.awake = true;
        A.screech(e.x, e.y, 0.9);
        bigMsg('Something woke up.', 'Walk. Don\'t run. It hears running and it sees light.', 4);
      }
      break;
    case 'noise':
      if (e.id === S.myId) break;
      if (e.k === 'splash') A.splash(e.x, e.y);
      else if (e.k === 'gasp') A.gasp(e.x, e.y);
      break;
    case 'pa':
      paMsg(e.text);
      break;
    case 'bell':
      A.bell();
      toast('…the school bell is ringing.');
      break;
    case 'clock':
      S.clocks.push({ id: e.id, x: e.x, y: e.y, t: e.dur, beepT: 0 });
      break;
    case 'drop':
      for (const it of e.items) S.items.push({ ...it, taken: false });
      break;
    case 'grab': {
      const h = map.hides[e.h];
      if (h) A.locker(h.fx + 0.5, h.fy + 0.5, true);
      if (h && e.hit === -1 && me && me.h < 0 && Math.hypot(me.x - h.fx, me.y - h.fy) < 12) toast('It tore a locker open… empty.');
      break;
    }
    case 'drink':
      if (e.id !== S.myId) {
        const p = P(e.id);
        if (p) A.footstepAt(p.x, p.y, 0);
      }
      break;
    case 'left': {
      const p = P(e.id);
      if (p) {
        toast(`${p.name} left the game.`);
        S.players.delete(e.id);
      }
      break;
    }
    default:
      break;
  }
}

function onChat(m) {
  const line = `<div class="msg"><b style="color:${esc(m.color)}">${esc(m.name)}:</b> ${esc(m.m)}</div>`;
  for (const id of ['lchat', 'chatlog']) {
    const el = $(id);
    el.insertAdjacentHTML('beforeend', line);
    while (el.children.length > 40) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  // In-game chat fades away after a while; the lobby keeps its history.
  const node = $('chatlog').lastElementChild;
  setTimeout(() => node?.remove(), 15000);
  if (S.screen === 'game') S.bubbles.set(m.id, { text: m.m, until: S.t + 5 });
}

function onEnd(m) {
  A.stopSiren();
  S.showMap = false;
  const escaped = m.results.filter((r) => r.fate === 'escaped').length;
  const total = m.results.length;
  const title = $('endTitle');
  title.className = escaped ? 'won' : 'lost';
  title.textContent = escaped === total ? 'EVERYONE GOT OUT' : escaped ? `${escaped} OF ${total} ESCAPED` : 'NOBODY GOT OUT';
  const mins = Math.floor(m.time / 60);
  const secs = String(Math.floor(m.time % 60)).padStart(2, '0');
  $('endSub').textContent = `${m.fusesIn}/${m.fusesNeeded} fuses restored · survived ${mins}:${secs}`;
  $('endList').innerHTML = m.results
    .map(
      (r) => `<li><span class="dot" style="background:${esc(r.color)}"></span><span>${esc(r.name)}${r.id === S.myId ? ' <i>(you)</i>' : ''}</span>
      <span class="fate ${r.fate}">${r.fate === 'escaped' ? 'ESCAPED' : 'TAKEN'}</span>
      <span class="ttl">“${esc(r.title)}”</span>
      <span class="stats">fuses ${r.stats.fuses} · revives ${r.stats.revives} · spotted ${r.stats.spotted}× · caught ${r.stats.downs}×</span></li>`,
    )
    .join('');
  let n = 14;
  $('endTimer').textContent = `Back to detention in ${n}…`;
  clearInterval(S.endTimer);
  S.endTimer = setInterval(() => {
    n--;
    $('endTimer').textContent = n > 0 ? `Back to detention in ${n}…` : '';
    if (n <= 0) clearInterval(S.endTimer);
  }, 1000);
  setTimeout(() => showScreen('end'), escaped ? 1500 : 2200);
}

// ------------------------------------------------------------------ HUD helpers
let bigTimer = 0;
function bigMsg(title, sub = '', secs = 3) {
  $('bigmsg').textContent = title;
  $('submsg').textContent = sub;
  $('center').style.opacity = 1;
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => {
    $('center').style.opacity = 0;
  }, secs * 1000);
}
let toastTimer = 0;
function toast(msg, secs = 3) {
  $('toast').textContent = msg;
  $('toast').style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').style.opacity = 0;
  }, secs * 1000);
}
let paTimer = 0;
function paMsg(text) {
  A.chime();
  A.speak(text);
  $('pa').textContent = text;
  $('pa').classList.remove('hidden');
  clearTimeout(paTimer);
  paTimer = setTimeout(() => $('pa').classList.add('hidden'), 3000 + text.length * 70);
}
function setHelp(on) {
  S.showHelp = on;
  $('help').classList.toggle('hidden', !on);
}

// ------------------------------------------------------------------ input
function spectating() {
  return !S.me || S.me.st === 'taken' || S.me.st === 'escaped';
}
function openChat() {
  S.chatOpen = true;
  keys.clear();
  const el = $('chatIn');
  el.classList.remove('hidden');
  el.value = '';
  el.focus();
}
function closeChat() {
  S.chatOpen = false;
  const el = $('chatIn');
  el.classList.add('hidden');
  el.blur();
}
$('chatIn').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) send({ t: 'chat', m: v });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});

addEventListener('keydown', (e) => {
  if (S.screen !== 'game' || S.chatOpen) return;
  if (e.key === 'Enter') {
    openChat();
    e.preventDefault();
    return;
  }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (keys.has(e.code)) return;
  keys.add(e.code);
  A.init();
  switch (e.code) {
    case 'KeyE': interact(); break;
    case 'KeyF': toggleLight(); break;
    case 'KeyC': L.crouch = !L.crouch; break;
    case 'KeyG': throwClock(); break;
    case 'KeyQ': drink(); break;
    case 'KeyM':
    case 'Tab': S.showMap = !S.showMap; break;
    case 'KeyH': setHelp(!S.showHelp); break;
    case 'Space': if (spectating()) cycleSpec(); break;
    case 'Escape':
      S.showMap = false;
      setHelp(false);
      break;
    default: break;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyE') stopRevive();
});
addEventListener('blur', () => {
  keys.clear();
  stopRevive();
});
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', () => {
  A.init();
  if (spectating()) cycleSpec();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('resize', () => R.resize());

function cycleSpec() {
  const list = [...S.players.values()].filter((p) => p !== S.me && (p.st === 'alive' || p.st === 'down'));
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === S.specId);
  S.specId = list[(i + 1) % list.length].id;
}

function toggleLight() {
  const me = S.me;
  if (!me || (me.st !== 'alive' && me.st !== 'down') || me.h >= 0) return;
  if (L.battery <= 0) {
    toast('Your flashlight is dead. Find batteries.');
    return;
  }
  L.fl = !L.fl;
  A.click();
}
function throwClock() {
  const me = S.me;
  if (!me || me.st !== 'alive' || me.h >= 0) return;
  if (!me.inv || me.inv[1] <= 0) {
    toast('No alarm clocks. Find one to distract it.');
    return;
  }
  const w = screenToWorld(mouse.x, mouse.y);
  send({ t: 'throw', x: r2(w.x), y: r2(w.y) });
  me.inv[1]--;
}
function drink() {
  const me = S.me;
  if (!me || me.st !== 'alive' || !me.inv || me.inv[2] <= 0) return;
  send({ t: 'drink' });
  me.inv[2]--;
  L.drinkT = 10;
  L.stamina = PLAYER.stamina;
  L.exhausted = false;
  A.can();
  toast('Energy drink! Sprint without tiring for 10s.');
}
function interact() {
  const me = S.me;
  if (!me || me.st !== 'alive') return;
  if (me.h >= 0) {
    send({ t: 'unhide' });
    return;
  }
  const tg = S.target;
  if (!tg) return;
  if (tg.k === 'revive') {
    send({ t: 'revive', id: tg.id, on: true });
    L.reviving = tg.id;
  } else if (tg.k === 'hide') send({ t: 'hide', i: tg.i });
  else if (tg.k === 'fuse') send({ t: 'fuse' });
  else if (tg.k === 'door') send({ t: 'door', i: tg.i });
}
function stopRevive() {
  if (L.reviving != null) {
    send({ t: 'revive', id: L.reviving, on: false });
    L.reviving = null;
  }
}
function screenToWorld(sx, sy) {
  return { x: S.cam.x + (sx - R.W / 2) / R.ts, y: S.cam.y + (sy - R.H / 2) / R.ts };
}

function findTarget() {
  const me = S.me;
  const map = S.map;
  if (!me || me.st !== 'alive' || me.h >= 0) return null;
  for (const p of S.players.values()) {
    if (p !== me && p.st === 'down' && Math.hypot(p.x - me.x, p.y - me.y) < 1.6) return { k: 'revive', id: p.id, label: `Hold [E] to revive ${p.name}` };
  }
  const fb = map.fusebox;
  if (fb && Math.hypot(fb.fx + 0.5 - me.x, fb.fy + 0.5 - me.y) < 1.7) {
    if (S.power) return { k: 'info', label: 'The power is on. GET TO THE FRONT EXIT.' };
    if (me.inv[0] > 0) return { k: 'fuse', label: `[E] Insert ${me.inv[0]} fuse${me.inv[0] > 1 ? 's' : ''}` };
    return { k: 'info', label: `Fuse box: ${S.fusesIn}/${S.fusesNeeded}. Find the missing fuses.` };
  }
  let best = null;
  let bs = 1e9;
  const ax = Math.cos(me.a);
  const ay = Math.sin(me.a);
  map.hides.forEach((h, i) => {
    const d = Math.hypot(h.fx + 0.5 - me.x, h.fy + 0.5 - me.y);
    if (d > 0.95) return;
    const wx = h.x + 0.5 - me.x;
    const wy = h.y + 0.5 - me.y;
    const s = d - 0.4 * ((wx * ax + wy * ay) / Math.max(0.01, Math.hypot(wx, wy)));
    if (s < bs) {
      bs = s;
      best = { k: 'hide', i, label: `[E] Hide in the ${h.kind === 'locker' ? 'locker' : 'closet'}` };
    }
  });
  map.doors.forEach((dr, i) => {
    const dx = dr.x + 0.5 - me.x;
    const dy = dr.y + 0.5 - me.y;
    const d = Math.hypot(dx, dy);
    if (d > 1.5) return;
    const s = d - 0.5 * ((dx * ax + dy * ay) / Math.max(d, 0.01));
    if (s < bs) {
      bs = s;
      best = { k: 'door', i, label: dr.open ? '[E] Close door' : '[E] Open door' };
    }
  });
  if (best) return best;
  const ex = map.exit;
  if (!S.power && me.y > ex.y - 2.2 && me.x > ex.x0 - 1.5 && me.x < ex.x1 + 2.5) return { k: 'info', label: 'The front doors are chained shut. Restore the power.' };
  return null;
}

// ------------------------------------------------------------------ local simulation
function overlaps(px, py, tx, ty) {
  const r = PLAYER.radius;
  return px + r > tx && px - r < tx + 1 && py + r > ty && py - r < ty + 1;
}
function blocked(x, y, px, py) {
  const r = PLAYER.radius;
  const m = S.map;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (!solidAt(m, tx, ty)) continue;
      if (overlaps(px, py, tx, ty)) continue; // already inside (a door shut on us) — let us walk out
      return true;
    }
  }
  return false;
}
function tryMove(dx, dy) {
  const me = S.me;
  if (!blocked(me.x + dx, me.y + dy, me.x, me.y)) {
    me.x += dx;
    me.y += dy;
    return;
  }
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 6; k++) {
    const mid = (lo + hi) / 2;
    if (blocked(me.x + dx * mid, me.y + dy * mid, me.x, me.y)) hi = mid;
    else lo = mid;
  }
  me.x += dx * lo;
  me.y += dy * lo;
}
function moveLocal(dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  for (let s = 0; s < steps; s++) {
    tryMove(dx / steps, 0);
    tryMove(0, dy / steps);
  }
}

function localUpdate(dt) {
  const me = S.me;
  const map = S.map;
  const psx = R.W / 2 + (me.x - S.cam.x) * R.ts;
  const psy = R.H / 2 + (me.y - S.cam.y) * R.ts;
  if (!S.chatOpen) me.a = Math.atan2(mouse.y - psy, mouse.x - psx);
  L.drinkT = Math.max(0, L.drinkT - dt);

  if (me.h >= 0) {
    me.mv = 0;
    me.sp = 0;
    me.fl = 0;
    L.gaspLock = Math.max(0, L.gaspLock - dt);
    if (keys.has('Space') && L.breath > 0 && L.gaspLock <= 0) {
      L.holding = true;
      L.breath -= dt;
      if (L.breath <= 0) {
        L.breath = 0;
        L.holding = false;
        L.gaspLock = 2.5;
        send({ t: 'gasp' });
        A.gasp();
      }
    } else {
      L.holding = false;
      L.breath = Math.min(PLAYER.breath, L.breath + dt * 0.7);
    }
    return;
  }
  L.holding = false;
  L.breath = Math.min(PLAYER.breath, L.breath + dt);

  let ix = 0;
  let iy = 0;
  if (!S.chatOpen) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  }
  const moving = ix !== 0 || iy !== 0;
  const down = me.st === 'down';
  const crouch = L.crouch && !down;
  const wantSprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && moving && !crouch && !down;
  let sprint = wantSprint && (L.drinkT > 0 || (!L.exhausted && L.stamina > 0));
  if (sprint && L.drinkT <= 0) {
    L.stamina -= dt;
    L.restT = 0.9;
    if (L.stamina <= 0) {
      L.stamina = 0;
      L.exhausted = true;
      sprint = false;
    }
  } else {
    L.restT -= dt;
    if (L.restT <= 0) L.stamina = Math.min(PLAYER.stamina, L.stamina + dt * (moving ? 0.45 : 0.75));
  }
  if (L.exhausted && L.stamina > 1.4) L.exhausted = false;
  if (L.exhausted) {
    L.breathT -= dt;
    if (L.breathT <= 0) {
      L.breathT = 0.7;
      A.breath(0.07);
    }
  }
  const spd = down ? PLAYER.crawl : crouch ? PLAYER.crouch : sprint ? (L.drinkT > 0 ? 5.6 : PLAYER.sprint) : PLAYER.walk;
  if (moving) {
    const n = Math.hypot(ix, iy);
    const ox = me.x;
    const oy = me.y;
    moveLocal((ix / n) * spd * dt, (iy / n) * spd * dt);
    const moved = Math.hypot(me.x - ox, me.y - oy);
    me.walk = (me.walk || 0) + moved * 9;
    L.stepAcc += moved;
    const stride = sprint ? 0.95 : down ? 0.5 : 0.72;
    if (L.stepAcc > stride) {
      L.stepAcc = 0;
      A.footstep(sprint ? 2 : crouch || down ? 0 : 1);
      if (map.furn[Math.floor(me.y) * map.w + Math.floor(me.x)] === F.PUDDLE && !crouch) A.splash(me.x, me.y, true);
    }
  }
  me.cr = crouch || down ? 1 : 0;
  me.sp = sprint && moving ? 1 : 0;
  me.mv = moving ? 1 : 0;

  if (L.fl && L.battery > 0) {
    L.battery = Math.max(0, L.battery - dt * PLAYER.batteryDrain);
    if (L.battery < 20 && !L.lowWarned) {
      L.lowWarned = true;
      toast('Your flashlight is dying. Find batteries.');
    }
    if (L.battery >= 20) L.lowWarned = false;
    if (L.battery <= 0) {
      L.fl = false;
      A.click();
      toast('Your flashlight died.');
    }
  }
  me.fl = L.fl ? 1 : 0;

  if (me.st === 'alive') {
    for (const it of S.items) {
      if (it.taken || (it.pending && S.t - it.pending < 1)) continue;
      if (Math.hypot(it.x - me.x, it.y - me.y) < 0.7) {
        it.pending = S.t;
        send({ t: 'pick', i: it.id });
      }
    }
  }
}

function viewer() {
  const me = S.me;
  if (me && (me.st === 'alive' || me.st === 'down')) return me;
  let p = S.players.get(S.specId);
  if (!p || (p.st !== 'alive' && p.st !== 'down')) {
    p = [...S.players.values()].find((q) => q !== me && (q.st === 'alive' || q.st === 'down'));
    S.specId = p ? p.id : null;
  }
  return p || me;
}

// ------------------------------------------------------------------ frame loop
function update(dt) {
  S.t += dt;
  const me = S.me;
  const map = S.map;
  const k = 1 - Math.exp(-dt * 14);
  for (const p of S.players.values()) {
    if (p === me) continue;
    const ox = p.x;
    const oy = p.y;
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 4) {
      p.x = p.tx;
      p.y = p.ty;
    } else {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
    p.a = lerpAng(p.a, p.ta, k);
    const moved = Math.hypot(p.x - ox, p.y - oy);
    p.walk = (p.walk || 0) + moved * 9;
    if ((p.st === 'alive' || p.st === 'down') && p.h < 0) {
      p.stepAcc += moved;
      if (p.stepAcc > (p.sp ? 0.95 : 0.72)) {
        p.stepAcc = 0;
        A.footstepAt(p.x, p.y, p.sp ? 2 : p.cr ? 0 : 1);
      }
    }
  }
  for (const mo of S.monsters) {
    const ox = mo.x;
    const oy = mo.y;
    if (Math.hypot(mo.tx - mo.x, mo.ty - mo.y) > 4) {
      mo.x = mo.tx;
      mo.y = mo.ty;
    } else {
      mo.x += (mo.tx - mo.x) * k;
      mo.y += (mo.ty - mo.y) * k;
    }
    mo.a = lerpAng(mo.a, mo.ta, k);
    const moved = Math.hypot(mo.x - ox, mo.y - oy);
    mo.walk += moved * 4.5;
    mo.stepAcc += moved;
    if (mo.stepAcc > 0.95) {
      mo.stepAcc = 0;
      A.monsterStep(mo.x, mo.y, mo.st === 'chase');
    }
    mo.growlT -= dt;
    if (mo.growlT <= 0) {
      mo.growlT = 5 + Math.random() * 8;
      if (mo.st !== 'dormant') A.growl(mo.x, mo.y);
    }
  }
  for (const c of S.clocks) {
    c.t -= dt;
    c.beepT -= dt;
    if (c.beepT <= 0) {
      c.beepT = 0.6;
      A.clockBeep(c.x, c.y);
    }
  }
  S.clocks = S.clocks.filter((c) => c.t > 0);

  if (me && (me.st === 'alive' || me.st === 'down') && !S.scare) localUpdate(dt);
  S.target = findTarget();

  const v = viewer() || { x: map.w / 2, y: map.h / 2, a: 0, fl: 0, h: -1 };
  // camera with a little look-ahead toward the cursor
  let tx = v.x;
  let ty = v.y;
  if (v === me && me.st === 'alive' && me.h < 0) {
    const lx = clamp((mouse.x - R.W / 2) / R.ts, -6, 6) * 0.22;
    const ly = clamp((mouse.y - R.H / 2) / R.ts, -6, 6) * 0.22;
    tx += lx;
    ty += ly;
  }
  const ck = 1 - Math.exp(-dt * 6);
  S.cam.x += (tx - S.cam.x) * ck;
  S.cam.y += (ty - S.cam.y) * ck;

  // danger, chase, flicker
  let nearest = 1e9;
  let nearestLos = false;
  let chase = 0;
  for (const mo of S.monsters) {
    if (mo.st === 'dormant') continue;
    const d = Math.hypot(mo.x - v.x, mo.y - v.y);
    if (d < nearest) {
      nearest = d;
      nearestLos = d < 16 && los(map, v.x, v.y, mo.x, mo.y);
    }
    if (mo.st === 'chase' && mo.tg === v.id) chase = 1;
    else if ((mo.st === 'chase' || mo.st === 'grab') && d < 16) chase = Math.max(chase, 0.5);
  }
  const danger = clamp(1 - nearest / 14, 0, 1) * (nearestLos ? 1.15 : 0.85);
  S.chaseLevel += (chase - S.chaseLevel) * (1 - Math.exp(-dt * 3));
  S.flickT -= dt;
  if (S.flickT <= 0) {
    S.flickT = 0.04 + Math.random() * 0.1;
    const near = clamp(1 - nearest / 7, 0, 1);
    const low = v === me && L.battery < 15 ? (15 - L.battery) / 15 : 0;
    S.flick = Math.random() < near * 0.55 + low * 0.35 ? Math.random() * 0.45 : 1;
  }
  S.shake = Math.max(0, S.shake - dt * 22);
  S.flash = Math.max(0, S.flash - dt * 1.5);

  A.setListener(v.x, v.y, (x, y) => los(map, v.x, v.y, x, y));
  const active = !!me && (me.st === 'alive' || me.st === 'down');
  A.update(dt, { danger, chase: S.chaseLevel, dark: v.fl ? 0 : 1, hidden: v.h >= 0, active: active || spectating() });

  $('hud').classList.toggle('scare', !!S.scare);
  if (S.scare) {
    S.scare.t += dt;
    if (S.scare.t >= S.scare.dur) {
      const fatal = S.scare.fatal;
      S.scare = null;
      S.flash = 0.9;
      S.shake = 12;
      if (fatal) bigMsg('TAKEN', 'You belong to the school now. You can still watch your friends.', 5);
    }
  }

  // exploration memory for the map
  L.exploreT -= dt;
  if (L.exploreT <= 0 && v) {
    L.exploreT = 0.25;
    const R0 = 9;
    const vx = Math.floor(v.x);
    const vy = Math.floor(v.y);
    for (let y = vy - R0; y <= vy + R0; y++) {
      for (let x = vx - R0; x <= vx + R0; x++) {
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        const i = y * map.w + x;
        if (S.explored[i] || (x - vx) ** 2 + (y - vy) ** 2 > R0 * R0) continue;
        const t = map.tiles[i];
        if (t === T.WALL || t === T.VOID) continue;
        if (los(map, v.x, v.y, x + 0.5, y + 0.5)) {
          S.explored[i] = 1;
          S.exploredDirty = true;
        }
      }
    }
    const room = map.roomAt[vy * map.w + vx];
    if (room >= 0 && v === me) {
      const r = map.rooms[room];
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          if (!S.explored[y * map.w + x]) {
            S.explored[y * map.w + x] = 1;
            S.exploredDirty = true;
          }
        }
      }
    }
    for (const it of S.items) if (!it.taken && it.k === 'fuse' && Math.hypot(it.x - v.x, it.y - v.y) < 9 && los(map, v.x, v.y, it.x, it.y)) it.seen = true;
  }

  // send our state
  L.sendT -= dt;
  if (L.sendT <= 0 && me && (me.st === 'alive' || me.st === 'down')) {
    L.sendT = 0.05;
    send({ t: 'in', x: r2(me.x), y: r2(me.y), a: r2(me.a), fl: me.fl ? 1 : 0, cr: me.cr ? 1 : 0, sp: me.sp ? 1 : 0, mv: me.mv ? 1 : 0, br: L.holding ? 1 : 0 });
  }

  S.view = {
    cx: S.cam.x, cy: S.cam.y, x: v.x, y: v.y, a: v.a || 0,
    fl: v === me ? (me.h < 0 && L.fl && L.battery > 0) : v.fl && v.h < 0,
    flick: v === me ? S.flick : 1, hidden: v.h >= 0, me: v,
    chase: S.chaseLevel, shake: S.shake, flash: S.flash,
  };

  L.hudT -= dt;
  if (L.hudT <= 0) {
    L.hudT = 0.1;
    updateHud(v, nearest);
  }
}

function updateHud(v, nearest) {
  const me = S.me;
  const map = S.map;
  // objective
  let obj;
  if (S.power) {
    obj = '<div class="big go">THE FRONT DOORS ARE OPEN — GET OUT!</div>';
  } else {
    const carrying = me?.inv?.[0] || 0;
    obj = `<div class="big">FUSES ${S.fusesIn} / ${S.fusesNeeded}</div><div>Find fuses, bring them to the fuse box in the <b>Boiler Room</b>.${
      carrying ? ` <span style="color:#d9a830">Carrying ${carrying}.</span>` : ''
    }</div>`;
  }
  $('obj').innerHTML = obj;
  const vx = Math.floor(v.x);
  const vy = Math.floor(v.y);
  const room = map.roomAt[vy * map.w + vx];
  const where = room >= 0 ? map.rooms[room].name : map.tiles[vy * map.w + vx] === T.DOOR ? 'Doorway' : 'Hallway';
  $('loc').textContent = (v.h >= 0 ? 'Hiding · ' : '') + where + (v === me && L.crouch && me.st === 'alive' ? ' · crouched' : '');
  if (v === me && room !== L.lastRoom) {
    L.lastRoom = room;
  }
  // clock: 11:52 PM + 1 minute per 4 seconds
  const mins = (23 * 60 + 52 + Math.floor(S.time / 4)) % (24 * 60);
  const hh = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, '0');
  $('clock').textContent = `${hh % 12 || 12}:${mm} ${hh < 12 ? 'AM' : 'PM'}`;
  // team
  $('team').innerHTML = [...S.players.values()]
    .map((p) => {
      let st = '';
      if (p.st === 'down') st = `<span class="st-down">DOWN ${Math.ceil(p.downT)}s</span>`;
      else if (p.st === 'taken') st = '<span class="st-taken">TAKEN</span>';
      else if (p.st === 'escaped') st = '<span class="st-escaped">ESCAPED</span>';
      else if (p.inv?.[0]) st = `<span style="color:#d9a830">fuse×${p.inv[0]}</span>`;
      const nm = p.st === 'taken' ? `<span class="st-taken">${esc(p.name)}</span>` : esc(p.name);
      return `<li>${st} ${nm}${p === me ? ' (you)' : ''}<span class="dot" style="background:${esc(p.color)}"></span></li>`;
    })
    .join('');

  // bars & inventory
  const showBars = me && (me.st === 'alive' || me.st === 'down');
  $('bars').classList.toggle('hidden', !showBars);
  $('inv').classList.toggle('hidden', !showBars);
  if (showBars) {
    const bb = $('bBattery');
    bb.style.width = `${L.battery}%`;
    bb.classList.toggle('low', L.battery < 20);
    const bs = $('bStamina');
    bs.style.width = `${L.drinkT > 0 ? 100 : (L.stamina / PLAYER.stamina) * 100}%`;
    bs.classList.toggle('out', L.exhausted);
    $('breathBar').classList.toggle('hidden', me.h < 0);
    $('bBreath').style.width = `${(L.breath / PLAYER.breath) * 100}%`;
    const inv = me.inv || [0, 0, 0];
    $('inv').innerHTML = `<span>LIGHT <b>[F]</b> ${L.fl ? 'on' : 'off'}</span><span>CLOCK ×<b>${inv[1]}</b> [G]</span><span>DRINK ×<b>${inv[2]}</b> [Q]</span>${
      L.crouch ? '<span>CROUCHED [C]</span>' : ''
    }`;
  }
  $('hud').classList.toggle('mapopen', S.showMap);

  // prompt
  const pr = $('prompt');
  pr.classList.remove('urgent');
  let label = '';
  if (me && me.st === 'alive' && me.h >= 0) {
    if (nearest < 3.2) {
      label = L.holding ? 'HOLDING YOUR BREATH…' : 'IT\'S RIGHT OUTSIDE — HOLD [SPACE]';
      pr.classList.add('urgent');
    } else label = '[E] leave hiding spot · hold [SPACE] to hold your breath';
  } else if (S.target) label = S.target.label;
  pr.textContent = label;

  // awareness eye
  const eye = $('eye');
  const aw = v.aw || 0;
  if (v === me && me.st === 'alive' && (aw > 0.05 || v.ch)) {
    eye.classList.remove('hidden');
    eye.classList.toggle('alert', !!v.ch);
    eye.querySelector('.eyeball').style.height = `${6 + Math.min(1, aw) * 16}px`;
    $('eyeText').textContent = v.ch ? 'HUNTED' : aw > 0.6 ? 'NOTICED' : 'SOMETHING STIRS';
  } else eye.classList.add('hidden');

  // down / spectate
  const dm = $('downmsg');
  if (me && me.st === 'down' && !S.scare) {
    dm.classList.remove('hidden');
    const prog = me.rv > 0 ? `<div class="prog"><div style="width:${Math.round(me.rv * 100)}%"></div></div>` : '';
    dm.innerHTML = `<div class="t">YOU'RE DOWN</div><div class="s">Crawl somewhere safe. A friend can revive you · ${Math.ceil(me.downT)}s</div>${prog}`;
  } else dm.classList.add('hidden');
  const reviving = L.reviving != null ? S.players.get(L.reviving) : null;
  if (reviving && reviving.st === 'down') {
    pr.textContent = `Reviving ${reviving.name}… ${Math.round((reviving.rv || 0) * 100)}%`;
  }
  const spec = $('spec');
  if (spectating() && !S.scare) {
    spec.classList.remove('hidden');
    const p = S.players.get(S.specId);
    spec.textContent = p ? `Watching ${p.name} · [Space] or click to switch` : 'Nobody left to watch…';
  } else spec.classList.add('hidden');
}

function draw() {
  if (S.scare) {
    R.drawScare(Math.min(1, S.scare.t / S.scare.dur));
    return;
  }
  R.frame(S, S.view);
  if (S.showMap) R.drawMap(S, S.view);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.screen === 'game' && S.map) {
    try {
      update(dt);
      draw();
    } catch (err) {
      console.error(err);
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
showScreen('menu');
if (new URLSearchParams(location.search).has('debug')) window.__ah = { S, L, R, A, send, interact };
