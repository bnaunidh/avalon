// Tile queries and ray casting shared by server (monster AI) and client (lighting).
import { T, FSOLID, FOPAQUE } from './constants.js';

export function opaqueAt(m, x, y) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
  const i = y * m.w + x;
  const t = m.tiles[i];
  if (t === T.WALL || t === T.VOID) return true;
  if (t === T.DOOR) return !m.doors[m.doorAt[i]].open;
  if (t === T.EXIT) return !m.exitOpen;
  return FOPAQUE[m.furn[i]] === 1;
}

export function solidAt(m, x, y) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
  const i = y * m.w + x;
  const t = m.tiles[i];
  if (t === T.WALL || t === T.VOID) return true;
  if (t === T.DOOR) return !m.doors[m.doorAt[i]].open;
  if (t === T.EXIT) return !m.exitOpen;
  return FSOLID[m.furn[i]] === 1;
}

// The monster treats every door as passable (it opens them) and never uses the exit.
export function walkMon(m, x, y) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
  const i = y * m.w + x;
  const t = m.tiles[i];
  if (t === T.HALL || t === T.ROOM) return FSOLID[m.furn[i]] === 0;
  return t === T.DOOR;
}

// Distance along (dx,dy) (unit vector) until the ray enters an opaque tile, capped at maxD.
export function castRay(m, ox, oy, dx, dy, maxD) {
  let tx = Math.floor(ox);
  let ty = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx > 0 ? (tx + 1 - ox) * tdx : dx < 0 ? (ox - tx) * tdx : Infinity;
  let tmy = dy > 0 ? (ty + 1 - oy) * tdy : dy < 0 ? (oy - ty) * tdy : Infinity;
  let d = 0;
  for (let n = 0; n < 256; n++) {
    if (tmx < tmy) {
      d = tmx;
      tmx += tdx;
      tx += stepX;
    } else {
      d = tmy;
      tmy += tdy;
      ty += stepY;
    }
    if (d >= maxD) return maxD;
    if (opaqueAt(m, tx, ty)) return d;
  }
  return maxD;
}

export function los(m, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  return castRay(m, x0, y0, dx / d, dy / d, d) >= d - 1e-4;
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
