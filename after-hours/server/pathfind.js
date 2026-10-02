// A* over the tile grid for the monster. 8-way moves, no corner cutting.
import { T } from '../shared/constants.js';
import { walkMon } from '../shared/grid.js';

const NB = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export function findPath(m, sx, sy, gx, gy) {
  const W = m.w;
  if (!walkMon(m, gx, gy)) {
    let found = false;
    for (const [dx, dy] of NB) {
      if (walkMon(m, gx + dx, gy + dy)) {
        gx += dx;
        gy += dy;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  if (!walkMon(m, sx, sy)) {
    for (const [dx, dy] of NB) {
      if (walkMon(m, sx + dx, sy + dy)) {
        sx += dx;
        sy += dy;
        break;
      }
    }
  }
  const N = W * m.h;
  const start = sy * W + sx;
  const goal = gy * W + gx;
  if (start === goal) return [[gx, gy]];
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap();
  const h = (x, y) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(h(sx, sy), start);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > 6000) return null;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (const [dx, dy, cost] of NB) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkMon(m, nx, ny)) continue;
      if (dx && dy && (!walkMon(m, cx + dx, cy) || !walkMon(m, cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      let c = cost;
      if (m.tiles[ni] === T.DOOR) {
        if (dx && dy) continue; // walk straight through doorways
        if (!m.doors[m.doorAt[ni]].open) c += 2;
      }
      const ng = g[cur] + c;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ng + h(nx, ny), ni);
      }
    }
  }
  if (came[goal] < 0) return null;
  const path = [];
  for (let c = goal; c !== start; c = came[c]) path.push([c % W, Math.floor(c / W)]);
  path.reverse();
  return path;
}
