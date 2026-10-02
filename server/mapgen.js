// Procedural school generator: a "#" of hallways, big rooms (gym, cafeteria, library,
// lobby) and BSP-split blocks of classrooms, then furniture, lockers, items and spawns.
import { T, F, FSOLID, GRAFFITI, BOARD_TEXT, LOCKER_COLORS, DIFFICULTY } from '../shared/constants.js';

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

export function generateSchool(seed, opts = {}) {
  const nPlayers = Math.max(1, opts.players || 1);
  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const R = makeRng(seed);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const chance = (p) => R() < p;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  };

  const W = 72;
  const H = 54;
  const N = W * H;
  const tiles = new Uint8Array(N);
  const furn = new Uint8Array(N);
  const fdir = new Uint8Array(N);
  const roomAt = new Int16Array(N).fill(-1);
  const doorAt = new Int16Array(N).fill(-1);
  const clear = new Uint8Array(N); // keep free of solid furniture
  const wallUse = new Uint8Array(N); // bitmask of decorated wall faces
  const I = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tile = (x, y) => (inb(x, y) ? tiles[I(x, y)] : T.VOID);
  const markClear = (x, y) => {
    if (inb(x, y)) clear[I(x, y)] = 1;
  };

  // ---- shell and hallways
  for (let y = 1; y <= H - 2; y++) for (let x = 1; x <= W - 2; x++) tiles[I(x, y)] = T.WALL;
  const vx = [ri(21, 25), ri(45, 49)];
  const hy = [ri(15, 19), ri(33, 37)];
  for (const y0 of hy) for (let y = y0; y < y0 + 3; y++) for (let x = 2; x <= W - 3; x++) tiles[I(x, y)] = T.HALL;
  for (const x0 of vx) for (let x = x0; x < x0 + 3; x++) for (let y = 2; y <= H - 3; y++) tiles[I(x, y)] = T.HALL;

  const cols = [[1, vx[0] - 1], [vx[0] + 3, vx[1] - 1], [vx[1] + 3, W - 2]];
  const rows = [[1, hy[0] - 1], [hy[0] + 3, hy[1] - 1], [hy[1] + 3, H - 2]];
  const blocks = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      blocks.push({ c, r, x0: cols[c][0], x1: cols[c][1], y0: rows[r][0], y1: rows[r][1], kind: null });
    }
  }
  const B = (c, r) => blocks[r * 3 + c];
  B(1, 2).kind = 'lobby';
  shuffle([B(0, 0), B(2, 0), B(0, 2), B(2, 2)])[0].kind = 'gym';
  if (chance(0.6)) B(1, 1).kind = 'cafeteria';
  else pick(blocks.filter((b) => !b.kind)).kind = 'cafeteria';
  pick(blocks.filter((b) => !b.kind)).kind = 'library';

  // ---- rooms
  const rooms = [];
  function addRoom(x0, y0, x1, y1, type) {
    const r = { id: rooms.length, type, x0, y0, x1, y1, name: '' };
    rooms.push(r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        tiles[I(x, y)] = T.ROOM;
        roomAt[I(x, y)] = r.id;
      }
    }
    return r;
  }
  const MINW = 4;
  const MINH = 4;
  const MAXW = 11;
  const MAXH = 9;
  // Rect includes its boundary walls; leaves get floor rects.
  function bsp(x0, y0, x1, y1, out) {
    const fw = x1 - x0 - 1;
    const fh = y1 - y0 - 1;
    const canV = fw >= 2 * MINW + 1;
    const canH = fh >= 2 * MINH + 1;
    const big = fw > MAXW || fh > MAXH;
    if ((!canV && !canH) || (!big && chance(0.3))) {
      out.push({ x0: x0 + 1, y0: y0 + 1, x1: x1 - 1, y1: y1 - 1 });
      return;
    }
    let vert;
    if (canV && !canH) vert = true;
    else if (canH && !canV) vert = false;
    else if (fw / fh > 1.2) vert = true;
    else if (fh / fw > 1.2) vert = false;
    else vert = chance(0.5);
    if (vert) {
      const s = ri(x0 + MINW + 1, x1 - MINW - 1);
      bsp(x0, y0, s, y1, out);
      bsp(s, y0, x1, y1, out);
    } else {
      const s = ri(y0 + MINH + 1, y1 - MINH - 1);
      bsp(x0, y0, x1, s, out);
      bsp(x0, s, x1, y1, out);
    }
  }
  for (const b of blocks) {
    b.rooms = [];
    if (b.kind) {
      b.rooms.push(addRoom(b.x0 + 1, b.y0 + 1, b.x1 - 1, b.y1 - 1, b.kind));
    } else {
      const out = [];
      bsp(b.x0, b.y0, b.x1, b.y1, out);
      for (const q of out) b.rooms.push(addRoom(q.x0, q.y0, q.x1, q.y1, 'tbd'));
    }
  }
  const area = (r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const center = (r) => ({ x: (r.x0 + r.x1) >> 1, y: (r.y0 + r.y1) >> 1 });

  // ---- doors
  const doors = [];
  function canDoor(x, y, ax) {
    if (tile(x, y) !== T.WALL) return false;
    if (ax === 'h') return tile(x - 1, y) !== T.DOOR && tile(x + 1, y) !== T.DOOR;
    return tile(x, y - 1) !== T.DOOR && tile(x, y + 1) !== T.DOOR;
  }
  function addDoor(x, y, ax, open) {
    if (tile(x, y) !== T.WALL) return null;
    const d = { id: doors.length, x, y, ax, open: !!open };
    doors.push(d);
    tiles[I(x, y)] = T.DOOR;
    doorAt[I(x, y)] = d.id;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) markClear(x + dx, y + dy);
    if (ax === 'h') {
      markClear(x, y - 2);
      markClear(x, y + 2);
    } else {
      markClear(x - 2, y);
      markClear(x + 2, y);
    }
    return d;
  }
  function hallCands(r) {
    const c = [];
    for (let x = r.x0; x <= r.x1; x++) {
      if (tile(x, r.y0 - 2) === T.HALL && tile(x, r.y0 - 1) === T.WALL) c.push({ x, y: r.y0 - 1, ax: 'h', side: 'N' });
      if (tile(x, r.y1 + 2) === T.HALL && tile(x, r.y1 + 1) === T.WALL) c.push({ x, y: r.y1 + 1, ax: 'h', side: 'S' });
    }
    for (let y = r.y0; y <= r.y1; y++) {
      if (tile(r.x0 - 2, y) === T.HALL && tile(r.x0 - 1, y) === T.WALL) c.push({ x: r.x0 - 1, y, ax: 'v', side: 'W' });
      if (tile(r.x1 + 2, y) === T.HALL && tile(r.x1 + 1, y) === T.WALL) c.push({ x: r.x1 + 1, y, ax: 'v', side: 'E' });
    }
    return c;
  }
  for (const r of rooms) {
    if (r.type === 'lobby') continue;
    const cands = hallCands(r);
    if (!cands.length) continue;
    const bySide = {};
    for (const c of cands) (bySide[c.side] ||= []).push(c);
    const sides = shuffle(Object.keys(bySide));
    const big = r.type === 'gym' || r.type === 'cafeteria' || r.type === 'library';
    const n = big ? Math.min(sides.length, 3) : chance(0.3) ? Math.min(2, sides.length) : 1;
    for (let k = 0; k < n; k++) {
      const list = bySide[sides[k]];
      const inner = list.filter((c) => (c.ax === 'h' ? c.x > r.x0 + 1 && c.x < r.x1 - 1 : c.y > r.y0 + 1 && c.y < r.y1 - 1));
      const c = pick(inner.length ? inner : list);
      if (!canDoor(c.x, c.y, c.ax)) continue;
      const d = addDoor(c.x, c.y, c.ax, chance(0.3));
      r.hall = true;
      if (d && (r.type === 'gym' || r.type === 'cafeteria')) {
        const nx = c.ax === 'h' ? c.x + 1 : c.x;
        const ny = c.ax === 'h' ? c.y : c.y + 1;
        if (list.some((o) => o.x === nx && o.y === ny)) addDoor(nx, ny, c.ax, d.open);
      }
    }
  }

  // Lobby: open archways to the halls and the chained front doors.
  const lobby = rooms.find((r) => r.type === 'lobby');
  const lcx = (lobby.x0 + lobby.x1) >> 1;
  const lcy = (lobby.y0 + lobby.y1) >> 1;
  const openTo = (x, y) => {
    tiles[I(x, y)] = T.ROOM;
    roomAt[I(x, y)] = lobby.id;
  };
  for (let x = lcx - 3; x <= lcx + 3; x++) if (tile(x, lobby.y0 - 2) === T.HALL) openTo(x, lobby.y0 - 1);
  for (let y = lcy - 1; y <= lcy + 1; y++) {
    if (tile(lobby.x0 - 2, y) === T.HALL) openTo(lobby.x0 - 1, y);
    if (tile(lobby.x1 + 2, y) === T.HALL) openTo(lobby.x1 + 1, y);
  }
  lobby.hall = true;
  const exit = { x0: lcx - 1, x1: lcx, y: lobby.y1 + 1 };
  tiles[I(exit.x0, exit.y)] = T.EXIT;
  tiles[I(exit.x1, exit.y)] = T.EXIT;
  for (let y = lobby.y1 - 3; y <= lobby.y1; y++) for (let x = lcx - 3; x <= lcx + 2; x++) markClear(x, y);
  for (let x = lcx - 4; x <= lcx + 4; x++) {
    markClear(x, lobby.y0);
    markClear(x, lobby.y0 + 1);
  }
  for (let y = lcy - 2; y <= lcy + 2; y++) {
    markClear(lobby.x0, y);
    markClear(lobby.x0 + 1, y);
    markClear(lobby.x1, y);
    markClear(lobby.x1 - 1, y);
  }

  // Rooms that do not touch a hallway get a door into a connected neighbour.
  function sharedCands(a, b) {
    const out = [];
    const oy0 = Math.max(a.y0, b.y0);
    const oy1 = Math.min(a.y1, b.y1);
    const ox0 = Math.max(a.x0, b.x0);
    const ox1 = Math.min(a.x1, b.x1);
    if (a.x1 + 2 === b.x0 || b.x1 + 2 === a.x0) {
      const wx = a.x1 + 2 === b.x0 ? a.x1 + 1 : a.x0 - 1;
      const trim = oy1 - oy0 >= 2 ? 1 : 0;
      for (let y = oy0 + trim; y <= oy1 - trim; y++) if (canDoor(wx, y, 'v')) out.push({ x: wx, y, ax: 'v' });
    }
    if (a.y1 + 2 === b.y0 || b.y1 + 2 === a.y0) {
      const wy = a.y1 + 2 === b.y0 ? a.y1 + 1 : a.y0 - 1;
      const trim = ox1 - ox0 >= 2 ? 1 : 0;
      for (let x = ox0 + trim; x <= ox1 - trim; x++) if (canDoor(x, wy, 'h')) out.push({ x, y: wy, ax: 'h' });
    }
    return out;
  }
  const connected = new Set(rooms.filter((r) => r.hall).map((r) => r.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rooms) {
      if (connected.has(r.id)) continue;
      for (const o of shuffle(rooms.filter((q) => connected.has(q.id)))) {
        const c = sharedCands(r, o);
        if (c.length) {
          const d = pick(c);
          addDoor(d.x, d.y, d.ax, chance(0.4));
          connected.add(r.id);
          changed = true;
          break;
        }
      }
    }
  }
  // A few extra interior doors make loops for escaping.
  for (const b of blocks) {
    for (let i = 0; i < b.rooms.length; i++) {
      for (let j = i + 1; j < b.rooms.length; j++) {
        if (!chance(0.22)) continue;
        const c = sharedCands(b.rooms[i], b.rooms[j]);
        if (c.length) {
          const d = pick(c);
          addDoor(d.x, d.y, d.ax, chance(0.5));
        }
      }
    }
  }

  // ---- BFS helpers
  function bfs(sx, sy, passFurniture) {
    const dist = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    const s = I(sx, sy);
    dist[s] = 0;
    q[qt++] = s;
    while (qh < qt) {
      const c = q[qh++];
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const ni = I(nx, ny);
        if (dist[ni] >= 0) continue;
        const t = tiles[ni];
        if (t !== T.HALL && t !== T.ROOM && t !== T.DOOR) continue;
        if (!passFurniture && FSOLID[furn[ni]]) continue;
        dist[ni] = dist[c] + 1;
        q[qt++] = ni;
      }
    }
    return dist;
  }

  // ---- room types
  const flex = rooms.filter((r) => r.type === 'tbd').sort((a, b) => area(a) - area(b));
  const free = new Set(flex);
  const assign = (r, type) => {
    if (!r) return null;
    r.type = type;
    free.delete(r);
    return r;
  };
  const freeList = () => [...free];
  if (flex.length > 7) assign(flex[0], 'janitor');
  freeList().slice(0, 2).forEach((r) => assign(r, 'bath'));
  const det = assign(pick(freeList().filter((r) => area(r) >= 36)) || freeList().pop(), 'detention');
  const dc = center(det);
  const detDist = bfs(dc.x, dc.y, true);
  const rdist = (r) => {
    const c = center(r);
    return detDist[I(c.x, c.y)];
  };
  assign(freeList().filter((r) => area(r) >= 20).sort((a, b) => rdist(b) - rdist(a))[0] || freeList()[0], 'boiler');
  const lobbyDist = bfs(lcx, lcy, true);
  const ldist = (r) => {
    const c = center(r);
    return lobbyDist[I(c.x, c.y)];
  };
  assign(freeList().sort((a, b) => ldist(a) - ldist(b))[0], 'office');
  assign(pick(freeList()), 'nurse');
  assign(freeList().filter((r) => area(r) >= 30).sort(() => R() - 0.5)[0], 'lab');
  assign(freeList().filter((r) => area(r) >= 30).sort(() => R() - 0.5)[0], 'music');
  assign(freeList().filter((r) => area(r) >= 30).sort(() => R() - 0.5)[0], 'art');
  for (const r of freeList()) assign(r, 'class');

  let num = 101;
  let baths = 0;
  const NAMES = {
    gym: 'Gymnasium', cafeteria: 'Cafeteria', library: 'Library', lobby: 'Main Entrance',
    boiler: 'Boiler Room', office: 'Principal\'s Office', nurse: 'Nurse\'s Office', lab: 'Science Lab',
    music: 'Music Room', art: 'Art Room', janitor: 'Janitor\'s Closet',
  };
  for (const r of [...rooms].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    if (r.type === 'class') r.name = `Room ${num++}`;
    else if (r.type === 'detention') r.name = `Detention · Room ${num++}`;
    else if (r.type === 'bath') r.name = baths++ ? 'Girls\' Restroom' : 'Boys\' Restroom';
    else r.name = NAMES[r.type] || 'Room';
  }

  // ---- wall faces
  const hides = [];
  const decor = [];
  const lights = [];
  let fusebox = null;
  const faceFree = (x, y, d) => !(wallUse[I(x, y)] & (1 << d));
  const useFace = (x, y, d) => {
    wallUse[I(x, y)] |= 1 << d;
  };
  // A wall tile whose neighbours along the wall are also walls.
  function straight(x, y, d) {
    if (tile(x, y) !== T.WALL) return false;
    if (d === 0 || d === 2) return tile(x - 1, y) === T.WALL && tile(x + 1, y) === T.WALL;
    return tile(x, y - 1) === T.WALL && tile(x, y + 1) === T.WALL;
  }
  // dir = direction from the wall tile towards the floor in front of it
  function sides(r) {
    const out = [];
    const mk = (name, dir, ext) => {
      const s = { name, dir, ext, cells: [], hasDoor: false };
      out.push(s);
      return s;
    };
    const n = mk('N', 2, r.y0 - 1 <= 1);
    const s = mk('S', 0, r.y1 + 1 >= H - 2);
    const w = mk('W', 1, r.x0 - 1 <= 1);
    const e = mk('E', 3, r.x1 + 1 >= W - 2);
    for (let x = r.x0; x <= r.x1; x++) {
      n.cells.push({ wx: x, wy: r.y0 - 1, fx: x, fy: r.y0 });
      s.cells.push({ wx: x, wy: r.y1 + 1, fx: x, fy: r.y1 });
    }
    for (let y = r.y0; y <= r.y1; y++) {
      w.cells.push({ wx: r.x0 - 1, wy: y, fx: r.x0, fy: y });
      e.cells.push({ wx: r.x1 + 1, wy: y, fx: r.x1, fy: y });
    }
    for (const q of out) q.hasDoor = q.cells.some((c) => tile(c.wx, c.wy) !== T.WALL);
    return out;
  }
  const faceCells = (s) =>
    s.cells.filter((c) => straight(c.wx, c.wy, s.dir) && faceFree(c.wx, c.wy, s.dir) && !clear[I(c.fx, c.fy)] && !furn[I(c.fx, c.fy)]);

  function addCloset(r, avoid) {
    for (const s of shuffle(sides(r).filter((q) => !q.hasDoor && q.name !== avoid))) {
      const cells = faceCells(s);
      if (!cells.length) continue;
      const c = pick(cells);
      hides.push({ x: c.wx, y: c.wy, fx: c.fx, fy: c.fy, dir: s.dir, kind: 'closet' });
      useFace(c.wx, c.wy, s.dir);
      markClear(c.fx, c.fy);
      return true;
    }
    return false;
  }
  function addBoard(r, s, text) {
    const n = s.cells.length;
    const len = Math.max(2, Math.min(n - 2, 6));
    const start = Math.floor((n - len) / 2);
    const cells = s.cells.slice(start, start + len).filter((c) => tile(c.wx, c.wy) === T.WALL);
    if (!cells.length) return;
    decor.push({ k: 'board', dir: s.dir, cells: cells.map((c) => [c.wx, c.wy]), text });
    cells.forEach((c) => useFace(c.wx, c.wy, s.dir));
  }

  // ---- furniture
  const inFloor = (x, y) => tile(x, y) === T.ROOM || tile(x, y) === T.HALL;
  function put(x, y, k, d = 0, force = false) {
    if (!inb(x, y) || !inFloor(x, y)) return false;
    const i = I(x, y);
    if (furn[i]) return false;
    if (FSOLID[k] && clear[i] && !force) return false;
    furn[i] = k;
    fdir[i] = d;
    return true;
  }
  function putRect(x, y, w, h, k, d = 0, r = null) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!inb(xx, yy) || !inFloor(xx, yy) || furn[I(xx, yy)] || clear[I(xx, yy)]) return false;
        if (r && roomAt[I(xx, yy)] !== r.id) return false;
      }
    }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, k, d);
    return true;
  }
  function scatter(r, kinds, n) {
    for (let k = 0; k < n; k++) {
      const x = ri(r.x0, r.x1);
      const y = ri(r.y0, r.y1);
      const kind = pick(kinds);
      if (!FSOLID[kind] || !clear[I(x, y)]) put(x, y, kind, ri(0, 3));
    }
  }
  // Furniture standing against one side of a room (row of tiles just inside the wall).
  function alongSide(r, s, k, count, startOffset = 1) {
    const cells = s.cells.slice(startOffset, s.cells.length - startOffset);
    let placed = 0;
    for (const c of shuffle(cells.slice())) {
      if (placed >= count) break;
      if (put(c.fx, c.fy, k, s.dir)) placed++;
    }
    return placed;
  }

  function furnishClass(r, detention) {
    const ss = sides(r);
    const s = shuffle(ss.filter((q) => !q.hasDoor && !q.ext))[0] || ss.find((q) => !q.hasDoor) || ss[0];
    addBoard(r, s, detention ? 'DETENTION' : pick(BOARD_TEXT));
    if (detention || chance(0.65)) addCloset(r, s.name);
    const { x0, y0, x1, y1 } = r;
    const cx = (x0 + x1) >> 1;
    const cy = (y0 + y1) >> 1;
    const face = { N: 0, E: 1, S: 2, W: 3 }[s.name];
    if (s.name === 'N') putRect(cx - 1, y0 + 1, 2, 1, F.TDESK, 2);
    else if (s.name === 'S') putRect(cx - 1, y1 - 1, 2, 1, F.TDESK, 0);
    else if (s.name === 'W') putRect(x0 + 1, cy - 1, 1, 2, F.TDESK, 1);
    else putRect(x1 - 1, cy - 1, 1, 2, F.TDESK, 3);
    const maxRows = detention ? 2 : 99;
    const desk = (x, y) => {
      const v = R();
      if (v < 0.1) put(x, y, F.CHAIR, ri(0, 3));
      else if (v > 0.06 + 0.1) put(x, y, F.DESK, face);
    };
    if (s.name === 'N' || s.name === 'S') {
      const ys = [];
      if (s.name === 'N') for (let y = y0 + 3; y <= y1 - 1; y += 2) ys.push(y);
      else for (let y = y1 - 3; y >= y0 + 1; y -= 2) ys.push(y);
      ys.slice(0, maxRows).forEach((y) => {
        for (let x = x0 + 1; x <= x1 - 1; x += 2) desk(x, y);
      });
    } else {
      const xs = [];
      if (s.name === 'W') for (let x = x0 + 3; x <= x1 - 1; x += 2) xs.push(x);
      else for (let x = x1 - 3; x >= x0 + 1; x -= 2) xs.push(x);
      xs.slice(0, maxRows).forEach((x) => {
        for (let y = y0 + 1; y <= y1 - 1; y += 2) desk(x, y);
      });
    }
    scatter(r, [F.PAPERS, F.BACKPACK, F.BOOKS], ri(2, 5));
  }

  function furnishLibrary(r) {
    const { x0, y0, x1, y1 } = r;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w >= h) {
      for (let y = y0 + 2; y <= y1 - 2; y += 3) {
        const gaps = new Set();
        for (let g = 0; g < (w > 13 ? 2 : 1); g++) {
          const gx = ri(x0 + 3, x1 - 4);
          gaps.add(gx);
          gaps.add(gx + 1);
        }
        for (let x = x0 + 2; x <= x1 - 2; x++) if (!gaps.has(x)) put(x, y, F.SHELF, 0);
      }
    } else {
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        const gaps = new Set();
        for (let g = 0; g < (h > 13 ? 2 : 1); g++) {
          const gy = ri(y0 + 3, y1 - 4);
          gaps.add(gy);
          gaps.add(gy + 1);
        }
        for (let y = y0 + 2; y <= y1 - 2; y++) if (!gaps.has(y)) put(x, y, F.SHELF, 1);
      }
    }
    scatter(r, [F.BOOKS, F.BOOKS, F.PAPERS, F.CHAIR], ri(5, 9));
  }

  function furnishGym(r) {
    const { x0, y0, x1, y1 } = r;
    const ss = sides(r);
    const horizontal = x1 - x0 >= y1 - y0;
    const cand = ss.filter((s) => (horizontal ? s.name === 'N' || s.name === 'S' : s.name === 'W' || s.name === 'E'));
    const s = cand.find((q) => !q.hasDoor) || cand[0];
    for (const c of s.cells.slice(2, -2)) {
      const [dx, dy] = DIRS[s.dir];
      put(c.fx, c.fy, F.BLEACH, s.dir);
      put(c.fx + dx, c.fy + dy, F.BLEACH, s.dir);
    }
    const mx = chance(0.5) ? x0 + 1 : x1 - 3;
    const my = s.name === 'N' || (!horizontal && chance(0.5)) ? y1 - 2 : y0 + 1;
    for (let y = my; y < my + 2; y++) for (let x = mx; x < mx + 3; x++) put(x, y, F.MAT, 0);
    r.court = true;
    scatter(r, [F.BACKPACK, F.PAPERS], 3);
  }

  function furnishCafeteria(r) {
    const { x0, y0, x1, y1 } = r;
    for (let y = y0 + 2; y <= y1 - 3; y += 3) {
      for (let x = x0 + 2; x + 3 <= x1 - 2; x += 6) putRect(x, y, 4, 1, F.TABLE, 0, r);
    }
    const ss = sides(r);
    const cs = ss.find((s) => (s.name === 'S' || s.name === 'N') && !s.hasDoor);
    if (cs) for (const c of cs.cells.slice(3, -3)) put(c.fx, c.fy, F.COUNTER, cs.dir);
    const vs = shuffle(ss.filter((s) => (s.name === 'W' || s.name === 'E') && !s.hasDoor))[0];
    if (vs) alongSide(r, vs, F.VEND, 3, 1);
    scatter(r, [F.TRASH, F.PAPERS, F.BACKPACK, F.CHAIR], ri(4, 7));
  }

  function furnishLab(r) {
    const ss = sides(r);
    const s = shuffle(ss.filter((q) => !q.hasDoor && !q.ext))[0] || ss.find((q) => !q.hasDoor);
    if (s) addBoard(r, s, pick(['H₂O', 'NaCl', 'GOGGLES ON', 'DO NOT TOUCH']));
    if (chance(0.5)) addCloset(r, s && s.name);
    const { x0, y0, x1, y1 } = r;
    for (let y = y0 + 2; y <= y1 - 1; y += 3) {
      for (let x = x0 + 1; x + 2 <= x1 - 1; x += 4) if (putRect(x, y, 2, 1, F.BENCH, 0, r)) put(x + 2, y, F.SINK, 0);
    }
    scatter(r, [F.PAPERS, F.CHAIR], 3);
  }

  function furnishMusic(r) {
    const { x0, y0, x1, y1 } = r;
    if (!putRect(x1 - 2, y0 + 1, 2, 1, F.PIANO, 2, r)) putRect(x0 + 1, y1 - 1, 2, 1, F.PIANO, 0, r);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * 2.5);
      const y = Math.round(cy + Math.sin(a) * 2);
      put(x, y, F.CHAIR, Math.round(((a + Math.PI) / (Math.PI / 2)) % 4));
    }
    addCloset(r, null);
    scatter(r, [F.PAPERS], 4);
  }

  function furnishArt(r) {
    const { x0, y0, x1, y1 } = r;
    for (let y = y0 + 2; y <= y1 - 1; y += 3) for (let x = x0 + 2; x <= x1 - 1; x += 3) if (chance(0.7)) put(x, y, F.EASEL, ri(0, 3));
    putRect(x0 + 1, y1 - 1, 2, 1, F.TABLE, 0, r);
    r.paint = true;
    addCloset(r, null);
    scatter(r, [F.PAPERS, F.CHAIR], 4);
  }

  function furnishBath(r) {
    const ss = sides(r);
    const s = shuffle(ss.filter((q) => !q.hasDoor))[0];
    if (s) {
      const [dx, dy] = DIRS[s.dir];
      s.cells.forEach((c, k) => {
        if (k % 2 === 1) {
          put(c.fx, c.fy, F.STALL, s.dir);
          put(c.fx + dx, c.fy + dy, F.STALL, s.dir);
        } else if (!clear[I(c.fx, c.fy)]) {
          decor.push({ k: 'toilet', x: c.fx, y: c.fy, dir: s.dir });
        }
      });
      const opp = ss.find((q) => q.dir === (s.dir + 2) % 4);
      if (opp) opp.cells.forEach((c, k) => k % 2 === 0 && put(c.fx, c.fy, F.SINK, opp.dir));
    }
    scatter(r, [F.PUDDLE, F.PAPERS], 3);
  }

  function furnishOffice(r) {
    const c = center(r);
    putRect(c.x - 1, c.y, 2, 1, F.TDESK, 2, r);
    put(c.x, c.y + 1, F.CHAIR, 0);
    const ss = sides(r).filter((q) => !q.hasDoor);
    if (ss.length) alongSide(r, pick(ss), F.CABINET, 3, 1);
    for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) if (chance(0.5)) put(x, y, F.PLANT, 0);
    if (straight(c.x, r.y0 - 1, 2) && faceFree(c.x, r.y0 - 1, 2)) {
      decor.push({ k: 'frame', x: c.x, y: r.y0 - 1, dir: 2 });
      useFace(c.x, r.y0 - 1, 2);
    }
    scatter(r, [F.PAPERS], 3);
  }

  function furnishNurse(r) {
    const ss = sides(r).filter((q) => !q.hasDoor);
    const s = ss[0] || sides(r)[0];
    const [dx, dy] = DIRS[s.dir];
    s.cells.forEach((c, k) => {
      if (k % 3 === 1) {
        put(c.fx, c.fy, F.COT, s.dir);
        put(c.fx + dx, c.fy + dy, F.COT, s.dir);
      }
    });
    const o = ss[1];
    if (o) alongSide(r, o, F.CABINET, 2, 1);
    addCloset(r, s.name);
  }

  function furnishBoiler(r) {
    let options = shuffle(sides(r).filter((q) => !q.hasDoor));
    if (!options.length) options = sides(r);
    for (const s of options) {
      let cells = faceCells(s);
      if (!cells.length) cells = s.cells.filter((c) => tile(c.wx, c.wy) === T.WALL);
      if (!cells.length) continue;
      const c = cells[cells.length >> 1];
      fusebox = { x: c.wx, y: c.wy, fx: c.fx, fy: c.fy, dir: s.dir };
      useFace(c.wx, c.wy, s.dir);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) markClear(c.fx + dx, c.fy + dy);
      break;
    }
    const c = center(r);
    if (!putRect(c.x - 1, c.y - 1, 2, 2, F.BOILER, 0, r)) {
      for (let k = 0; k < 20; k++) if (putRect(ri(r.x0 + 1, r.x1 - 2), ri(r.y0 + 1, r.y1 - 2), 2, 2, F.BOILER, 0, r)) break;
    }
    const ps = shuffle(sides(r).filter((q) => !q.hasDoor && (!fusebox || q.dir !== fusebox.dir)))[0];
    if (ps) for (const cc of ps.cells.slice(1, -1)) put(cc.fx, cc.fy, F.PIPE, ps.dir);
    scatter(r, [F.PUDDLE], 4);
  }

  function furnishJanitor(r) {
    const ss = sides(r).filter((q) => !q.hasDoor);
    if (ss.length) alongSide(r, ss[0], F.SHELF, 3, 0);
    scatter(r, [F.BUCKET, F.PUDDLE, F.PUDDLE], 3);
  }

  function furnishLobby(r) {
    const ss = sides(r);
    for (const s of ss.filter((q) => q.name === 'W' || q.name === 'E')) {
      s.cells.forEach((c, k) => {
        if (k > 0 && k < s.cells.length - 1 && k % 3 !== 0) put(c.fx, c.fy, F.TROPHY, s.dir);
      });
    }
    for (const [x, y] of [[r.x0, r.y1], [r.x1, r.y1], [r.x0 + 1, r.y0 + 1], [r.x1 - 1, r.y0 + 1]]) put(x, y, F.PLANT, 0);
    const c = center(r);
    putRect(c.x - 5, c.y + 1, 2, 1, F.SEAT, 0, r);
    putRect(c.x + 4, c.y + 1, 2, 1, F.SEAT, 0, r);
    r.crest = true;
    decor.push({ k: 'exitsign', x: exit.x0, y: exit.y, dir: 0 });
    lights.push({ x: exit.x0 + 1, y: exit.y - 0.15, a: -Math.PI / 2, arc: Math.PI * 2, r: 3.2, i: 0.55, c: 'exit' });
  }

  for (const r of rooms) {
    switch (r.type) {
      case 'class': furnishClass(r, false); break;
      case 'detention': furnishClass(r, true); break;
      case 'library': furnishLibrary(r); break;
      case 'gym': furnishGym(r); break;
      case 'cafeteria': furnishCafeteria(r); break;
      case 'lab': furnishLab(r); break;
      case 'music': furnishMusic(r); break;
      case 'art': furnishArt(r); break;
      case 'bath': furnishBath(r); break;
      case 'office': furnishOffice(r); break;
      case 'nurse': furnishNurse(r); break;
      case 'boiler': furnishBoiler(r); break;
      case 'janitor': furnishJanitor(r); break;
      case 'lobby': furnishLobby(r); break;
      default: break;
    }
  }

  // ---- lockers along the hallways (every one is a hiding spot)
  function lockerOk(x, y, d) {
    if (!straight(x, y, d) || !faceFree(x, y, d)) return false;
    const [dx, dy] = DIRS[d];
    return tile(x + dx, y + dy) === T.HALL && !furn[I(x + dx, y + dy)];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let d = 0; d < 4; d++) {
        if (!lockerOk(x, y, d) || !chance(0.07)) continue;
        const len = ri(2, 5);
        const color = pick(LOCKER_COLORS);
        const [px, py] = d === 0 || d === 2 ? [1, 0] : [0, 1];
        const [dx, dy] = DIRS[d];
        let cx = x;
        let cy = y;
        for (let k = 0; k < len && lockerOk(cx, cy, d); k++) {
          hides.push({ x: cx, y: cy, fx: cx + dx, fy: cy + dy, dir: d, kind: 'locker', color });
          useFace(cx, cy, d);
          markClear(cx + dx, cy + dy);
          cx += px;
          cy += py;
        }
      }
    }
  }

  // ---- windows (moonlight), posters
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ext = x === 1 || y === 1 || x === W - 2 || y === H - 2;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        const front = tile(x + dx, y + dy);
        if (front !== T.HALL && front !== T.ROOM) continue;
        if (!straight(x, y, d) || !faceFree(x, y, d)) continue;
        if (ext) {
          const along = d === 0 || d === 2 ? x : y;
          if (along % 5 === 1 || along % 5 === 2) {
            decor.push({ k: 'window', x, y, dir: d });
            useFace(x, y, d);
            if (along % 5 === 1) {
              const lx = x + 0.5 + dx * 0.55 + (d === 0 || d === 2 ? 0.5 : 0);
              const ly = y + 0.5 + dy * 0.55 + (d === 1 || d === 3 ? 0.5 : 0);
              lights.push({ x: lx, y: ly, a: Math.atan2(dy, dx), arc: 1.9, r: 4.6, i: 0.42, c: 'moon' });
            }
          }
        } else if (front === T.HALL && chance(0.05)) {
          decor.push({ k: 'poster', x, y, dir: d, v: ri(0, 7) });
          useFace(x, y, d);
        }
      }
    }
  }

  // ---- hallway clutter
  const hallTiles = [];
  for (let i = 0; i < N; i++) if (tiles[i] === T.HALL) hallTiles.push(i);
  for (let k = 0; k < 9; k++) {
    const i = pick(hallTiles);
    put(i % W, Math.floor(i / W), F.PUDDLE, 0);
  }
  for (let k = 0; k < 26; k++) {
    const i = pick(hallTiles);
    put(i % W, Math.floor(i / W), pick([F.PAPERS, F.PAPERS, F.BACKPACK, F.BOOKS]), ri(0, 3));
  }
  for (let k = 0; k < 8; k++) {
    const i = pick(hallTiles);
    const x = i % W;
    const y = Math.floor(i / W);
    const nearWall = DIRS.some(([dx, dy]) => tile(x + dx, y + dy) === T.WALL);
    if (nearWall) put(x, y, F.TRASH, 0);
  }

  // ---- graffiti hints scrawled on floors
  for (let k = 0; k < 7; k++) {
    const i = pick(hallTiles);
    decor.push({ k: 'graffiti', x: i % W + 0.5, y: Math.floor(i / W) + 0.5, text: pick(GRAFFITI), rot: (R() - 0.5) * 0.6 });
  }

  // ---- spawn and reachability repair
  let spawnTile = null;
  for (let k = 0; k < 200 && !spawnTile; k++) {
    const x = ri(det.x0, det.x1);
    const y = ri(det.y0, det.y1);
    if (!FSOLID[furn[I(x, y)]] && !clear[I(x, y)]) spawnTile = { x, y };
  }
  if (!spawnTile) {
    spawnTile = center(det);
    furn[I(spawnTile.x, spawnTile.y)] = 0;
  }

  // Optional collapsed ceiling blocking one interior hallway segment.
  if (chance(0.55)) {
    const k = ri(0, 1);
    const y0 = hy[k];
    const xs = [];
    const hideFronts = new Set(hides.map((h) => I(h.fx, h.fy)));
    for (let x = vx[0] + 5; x <= vx[1] - 3; x++) {
      const ok = [-1, 0, 1].every((o) => tile(x + o, y0 - 1) === T.WALL && tile(x + o, y0 + 3) === T.WALL);
      if (ok && !hideFronts.has(I(x, y0)) && !hideFronts.has(I(x, y0 + 2))) xs.push(x);
    }
    if (xs.length) {
      const x = pick(xs);
      const before = bfs(spawnTile.x, spawnTile.y, false);
      const saved = [0, 1, 2].map((o) => furn[I(x, y0 + o)]);
      for (let o = 0; o < 3; o++) {
        furn[I(x, y0 + o)] = F.DEBRIS;
        fdir[I(x, y0 + o)] = o;
      }
      const after = bfs(spawnTile.x, spawnTile.y, false);
      let lost = false;
      for (let i = 0; i < N && !lost; i++) if (before[i] >= 0 && after[i] < 0 && !(i % W === x && i >= I(x, y0) && i <= I(x, y0 + 2))) lost = true;
      if (lost) for (let o = 0; o < 3; o++) furn[I(x, y0 + o)] = saved[o];
    }
  }

  for (let iter = 0; iter < 300; iter++) {
    const rc = bfs(spawnTile.x, spawnTile.y, false);
    let u = -1;
    for (let i = 0; i < N; i++) {
      if ((tiles[i] === T.HALL || tiles[i] === T.ROOM) && !FSOLID[furn[i]] && rc[i] < 0) {
        u = i;
        break;
      }
    }
    if (u < 0) break;
    // Walk from the stranded tile towards reachable space, clearing furniture on the way.
    const prev = new Int32Array(N).fill(-1);
    const q = [u];
    prev[u] = u;
    let hit = -1;
    for (let qi = 0; qi < q.length && hit < 0; qi++) {
      const c = q[qi];
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const ni = I(nx, ny);
        const t = tiles[ni];
        if (prev[ni] >= 0 || (t !== T.HALL && t !== T.ROOM && t !== T.DOOR)) continue;
        prev[ni] = c;
        if (rc[ni] >= 0) {
          hit = ni;
          break;
        }
        q.push(ni);
      }
    }
    if (hit < 0) {
      // Unreachable pocket with no route at all: fill it in.
      for (const c of q) if (tiles[c] !== T.DOOR) furn[c] = F.DEBRIS;
      continue;
    }
    for (let c = hit; c !== u; c = prev[c]) if (FSOLID[furn[c]]) furn[c] = 0;
  }

  // ---- items
  const reach = bfs(spawnTile.x, spawnTile.y, false);
  const used = new Set();
  const freeTile = (x, y) => {
    const i = I(x, y);
    return inFloor(x, y) && !FSOLID[furn[i]] && reach[i] >= 0 && !used.has(i) && furn[i] !== F.PUDDLE;
  };
  const tileIn = (r) => {
    for (let k = 0; k < 80; k++) {
      const x = ri(r.x0, r.x1);
      const y = ri(r.y0, r.y1);
      if (freeTile(x, y)) return { x, y };
    }
    return null;
  };
  const hallTile = () => {
    for (let k = 0; k < 100; k++) {
      const i = pick(hallTiles);
      if (freeTile(i % W, Math.floor(i / W))) return { x: i % W, y: Math.floor(i / W) };
    }
    return null;
  };
  const items = [];
  const addItem = (k, t) => {
    if (!t) return;
    used.add(I(t.x, t.y));
    items.push({ k, x: t.x + 0.5, y: t.y + 0.5 });
  };
  const fusesNeeded = Math.min(6, 3 + Math.floor(nPlayers / 2));
  const boilerRoom = rooms.find((r) => r.type === 'boiler');
  const pts = [center(det), center(boilerRoom), center(lobby)];
  const fuseRooms = rooms.filter((r) => !['detention', 'boiler', 'lobby'].includes(r.type));
  const chosen = [];
  for (let k = 0; k < fusesNeeded && fuseRooms.length; k++) {
    let best = null;
    let bestScore = -1;
    for (const r of fuseRooms) {
      if (chosen.includes(r)) continue;
      const c = center(r);
      const dmin = Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      const score = dmin * (0.6 + 0.8 * R());
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) break;
    chosen.push(best);
    pts.push(center(best));
    addItem('fuse', tileIn(best));
  }
  while (items.filter((i) => i.k === 'fuse').length < fusesNeeded) addItem('fuse', hallTile());

  const others = rooms.filter((r) => r.type !== 'detention');
  const nb = 5 + 2 * nPlayers + diff.extraBatteries;
  for (let k = 0; k < nb; k++) addItem('battery', chance(0.6) ? tileIn(pick(others)) : hallTile());
  for (let k = 0; k < 2 + nPlayers; k++) addItem('clock', chance(0.5) ? tileIn(pick(others)) : hallTile());
  const caf = rooms.find((r) => r.type === 'cafeteria');
  for (let k = 0; k < 1 + Math.ceil(nPlayers / 2); k++) addItem('drink', k === 0 && caf ? tileIn(caf) : tileIn(pick(others)));

  // ---- spawns
  const spawns = [];
  const detTiles = [];
  for (let y = det.y0; y <= det.y1; y++) for (let x = det.x0; x <= det.x1; x++) if (freeTile(x, y)) detTiles.push({ x, y });
  shuffle(detTiles);
  spawns.push(spawnTile);
  for (const t of detTiles) if (spawns.length < Math.max(8, nPlayers) && !(t.x === spawnTile.x && t.y === spawnTile.y)) spawns.push(t);

  const far = [];
  for (let i = 0; i < N; i++) {
    if (reach[i] >= 34 && tiles[i] === T.ROOM && !FSOLID[furn[i]]) far.push({ x: i % W, y: Math.floor(i / W), d: reach[i] });
  }
  far.sort((a, b) => b.d - a.d);
  const monsterSpawns = [];
  for (const t of shuffle(far.slice(0, Math.max(10, far.length >> 1)))) {
    if (monsterSpawns.every((m) => Math.hypot(m.x - t.x, m.y - t.y) > 15)) monsterSpawns.push({ x: t.x, y: t.y });
    if (monsterSpawns.length >= 3) break;
  }
  if (!monsterSpawns.length) {
    let best = 0;
    for (let i = 0; i < N; i++) if (reach[i] > reach[best]) best = i;
    monsterSpawns.push({ x: best % W, y: Math.floor(best / W) });
  }

  return {
    w: W, h: H, tiles, furn, fdir, roomAt, doorAt,
    rooms: rooms.map(({ id, type, name, x0, y0, x1, y1, court, crest, paint }) => ({ id, type, name, x0, y0, x1, y1, court: !!court, crest: !!crest, paint: !!paint })),
    doors, hides, decor, lights, fusebox, exit, spawns, monsterSpawns, items, fusesNeeded,
    exitOpen: false,
  };
}
