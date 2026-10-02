// AFTER HOURS — LAN co-op horror. Run `node server.js`, then open the printed address.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './server/ws.js';
import { Game, DT } from './server/game.js';
import { DIFFICULTY, COLORS } from './shared/constants.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const RESULTS_SECONDS = 14;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const STATIC = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url === '/') url = '/index.html';
  const prefix = url.startsWith('/shared/') ? '/shared/' : '/';
  const base = STATIC[prefix];
  const file = path.normalize(path.join(base, url.slice(prefix.length)));
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- lobby state
let nextId = 1;
const clients = new Map(); // id -> { id, ws, name, color, ready, joined }
let phase = 'lobby'; // lobby | playing | results
let hostId = null;
let difficulty = 'normal';
let game = null;
let tickTimer = null;
let resultsTimer = null;

function send(c, o) {
  c.ws.send(JSON.stringify(o));
}
function broadcast(o) {
  const s = JSON.stringify(o);
  for (const c of clients.values()) if (c.joined) c.ws.send(s);
}
function clean(s, max = 16) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}
function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}
function joined() {
  return [...clients.values()].filter((c) => c.joined);
}
function fixHost() {
  if (hostId != null && clients.get(hostId)?.joined) return;
  hostId = joined()[0]?.id ?? null;
}
function lobbyState() {
  return {
    t: 'lobby', phase, host: hostId, diff: difficulty,
    players: joined().map((c) => ({ id: c.id, name: c.name, color: c.color, ready: c.ready, playing: !!game?.players.has(c.id) })),
  };
}
function broadcastLobby() {
  fixHost();
  broadcast(lobbyState());
}

function onConnection(ws) {
  const c = { id: nextId++, ws, name: '', color: COLORS[0], ready: false, joined: false };
  clients.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, addrs: lanAddrs(), phase });
  ws.on('message', (txt) => {
    let m;
    try {
      m = JSON.parse(txt);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    try {
      handle(c, m);
    } catch (e) {
      console.error('message error', e);
    }
  });
  ws.on('close', () => leave(c));
}

function handle(c, m) {
  if (m.t === 'join') {
    c.name = clean(m.name) || `Student ${c.id}`;
    c.color = COLORS.includes(m.color) ? m.color : COLORS[c.id % COLORS.length];
    c.joined = true;
    broadcastLobby();
    if (phase === 'playing' && game) send(c, game.startPayload(c.id)); // watch the round in progress
    console.log(`+ ${c.name} joined (${joined().length} in lobby)`);
    return;
  }
  if (!c.joined) return;
  if (m.t === 'chat') {
    const msg = clean(m.m, 140);
    if (msg) broadcast({ t: 'chat', id: c.id, name: c.name, color: c.color, m: msg });
    return;
  }
  if (phase === 'lobby') {
    if (m.t === 'ready') {
      c.ready = !!m.v;
      broadcastLobby();
    } else if (m.t === 'diff' && c.id === hostId && DIFFICULTY[m.v]) {
      difficulty = m.v;
      broadcastLobby();
    } else if (m.t === 'start' && c.id === hostId) {
      startGame();
    }
    return;
  }
  if (phase === 'playing' && game?.players.has(c.id)) game.onMessage(c.id, m);
}

function startGame() {
  const roster = joined();
  if (!roster.length) return;
  phase = 'playing';
  game = new Game(roster.map((c) => ({ id: c.id, name: c.name, color: c.color })), difficulty, {
    broadcast,
    onEnd: endGame,
  });
  for (const c of roster) send(c, game.startPayload(c.id));
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    try {
      game?.tick();
    } catch (e) {
      console.error('tick error', e);
    }
  }, DT * 1000);
  broadcastLobby();
  console.log(`> Round started: ${roster.length} player(s), ${DIFFICULTY[difficulty].label}, ${game.monsters.length} monster(s)`);
}

function endGame(summary) {
  clearInterval(tickTimer);
  tickTimer = null;
  phase = 'results';
  broadcast(summary);
  console.log(`< Round over: ${summary.results.filter((r) => r.fate === 'escaped').length}/${summary.results.length} escaped`);
  clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => {
    phase = 'lobby';
    game = null;
    for (const c of clients.values()) c.ready = false;
    broadcastLobby();
  }, RESULTS_SECONDS * 1000);
}

function leave(c) {
  if (!clients.has(c.id)) return;
  clients.delete(c.id);
  if (c.joined) console.log(`- ${c.name} left`);
  if (game && phase === 'playing') {
    game.removePlayer(c.id);
    if (!game.players.size) game.end();
  }
  broadcastLobby();
}

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  acceptUpgrade(req, socket, head, onConnection);
});

server.listen(PORT, HOST, () => {
  const bar = '─'.repeat(52);
  console.log(`\n${bar}\n  AFTER HOURS — the school is locked.\n${bar}`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  const addrs = lanAddrs();
  if (addrs.length) {
    console.log('  Friends on your network open:');
    for (const a of addrs) console.log(`      ${a}`);
  } else {
    console.log('  (No LAN address found — are you connected to a network?)');
  }
  console.log(`${bar}\n`);
});
