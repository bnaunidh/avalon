// Canvas renderer: a pre-drawn school, ray-cast flashlights and a darkness mask.
import { T, F, FSOLID } from '/shared/constants.js';
import { castRay, los, opaqueAt } from '/shared/grid.js';

const MS = 48; // pixels per tile in the pre-rendered map
const MON_SCALE = 1.45; // The Hall Monitor is a lot bigger than you
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(h, amt) {
  const [r, g, b] = hexToRgb(h);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const FLOOR = {
  hall: { kind: 'checker', a: '#7d7b72', b: '#74726a' },
  class: { kind: 'checker', a: '#8b7a5c', b: '#837256' },
  detention: { kind: 'checker', a: '#7a6b55', b: '#72644f' },
  lobby: { kind: 'marble', a: '#9a9488' },
  cafeteria: { kind: 'big', a: '#8a8682', b: '#6a3c38' },
  library: { kind: 'carpet', a: '#4d2627' },
  office: { kind: 'carpet', a: '#323e58' },
  gym: { kind: 'wood', a: '#a27c48' },
  music: { kind: 'wood', a: '#7b5b3d' },
  bath: { kind: 'small', a: '#b5b9ba' },
  nurse: { kind: 'checker', a: '#8fa593', b: '#879c8b' },
  lab: { kind: 'checker', a: '#4f555b', b: '#4a4f55' },
  boiler: { kind: 'concrete', a: '#545350' },
  janitor: { kind: 'concrete', a: '#555450' },
  art: { kind: 'concrete', a: '#76746e' },
};

// Rotate so that "forward" (local -y) points along dir (0 N, 1 E, 2 S, 3 W).
function rotDir(g, d) {
  g.rotate((d * Math.PI) / 2);
}
// Rotate so that local +y points from a wall tile to the floor in front of it.
function rotFace(g, d) {
  g.rotate(((d - 2) * Math.PI) / 2);
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function text(g, str, x, y, sizeTiles, color, rot = 0, font = 'bold', align = 'center') {
  g.save();
  const m = g.getTransform();
  g.setTransform(1, 0, 0, 1, m.a * x + m.e, m.d * y + m.f);
  g.rotate(rot);
  g.font = `${font} ${Math.max(6, sizeTiles * m.a)}px "Courier New", monospace`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(str, 0, 0);
  g.restore();
}

// ------------------------------------------------------------------ pre-render
function prerender(map) {
  const W = map.w;
  const H = map.h;
  const c = document.createElement('canvas');
  c.width = W * MS;
  c.height = H * MS;
  const g = c.getContext('2d');
  g.setTransform(MS, 0, 0, MS, 0, 0);
  const R = rng(4242);
  const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.VOID : map.tiles[y * W + x]);
  const floorish = (t) => t === T.HALL || t === T.ROOM || t === T.DOOR || t === T.EXIT;
  const roomOf = (x, y) => {
    const r = map.roomAt[y * W + x];
    return r >= 0 ? map.rooms[r] : null;
  };

  // floors
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = map.tiles[y * W + x];
      if (t === T.VOID) {
        g.fillStyle = '#07090a';
        g.fillRect(x, y, 1, 1);
        if (R() < 0.5) {
          g.fillStyle = 'rgba(40,60,40,0.25)';
          g.fillRect(x + R(), y + R(), 0.05, 0.12);
        }
        continue;
      }
      if (t === T.WALL) continue;
      let type = 'hall';
      if (t === T.ROOM || t === T.EXIT) type = roomOf(x, y)?.type || 'lobby';
      if (t === T.EXIT) type = 'lobby';
      if (t === T.DOOR) {
        g.fillStyle = '#3d3a36';
        g.fillRect(x, y, 1, 1);
        continue;
      }
      drawFloor(g, x, y, FLOOR[type] || FLOOR.hall, R);
    }
  }

  // room floor art
  for (const r of map.rooms) {
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    if (r.court) {
      g.save();
      g.strokeStyle = 'rgba(235,235,225,0.55)';
      g.lineWidth = 0.07;
      const x0 = r.x0 + 1.5;
      const y0 = r.y0 + 1.5;
      const cw = w - 3;
      const ch = h - 3;
      g.strokeRect(x0, y0, cw, ch);
      const horiz = cw >= ch;
      g.beginPath();
      if (horiz) {
        g.moveTo(x0 + cw / 2, y0);
        g.lineTo(x0 + cw / 2, y0 + ch);
      } else {
        g.moveTo(x0, y0 + ch / 2);
        g.lineTo(x0 + cw, y0 + ch / 2);
      }
      g.stroke();
      g.beginPath();
      g.arc(x0 + cw / 2, y0 + ch / 2, Math.min(cw, ch) * 0.16, 0, TAU);
      g.stroke();
      g.strokeStyle = 'rgba(170,40,40,0.55)';
      const kw = horiz ? cw * 0.16 : ch * 0.16;
      const kh = horiz ? ch * 0.36 : cw * 0.36;
      if (horiz) {
        g.strokeRect(x0, y0 + (ch - kh) / 2, kw, kh);
        g.strokeRect(x0 + cw - kw, y0 + (ch - kh) / 2, kw, kh);
      } else {
        g.strokeRect(x0 + (cw - kh) / 2, y0, kh, kw);
        g.strokeRect(x0 + (cw - kh) / 2, y0 + ch - kw, kh, kw);
      }
      g.restore();
      text(g, 'HOME OF THE OWLS', r.x0 + w / 2, r.y0 + h / 2 + Math.min(cw, ch) * 0.3, 0.45, 'rgba(120,30,30,0.5)');
    }
    if (r.crest) {
      const cx = (r.x0 + r.x1 + 1) / 2;
      const cy = (r.y0 + r.y1 + 1) / 2;
      g.fillStyle = '#4e1d21';
      g.beginPath();
      g.arc(cx, cy, 2.1, 0, TAU);
      g.fill();
      g.strokeStyle = '#a5843a';
      g.lineWidth = 0.12;
      g.stroke();
      g.lineWidth = 0.04;
      g.beginPath();
      g.arc(cx, cy, 1.75, 0, TAU);
      g.stroke();
      text(g, 'AH', cx, cy - 0.15, 1.2, '#b8954a', 0, 'bold');
      text(g, 'EST. 1962', cx, cy + 0.9, 0.32, '#b8954a', 0, 'bold');
    }
    if (r.paint) {
      const cols = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'];
      for (let k = 0; k < w * h * 0.25; k++) {
        g.fillStyle = cols[Math.floor(R() * cols.length)];
        g.globalAlpha = 0.35;
        g.beginPath();
        g.arc(r.x0 + R() * w, r.y0 + R() * h, 0.05 + R() * 0.2, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  // ambient occlusion where floors meet walls
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!floorish(tile(x, y))) continue;
      const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      sides.forEach(([dx, dy]) => {
        const t = tile(x + dx, y + dy);
        if (t !== T.WALL && t !== T.VOID) return;
        const x0 = dx > 0 ? x + 1 : x;
        const y0 = dy > 0 ? y + 1 : y;
        const gr = g.createLinearGradient(x0, y0, x0 - dx * 0.35, y0 - dy * 0.35);
        gr.addColorStop(0, 'rgba(0,0,0,0.45)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        if (dx) g.fillRect(dx > 0 ? x + 0.65 : x, y, 0.35, 1);
        else g.fillRect(x, dy > 0 ? y + 0.65 : y, 1, 0.35);
      });
    }
  }

  // decals: graffiti, toilets
  for (const d of map.decor) {
    if (d.k === 'graffiti') {
      text(g, d.text, d.x, d.y, 0.42, 'rgba(150,18,18,0.85)', d.rot, 'bold');
      g.fillStyle = 'rgba(150,18,18,0.6)';
      for (let k = 0; k < 4; k++) g.fillRect(d.x - 0.8 + R() * 1.6, d.y + 0.12, 0.025, 0.08 + R() * 0.25);
    } else if (d.k === 'toilet') {
      g.save();
      g.translate(d.x + 0.5, d.y + 0.5);
      rotFace(g, d.dir);
      g.fillStyle = '#d9dcdc';
      g.fillRect(-0.18, -0.5, 0.36, 0.16);
      g.beginPath();
      g.ellipse(0, -0.12, 0.2, 0.25, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#9aa3a6';
      g.beginPath();
      g.ellipse(0, -0.1, 0.12, 0.16, 0, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  // furniture
  const seen = new Uint8Array(W * H);
  const multi = new Set([F.TDESK, F.SHELF, F.TABLE, F.BENCH, F.BLEACH, F.BOILER, F.COUNTER, F.TROPHY, F.COT, F.PIANO, F.SEAT, F.MAT, F.DEBRIS]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = map.furn[i];
      if (!k || seen[i]) continue;
      if (multi.has(k)) {
        // flood the component (straight runs / rectangles)
        let x1 = x;
        while (x1 + 1 < W && map.furn[y * W + x1 + 1] === k && !seen[y * W + x1 + 1]) x1++;
        let y1 = y;
        const rowOk = (yy) => {
          for (let xx = x; xx <= x1; xx++) if (map.furn[yy * W + xx] !== k || seen[yy * W + xx]) return false;
          return true;
        };
        while (y1 + 1 < H && rowOk(y1 + 1)) y1++;
        for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) seen[yy * W + xx] = 1;
        drawFurnBlock(g, k, x, y, x1 - x + 1, y1 - y + 1, map.fdir[i], R);
      } else {
        seen[i] = 1;
        drawFurnTile(g, k, x, y, map.fdir[i], R);
      }
    }
  }

  // walls
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.tiles[y * W + x] !== T.WALL) continue;
      g.fillStyle = '#26242c';
      g.fillRect(x, y, 1, 1);
      if (R() < 0.6) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + R() * 0.8, y + R() * 0.8, 0.12, 0.12);
      }
      const ns = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      ns.forEach(([dx, dy]) => {
        const t = tile(x + dx, y + dy);
        if (floorish(t)) {
          g.fillStyle = 'rgba(255,255,255,0.08)';
          if (dx) g.fillRect(dx > 0 ? x + 0.86 : x, y, 0.14, 1);
          else g.fillRect(x, dy > 0 ? y + 0.86 : y, 1, 0.14);
          g.fillStyle = '#121116';
          if (dx) g.fillRect(dx > 0 ? x + 0.97 : x, y, 0.03, 1);
          else g.fillRect(x, dy > 0 ? y + 0.97 : y, 1, 0.03);
        } else if (t === T.VOID) {
          g.fillStyle = '#1a191e';
          if (dx) g.fillRect(dx > 0 ? x + 0.8 : x, y, 0.2, 1);
          else g.fillRect(x, dy > 0 ? y + 0.8 : y, 1, 0.2);
        }
      });
    }
  }

  // wall decor
  for (const h of map.hides) drawHide(g, h, R);
  for (const d of map.decor) {
    if (d.k === 'board') drawBoard(g, d);
    else if (d.k === 'window') drawWindow(g, d);
    else if (d.k === 'poster') drawPoster(g, d, R);
    else if (d.k === 'frame') drawFrame(g, d);
  }
  if (map.fusebox) {
    const f = map.fusebox;
    g.save();
    g.translate(f.x + 0.5, f.y + 0.5);
    rotFace(g, f.dir);
    g.fillStyle = '#5e6266';
    g.fillRect(-0.4, 0.05, 0.8, 0.45);
    g.strokeStyle = '#2a2c2e';
    g.lineWidth = 0.03;
    g.strokeRect(-0.4, 0.05, 0.8, 0.45);
    g.fillStyle = '#e0b81f';
    g.beginPath();
    g.moveTo(0.04, 0.1);
    g.lineTo(-0.07, 0.24);
    g.lineTo(0.0, 0.24);
    g.lineTo(-0.04, 0.38);
    g.lineTo(0.08, 0.2);
    g.lineTo(0.01, 0.2);
    g.closePath();
    g.fill();
    g.restore();
  }
  return c;
}

function drawFloor(g, x, y, st, R) {
  switch (st.kind) {
    case 'checker':
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          g.fillStyle = (sx + sy + x + y) % 2 ? st.a : st.b;
          g.fillRect(x + sx * 0.5, y + sy * 0.5, 0.5, 0.5);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x, y, 1, 0.02);
      g.fillRect(x, y, 0.02, 1);
      break;
    case 'big':
      g.fillStyle = (x + y) % 2 ? st.a : st.b;
      g.fillRect(x, y, 1, 1);
      break;
    case 'marble':
      g.fillStyle = shade(st.a, (R() - 0.5) * 10);
      g.fillRect(x, y, 1, 1);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 0.02;
      g.beginPath();
      g.moveTo(x + R(), y);
      g.quadraticCurveTo(x + R(), y + R(), x + R(), y + 1);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.15)';
      g.fillRect(x, y, 1, 0.015);
      g.fillRect(x, y, 0.015, 1);
      break;
    case 'carpet':
      g.fillStyle = st.a;
      g.fillRect(x, y, 1, 1);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
        g.fillRect(x + R(), y + R(), 0.06, 0.06);
      }
      break;
    case 'wood':
      for (let k = 0; k < 4; k++) {
        g.fillStyle = shade(st.a, (R() - 0.5) * 22);
        g.fillRect(x, y + k * 0.25, 1, 0.25);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x, y + k * 0.25, 1, 0.012);
        g.fillRect(x + R(), y + k * 0.25, 0.012, 0.25);
      }
      break;
    case 'small':
      g.fillStyle = st.a;
      g.fillRect(x, y, 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 4; k++) {
        g.fillRect(x + k * 0.25, y, 0.012, 1);
        g.fillRect(x, y + k * 0.25, 1, 0.012);
      }
      break;
    default:
      g.fillStyle = shade(st.a, (R() - 0.5) * 8);
      g.fillRect(x, y, 1, 1);
      if (R() < 0.35) {
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.beginPath();
        g.arc(x + R(), y + R(), 0.1 + R() * 0.3, 0, TAU);
        g.fill();
      }
      if (R() < 0.08) {
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.lineWidth = 0.02;
        g.beginPath();
        g.moveTo(x + R(), y + R());
        g.lineTo(x + R(), y + R());
        g.lineTo(x + R(), y + R());
        g.stroke();
      }
  }
  if (R() < 0.1) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.beginPath();
    g.ellipse(x + R(), y + R(), 0.2 + R() * 0.2, 0.1, R() * 3, 0, TAU);
    g.fill();
  }
}

const BOOK_COLS = ['#7a2e2e', '#2e4a7a', '#2e6a3e', '#7a6a2e', '#5a2e6a', '#8a5a2e', '#3e3e3e', '#a08868'];

function drawFurnBlock(g, k, x, y, w, h, dir, R) {
  const horiz = w >= h;
  g.save();
  // drop shadow
  g.fillStyle = 'rgba(0,0,0,0.35)';
  if (k !== F.MAT) g.fillRect(x + 0.12, y + 0.16, w - 0.12, h - 0.12);
  switch (k) {
    case F.TDESK: {
      g.fillStyle = '#5e4027';
      g.fillRect(x + 0.06, y + 0.1, w - 0.12, h - 0.2);
      g.fillStyle = '#704c2e';
      g.fillRect(x + 0.06, y + 0.1, w - 0.12, 0.06);
      g.fillStyle = '#d8d4c8';
      g.save();
      g.translate(x + w * 0.35, y + h * 0.45);
      g.rotate(0.2);
      g.fillRect(-0.15, -0.1, 0.3, 0.22);
      g.restore();
      g.fillStyle = '#8b1a1a';
      g.beginPath();
      g.arc(x + w * 0.75, y + h * 0.5, 0.08, 0, TAU);
      g.fill();
      break;
    }
    case F.SHELF: {
      g.fillStyle = '#35261a';
      if (horiz) g.fillRect(x + 0.02, y + 0.1, w - 0.04, 0.8);
      else g.fillRect(x + 0.1, y + 0.02, 0.8, h - 0.04);
      const len = horiz ? w : h;
      for (let s = 0; s < len; s += 0.08 + R() * 0.07) {
        if (R() < 0.12) continue;
        g.fillStyle = BOOK_COLS[Math.floor(R() * BOOK_COLS.length)];
        const bw = 0.05 + R() * 0.05;
        const d1 = 0.25 + R() * 0.1;
        if (horiz) {
          g.fillRect(x + 0.05 + s, y + 0.14, bw, d1);
          g.fillRect(x + 0.05 + s, y + 0.86 - d1, bw, d1);
        } else {
          g.fillRect(x + 0.14, y + 0.05 + s, d1, bw);
          g.fillRect(x + 0.86 - d1, y + 0.05 + s, d1, bw);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      if (horiz) g.fillRect(x + 0.02, y + 0.48, w - 0.04, 0.04);
      else g.fillRect(x + 0.48, y + 0.02, 0.04, h - 0.04);
      break;
    }
    case F.TABLE: {
      g.fillStyle = '#4f535a';
      if (horiz) {
        g.fillRect(x + 0.05, y + 0.02, w - 0.1, 0.12);
        g.fillRect(x + 0.05, y + 0.86, w - 0.1, 0.12);
      } else {
        g.fillRect(x + 0.02, y + 0.05, 0.12, h - 0.1);
        g.fillRect(x + 0.86, y + 0.05, 0.12, h - 0.1);
      }
      g.fillStyle = '#8a8d93';
      if (horiz) g.fillRect(x + 0.02, y + 0.2, w - 0.04, 0.6);
      else g.fillRect(x + 0.2, y + 0.02, 0.6, h - 0.04);
      for (let k2 = 0; k2 < (horiz ? w : h); k2++) {
        if (R() < 0.4) {
          g.fillStyle = R() < 0.5 ? '#a8a49a' : '#6a7a8a';
          const px = horiz ? x + k2 + 0.3 : x + 0.35;
          const py = horiz ? y + 0.35 : y + k2 + 0.3;
          g.fillRect(px, py, 0.3, 0.3);
        }
      }
      break;
    }
    case F.BENCH: {
      g.fillStyle = '#26282c';
      g.fillRect(x + 0.04, y + 0.08, w - 0.08, h - 0.16);
      g.strokeStyle = '#4a4e55';
      g.lineWidth = 0.03;
      g.strokeRect(x + 0.04, y + 0.08, w - 0.08, h - 0.16);
      for (let k2 = 0; k2 < 3; k2++) {
        g.fillStyle = `rgba(${120 + R() * 80},${200},${180 + R() * 70},0.5)`;
        g.beginPath();
        g.arc(x + 0.3 + R() * (w - 0.6), y + 0.3 + R() * (h - 0.6), 0.06 + R() * 0.04, 0, TAU);
        g.fill();
      }
      break;
    }
    case F.BLEACH: {
      const n = Math.round((horiz ? h : w) * 3);
      for (let s = 0; s < n; s++) {
        g.fillStyle = s % 2 ? '#5d6066' : '#70737a';
        if (horiz) g.fillRect(x, y + s / 3, w, 1 / 3);
        else g.fillRect(x + s / 3, y, 1 / 3, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let s = 0; s < (horiz ? w : h); s += 2) {
        if (horiz) g.fillRect(x + s, y, 0.03, h);
        else g.fillRect(x, y + s, w, 0.03);
      }
      break;
    }
    case F.BOILER: {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) / 2 - 0.08;
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0.1, cx, cy, r);
      gr.addColorStop(0, '#6a655e');
      gr.addColorStop(1, '#2e2b28');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
      g.strokeStyle = '#1f1d1b';
      g.lineWidth = 0.06;
      g.stroke();
      g.fillStyle = '#9a9790';
      for (let a = 0; a < TAU; a += TAU / 12) {
        g.beginPath();
        g.arc(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, 0.03, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#d8d4c4';
      g.beginPath();
      g.arc(cx, cy, 0.2, 0, TAU);
      g.fill();
      g.strokeStyle = '#a01515';
      g.lineWidth = 0.03;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + 0.14, cy - 0.08);
      g.stroke();
      g.fillStyle = 'rgba(120,60,20,0.35)';
      g.beginPath();
      g.ellipse(cx + r * 0.4, cy + r * 0.5, 0.25, 0.12, 0.5, 0, TAU);
      g.fill();
      break;
    }
    case F.COUNTER: {
      g.fillStyle = '#9da0a6';
      g.fillRect(x + 0.02, y + 0.1, w - 0.04, h - 0.2);
      g.fillStyle = '#c6c9ce';
      if (horiz) g.fillRect(x + 0.02, y + 0.45, w - 0.04, 0.05);
      else g.fillRect(x + 0.45, y + 0.02, 0.05, h - 0.04);
      for (let k2 = 0; k2 < (horiz ? w : h); k2++) {
        g.fillStyle = '#5b6168';
        if (horiz) g.fillRect(x + k2 + 0.15, y + 0.18, 0.7, 0.22);
        else g.fillRect(x + 0.18, y + k2 + 0.15, 0.22, 0.7);
      }
      break;
    }
    case F.TROPHY: {
      g.fillStyle = '#3a2618';
      g.fillRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
      g.fillStyle = 'rgba(150,190,220,0.25)';
      g.fillRect(x + 0.12, y + 0.12, w - 0.24, h - 0.24);
      for (let k2 = 0; k2 < (horiz ? w : h) * 2; k2++) {
        g.fillStyle = R() < 0.3 ? '#a8a8a8' : '#c9a23a';
        const px = horiz ? x + 0.25 + k2 * 0.5 : x + 0.5;
        const py = horiz ? y + 0.5 : y + 0.25 + k2 * 0.5;
        g.beginPath();
        g.arc(px, py, 0.09, 0, TAU);
        g.fill();
      }
      break;
    }
    case F.COT: {
      g.fillStyle = '#8b9093';
      g.fillRect(x + 0.08, y + 0.04, w - 0.16, h - 0.08);
      g.fillStyle = '#d6d8cf';
      g.fillRect(x + 0.12, y + 0.08, w - 0.24, h - 0.16);
      g.fillStyle = '#eef0e8';
      if (horiz) g.fillRect(x + 0.14, y + 0.15, 0.35, h - 0.3);
      else g.fillRect(x + 0.15, y + 0.14, w - 0.3, 0.35);
      break;
    }
    case F.PIANO: {
      g.fillStyle = '#111114';
      g.fillRect(x + 0.04, y + 0.08, w - 0.08, h - 0.16);
      g.fillStyle = '#e8e6de';
      if (horiz) {
        g.fillRect(x + 0.1, y + h - 0.32, w - 0.2, 0.2);
        g.fillStyle = '#111';
        for (let s = x + 0.15; s < x + w - 0.15; s += 0.09) g.fillRect(s, y + h - 0.32, 0.04, 0.12);
      } else {
        g.fillRect(x + w - 0.32, y + 0.1, 0.2, h - 0.2);
      }
      break;
    }
    case F.SEAT: {
      g.fillStyle = '#5b3f26';
      for (let s = 0; s < 3; s++) {
        if (horiz) g.fillRect(x + 0.05, y + 0.2 + s * 0.2, w - 0.1, 0.14);
        else g.fillRect(x + 0.2 + s * 0.2, y + 0.05, 0.14, h - 0.1);
      }
      break;
    }
    case F.MAT: {
      g.fillStyle = '#2c4f7a';
      g.fillRect(x + 0.05, y + 0.05, w - 0.1, h - 0.1);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 0.03;
      for (let s = 1; s < w; s++) {
        g.beginPath();
        g.moveTo(x + s, y + 0.05);
        g.lineTo(x + s, y + h - 0.05);
        g.stroke();
      }
      break;
    }
    case F.DEBRIS: {
      for (let k2 = 0; k2 < w * h * 9; k2++) {
        g.fillStyle = ['#4b4945', '#5e5b55', '#3a3936', '#8a877d', '#6b4a2e'][Math.floor(R() * 5)];
        g.save();
        g.translate(x + R() * w, y + R() * h);
        g.rotate(R() * TAU);
        g.fillRect(-0.15, -0.1, 0.2 + R() * 0.3, 0.12 + R() * 0.2);
        g.restore();
      }
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 0.025;
      g.beginPath();
      g.moveTo(x, y + R() * h);
      g.bezierCurveTo(x + w * 0.3, y + R() * h, x + w * 0.6, y + R() * h, x + w, y + R() * h);
      g.stroke();
      break;
    }
    default:
      g.fillStyle = '#555';
      g.fillRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
  }
  g.restore();
}

function drawFurnTile(g, k, x, y, dir, R) {
  g.save();
  g.translate(x + 0.5, y + 0.5);
  const solid = FSOLID[k];
  if (solid && k !== F.PIPE) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-0.36, -0.3, 0.8, 0.8);
  }
  switch (k) {
    case F.DESK: {
      rotDir(g, dir);
      g.fillStyle = '#3c4048';
      g.fillRect(-0.2, 0.12, 0.4, 0.3);
      g.fillRect(-0.2, 0.36, 0.4, 0.08);
      g.fillStyle = '#9a7448';
      g.fillRect(-0.34, -0.36, 0.68, 0.42);
      g.fillStyle = '#a98254';
      g.fillRect(-0.34, -0.36, 0.68, 0.06);
      if (R() < 0.4) {
        g.fillStyle = '#ddd8cc';
        g.fillRect(-0.15 + R() * 0.1, -0.28, 0.2, 0.26);
      }
      if (R() < 0.15) {
        g.fillStyle = 'rgba(30,30,30,0.6)';
        g.fillRect(-0.3, -0.2, 0.55, 0.03);
      }
      break;
    }
    case F.SINK: {
      rotDir(g, dir);
      g.fillStyle = '#c8cccc';
      rrect(g, -0.36, 0.0, 0.72, 0.48, 0.08);
      g.fill();
      g.fillStyle = '#8f9799';
      g.beginPath();
      g.ellipse(0, 0.22, 0.22, 0.15, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#6a7072';
      g.fillRect(-0.04, 0.0, 0.08, 0.14);
      break;
    }
    case F.VEND: {
      rotDir(g, dir);
      g.fillStyle = '#1e2a44';
      g.fillRect(-0.44, -0.44, 0.88, 0.88);
      g.fillStyle = '#2e3e60';
      g.fillRect(-0.4, -0.44, 0.8, 0.2);
      g.fillStyle = 'rgba(150,180,220,0.35)';
      g.fillRect(-0.36, -0.44, 0.5, 0.12);
      g.fillStyle = '#a0281e';
      g.fillRect(-0.44, 0.3, 0.88, 0.14);
      break;
    }
    case F.CABINET: {
      rotDir(g, dir);
      g.fillStyle = '#5a5e63';
      g.fillRect(-0.4, -0.38, 0.8, 0.76);
      g.fillStyle = '#6c7076';
      g.fillRect(-0.4, -0.38, 0.8, 0.1);
      g.fillStyle = '#2c2e31';
      for (let s = 0; s < 3; s++) g.fillRect(-0.36, -0.2 + s * 0.2, 0.72, 0.02);
      break;
    }
    case F.PIPE: {
      rotDir(g, dir);
      g.fillStyle = '#6e4b2e';
      g.fillRect(-0.5, -0.2, 1, 0.14);
      g.fillStyle = '#545a60';
      g.fillRect(-0.5, 0.05, 1, 0.2);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(-0.5, 0.07, 1, 0.04);
      g.fillStyle = '#3a3e42';
      g.fillRect(-0.06, 0.02, 0.12, 0.26);
      break;
    }
    case F.TRASH: {
      g.fillStyle = '#4a5550';
      g.beginPath();
      g.arc(0, 0, 0.27, 0, TAU);
      g.fill();
      g.fillStyle = '#1e2422';
      g.beginPath();
      g.arc(0, 0, 0.2, 0, TAU);
      g.fill();
      g.fillStyle = '#ddd';
      g.fillRect(-0.08, -0.06, 0.12, 0.1);
      break;
    }
    case F.PLANT: {
      g.fillStyle = '#7a4a2a';
      g.beginPath();
      g.arc(0, 0, 0.24, 0, TAU);
      g.fill();
      for (let a = 0; a < TAU; a += TAU / 7) {
        g.fillStyle = R() < 0.4 ? '#5a4a22' : '#2f5a2a';
        g.beginPath();
        g.ellipse(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.2, 0.07, a, 0, TAU);
        g.fill();
      }
      break;
    }
    case F.EASEL: {
      rotDir(g, dir);
      g.strokeStyle = '#7a5530';
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(-0.3, 0.35);
      g.lineTo(0, -0.3);
      g.lineTo(0.3, 0.35);
      g.stroke();
      g.fillStyle = '#e6e0d0';
      g.fillRect(-0.3, -0.25, 0.6, 0.22);
      for (let s = 0; s < 4; s++) {
        g.fillStyle = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#111'][Math.floor(R() * 5)];
        g.fillRect(-0.25 + R() * 0.4, -0.22 + R() * 0.14, 0.1, 0.03);
      }
      break;
    }
    case F.BUCKET: {
      g.fillStyle = '#c9a314';
      g.fillRect(-0.25, -0.2, 0.5, 0.4);
      g.fillStyle = '#4a5a6a';
      g.fillRect(-0.18, -0.13, 0.36, 0.26);
      g.strokeStyle = '#8a6a3a';
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0.42, -0.4);
      g.stroke();
      break;
    }
    case F.PUDDLE: {
      g.fillStyle = 'rgba(20,32,44,0.6)';
      g.beginPath();
      g.ellipse(R() * 0.1, R() * 0.1, 0.4, 0.28, R() * 3, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(170,190,210,0.25)';
      g.lineWidth = 0.02;
      g.beginPath();
      g.ellipse(-0.05, -0.05, 0.25, 0.14, 0.3, 3.6, 5.2);
      g.stroke();
      break;
    }
    case F.PAPERS: {
      for (let s = 0; s < 3; s++) {
        g.save();
        g.rotate(R() * TAU);
        g.fillStyle = R() < 0.5 ? '#d8d4c6' : '#c9c4b2';
        g.fillRect(-0.12 + R() * 0.2, -0.15 + R() * 0.2, 0.22, 0.28);
        g.fillStyle = 'rgba(40,40,80,0.35)';
        g.fillRect(-0.08 + R() * 0.2, -0.1 + R() * 0.2, 0.14, 0.015);
        g.restore();
      }
      break;
    }
    case F.BACKPACK: {
      g.rotate(R() * TAU);
      g.fillStyle = ['#7a2a2a', '#2a4a7a', '#2a6a3a', '#6a2a6a', '#8a6a2a'][Math.floor(R() * 5)];
      rrect(g, -0.18, -0.22, 0.36, 0.44, 0.08);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-0.14, 0.02, 0.28, 0.14);
      break;
    }
    case F.BOOKS: {
      for (let s = 0; s < 3; s++) {
        g.save();
        g.rotate(R() * TAU);
        g.fillStyle = BOOK_COLS[Math.floor(R() * BOOK_COLS.length)];
        g.fillRect(-0.1 + R() * 0.2, -0.12 + R() * 0.2, 0.2, 0.26);
        g.restore();
      }
      break;
    }
    case F.CHAIR: {
      rotDir(g, dir);
      g.rotate((R() - 0.5) * 0.8);
      g.fillStyle = '#3c4048';
      g.fillRect(-0.18, -0.16, 0.36, 0.32);
      g.fillRect(-0.18, 0.14, 0.36, 0.08);
      break;
    }
    case F.STALL: {
      rotDir(g, dir);
      g.fillStyle = '#5f6d64';
      g.fillRect(-0.36, -0.5, 0.72, 1);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(-0.36, -0.5, 0.06, 1);
      g.fillStyle = 'rgba(30,20,20,0.5)';
      g.fillRect(-0.2, -0.2, 0.35, 0.02);
      break;
    }
    default: {
      g.fillStyle = '#555';
      g.fillRect(-0.3, -0.3, 0.6, 0.6);
    }
  }
  g.restore();
}

function drawHide(g, h, R) {
  g.save();
  g.translate(h.x + 0.5, h.y + 0.5);
  rotFace(g, h.dir);
  if (h.kind === 'locker') {
    g.fillStyle = h.color || '#3c5a7a';
    g.fillRect(-0.49, -0.12, 0.98, 0.62);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(-0.49, -0.12, 0.98, 0.08);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(-0.015, -0.12, 0.03, 0.62);
    g.fillRect(-0.49, -0.12, 0.02, 0.62);
    for (const ox of [-0.25, 0.25]) {
      for (let s = 0; s < 3; s++) g.fillRect(ox - 0.12, 0.06 + s * 0.05, 0.24, 0.018);
      g.fillStyle = '#b8b8b0';
      g.fillRect(ox + 0.12, 0.3, 0.05, 0.08);
      g.fillStyle = 'rgba(0,0,0,0.45)';
    }
    if (R() < 0.15) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(-0.3, 0.44, 0.2, 0.06);
    }
  } else {
    g.fillStyle = '#5a3d24';
    g.fillRect(-0.46, 0.0, 0.92, 0.5);
    g.fillStyle = '#6e4c2e';
    g.fillRect(-0.44, 0.02, 0.43, 0.46);
    g.fillRect(0.01, 0.02, 0.43, 0.46);
    g.fillStyle = '#c9b070';
    g.fillRect(-0.06, 0.32, 0.04, 0.06);
    g.fillRect(0.02, 0.32, 0.04, 0.06);
  }
  g.restore();
}

function drawBoard(g, d) {
  for (const [x, y] of d.cells) {
    g.save();
    g.translate(x + 0.5, y + 0.5);
    rotFace(g, d.dir);
    g.fillStyle = '#1f3a2a';
    g.fillRect(-0.5, 0.12, 1, 0.38);
    g.fillStyle = '#6b4a2e';
    g.fillRect(-0.5, 0.44, 1, 0.06);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(-0.5, 0.15, 1, 0.1);
    g.restore();
  }
  const n = d.cells.length;
  const cx = d.cells.reduce((s, c) => s + c[0], 0) / n + 0.5;
  const cy = d.cells.reduce((s, c) => s + c[1], 0) / n + 0.5;
  // The board strip sits on the half of the wall facing the room.
  const [fx, fy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][d.dir];
  const rot = d.dir === 1 ? -Math.PI / 2 : d.dir === 3 ? Math.PI / 2 : 0;
  text(g, d.text, cx + fx * 0.3, cy + fy * 0.3, 0.24, 'rgba(230,230,220,0.8)', rot, 'bold');
}

function drawWindow(g, d) {
  g.save();
  g.translate(d.x + 0.5, d.y + 0.5);
  rotFace(g, d.dir);
  g.fillStyle = '#3c4f68';
  g.fillRect(-0.5, 0.18, 1, 0.3);
  g.fillStyle = 'rgba(180,200,230,0.25)';
  g.fillRect(-0.45, 0.22, 0.4, 0.06);
  g.fillStyle = '#1a1c22';
  g.fillRect(-0.03, 0.18, 0.06, 0.3);
  g.fillRect(-0.5, 0.45, 1, 0.05);
  g.restore();
}

function drawPoster(g, d, R) {
  const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#7d3c98', '#ca6f1e', '#909497', '#a93226'];
  g.save();
  g.translate(d.x + 0.5, d.y + 0.5);
  rotFace(g, d.dir);
  g.rotate((R() - 0.5) * 0.15);
  g.fillStyle = cols[d.v % cols.length];
  g.fillRect(-0.3, 0.26, 0.6, 0.24);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(-0.24, 0.31, 0.48, 0.04);
  g.fillRect(-0.24, 0.39, 0.3, 0.03);
  g.restore();
}

function drawFrame(g, d) {
  g.save();
  g.translate(d.x + 0.5, d.y + 0.5);
  rotFace(g, d.dir);
  g.fillStyle = '#9b7b2a';
  g.fillRect(-0.24, 0.16, 0.48, 0.34);
  g.fillStyle = '#1b1712';
  g.fillRect(-0.19, 0.2, 0.38, 0.26);
  g.fillStyle = '#d8d0c0';
  g.beginPath();
  g.arc(0, 0.3, 0.07, 0, TAU);
  g.fill();
  g.fillStyle = '#000';
  g.fillRect(-0.04, 0.29, 0.025, 0.02);
  g.fillRect(0.015, 0.29, 0.025, 0.02);
  g.restore();
}

// ------------------------------------------------------------------ lighting
// Endpoints of rays fanned from (ox,oy). A small push into walls lights their edges.
export function rayPoly(m, ox, oy, a0, a1, n, range, ext = 0.22) {
  const pts = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let d = castRay(m, ox, oy, dx, dy, range);
    if (d < range) d = Math.min(range, d + ext);
    pts[i * 2] = ox + dx * d;
    pts[i * 2 + 1] = oy + dy * d;
  }
  return pts;
}

function pathPoly(g, pts, ox, oy) {
  g.beginPath();
  if (ox != null) g.moveTo(ox, oy);
  else g.moveTo(pts[0], pts[1]);
  for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

function radial(g, x, y, r, a, mid = 0.55) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(0,0,0,${a})`);
  gr.addColorStop(mid, `rgba(0,0,0,${a * 0.7})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  return gr;
}

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const id = g.createImageData(256, 256);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = Math.random() * 42;
  }
  g.putImageData(id, 0, 0);
  return c;
}

// ------------------------------------------------------------------ renderer
export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.dark = document.createElement('canvas');
    this.dg = this.dark.getContext('2d');
    this.grain = makeGrain();
    this.grainPat = this.g.createPattern(this.grain, 'repeat');
    this.map = null;
    this.mini = null;
    this.resize();
  }

  resize() {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    this.c.width = this.dark.width = this.W = w;
    this.c.height = this.dark.height = this.H = h;
    this.ts = Math.round(Math.max(30, Math.min(64, Math.min(w / 30, h / 17))));
    const v = document.createElement('canvas');
    v.width = w;
    v.height = h;
    const vg = v.getContext('2d');
    const gr = vg.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.8)');
    vg.fillStyle = gr;
    vg.fillRect(0, 0, w, h);
    this.vignette = v;
    const s = document.createElement('canvas');
    s.width = w;
    s.height = h;
    const sg = s.getContext('2d');
    sg.fillStyle = '#000';
    sg.fillRect(0, 0, w, h);
    sg.globalCompositeOperation = 'destination-out';
    const bands = 6;
    const bh = Math.max(8, h * 0.014);
    const gap = h * 0.055;
    const top = h / 2 - ((bands - 1) * gap) / 2;
    for (let k = 0; k < bands; k++) {
      const y = top + k * gap;
      const gr2 = sg.createLinearGradient(0, y - bh, 0, y + bh);
      gr2.addColorStop(0, 'rgba(0,0,0,0)');
      gr2.addColorStop(0.5, 'rgba(0,0,0,1)');
      gr2.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = gr2;
      sg.fillRect(w * 0.18, y - bh, w * 0.64, bh * 2);
    }
    this.slats = s;
  }

  setMap(map) {
    this.map = map;
    this.img = prerender(map);
    this.statics = map.lights.map((l) => {
      const full = l.arc >= 6;
      const pts = full ? rayPoly(map, l.x, l.y, 0, TAU, 40, l.r, 0.1) : rayPoly(map, l.x, l.y, l.a - l.arc / 2, l.a + l.arc / 2, 22, l.r, 0.1);
      return { ...l, pts, full };
    });
    this.mini = null;
  }

  // ---------- dynamic world objects
  drawDoors(g, inView) {
    for (const d of this.map.doors) {
      if (!inView(d.x, d.y)) continue;
      g.save();
      g.translate(d.x + 0.5, d.y + 0.5);
      if (d.ax === 'v') g.rotate(Math.PI / 2);
      g.fillStyle = '#1d1c21';
      g.fillRect(-0.5, -0.14, 0.09, 0.28);
      g.fillRect(0.41, -0.14, 0.09, 0.28);
      if (!d.open) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(-0.42, -0.06, 0.88, 0.24);
        g.fillStyle = '#5a3a22';
        g.fillRect(-0.42, -0.11, 0.84, 0.22);
        g.fillStyle = '#6e4a2c';
        g.fillRect(-0.42, -0.11, 0.84, 0.05);
        g.fillStyle = '#1a2230';
        g.fillRect(-0.12, -0.06, 0.24, 0.12);
        g.fillStyle = '#c8b070';
        g.fillRect(0.26, 0.04, 0.07, 0.05);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(-0.4, 0.06, 0.18, 0.84);
        g.fillStyle = '#5a3a22';
        g.fillRect(-0.44, 0.02, 0.15, 0.82);
        g.fillStyle = '#6e4a2c';
        g.fillRect(-0.44, 0.02, 0.05, 0.82);
      }
      g.restore();
    }
  }

  drawExit(g, S) {
    const ex = this.map.exit;
    for (let x = ex.x0; x <= ex.x1; x++) {
      g.save();
      g.translate(x + 0.5, ex.y + 0.5);
      g.fillStyle = '#16181c';
      g.fillRect(-0.5, -0.5, 1, 0.16);
      if (!this.map.exitOpen) {
        g.fillStyle = 'rgba(70,95,120,0.85)';
        g.fillRect(-0.47, -0.38, 0.94, 0.14);
        g.strokeStyle = '#8a8d90';
        g.lineWidth = 0.05;
        g.beginPath();
        for (let s = -0.45; s < 0.45; s += 0.12) {
          g.moveTo(s, -0.48);
          g.lineTo(s + 0.08, -0.36);
        }
        g.stroke();
      } else {
        g.fillStyle = 'rgba(70,95,120,0.7)';
        g.fillRect(x === ex.x0 ? -0.47 : 0.37, -0.38, 0.1, 0.8);
      }
      g.restore();
    }
    if (!this.map.exitOpen) {
      g.fillStyle = '#c9a314';
      g.fillRect(ex.x1 - 0.1, ex.y - 0.06, 0.2, 0.16);
    }
  }

  drawFusebox(g, S) {
    const f = this.map.fusebox;
    if (!f) return;
    g.save();
    g.translate(f.x + 0.5, f.y + 0.5);
    rotFace(g, f.dir);
    const n = S.fusesNeeded || 1;
    for (let i = 0; i < n; i++) {
      const x = -0.34 + (0.68 * (i + 0.5)) / n;
      g.fillStyle = i < S.fusesIn ? '#d9a830' : '#151618';
      g.fillRect(x - 0.035, 0.36, 0.07, 0.1);
    }
    g.restore();
  }

  drawItems(g, S, inView) {
    const t = S.t;
    for (const it of S.items) {
      if (it.taken || !inView(it.x, it.y)) continue;
      g.save();
      g.translate(it.x, it.y + Math.sin(t * 3 + it.id) * 0.03);
      g.rotate(((it.id * 1.7) % TAU) * 0.3);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(0.03, 0.08, 0.2, 0.08, 0, 0, TAU);
      g.fill();
      if (it.k === 'fuse') {
        g.fillStyle = '#ddd2b8';
        g.fillRect(-0.15, -0.07, 0.3, 0.14);
        g.fillStyle = '#c9a24a';
        g.fillRect(-0.21, -0.085, 0.07, 0.17);
        g.fillRect(0.14, -0.085, 0.07, 0.17);
        g.fillStyle = '#b02a1e';
        g.fillRect(-0.03, -0.07, 0.06, 0.14);
      } else if (it.k === 'battery') {
        g.fillStyle = '#26282a';
        g.fillRect(-0.14, -0.06, 0.26, 0.12);
        g.fillStyle = '#c7843c';
        g.fillRect(0.06, -0.06, 0.06, 0.12);
        g.fillStyle = '#d0d0d0';
        g.fillRect(0.12, -0.025, 0.03, 0.05);
      } else if (it.k === 'clock') {
        g.fillStyle = '#b3241c';
        g.beginPath();
        g.arc(-0.09, -0.12, 0.06, 0, TAU);
        g.arc(0.09, -0.12, 0.06, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(0, 0, 0.14, 0, TAU);
        g.fill();
        g.fillStyle = '#eee8d8';
        g.beginPath();
        g.arc(0, 0, 0.1, 0, TAU);
        g.fill();
        g.strokeStyle = '#222';
        g.lineWidth = 0.02;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -0.07);
        g.moveTo(0, 0);
        g.lineTo(0.05, 0.02);
        g.stroke();
      } else if (it.k === 'drink') {
        g.fillStyle = '#9aa0a6';
        g.fillRect(-0.07, -0.13, 0.14, 0.26);
        g.fillStyle = '#6cf03a';
        g.fillRect(-0.07, -0.08, 0.14, 0.16);
        g.fillStyle = '#111';
        g.fillRect(-0.07, -0.01, 0.14, 0.03);
      }
      g.restore();
    }
    for (const c of S.clocks) {
      g.save();
      g.translate(c.x + (Math.random() - 0.5) * 0.04, c.y + (Math.random() - 0.5) * 0.04);
      g.fillStyle = '#b3241c';
      g.beginPath();
      g.arc(0, 0, 0.14, 0, TAU);
      g.fill();
      g.fillStyle = '#eee8d8';
      g.beginPath();
      g.arc(0, 0, 0.1, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  drawPlayer(g, p, t) {
    g.save();
    g.translate(p.x, p.y);
    const skin = ['#e8c4a0', '#c99a6e', '#8d5a3a', '#f0d0b0', '#a87250', '#5e3a24'][p.id % 6];
    const hair = ['#2a1a10', '#111', '#6a4a20', '#b08840', '#3a2418', '#7a2a1a'][(p.id * 7) % 6];
    if (p.st === 'down') {
      g.rotate(p.a + Math.PI / 2);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.ellipse(0.04, 0.06, 0.3, 0.5, 0, 0, TAU);
      g.fill();
      g.fillStyle = p.color;
      g.beginPath();
      g.ellipse(0, 0.05, 0.22, 0.38, 0, 0, TAU);
      g.fill();
      g.fillStyle = skin;
      g.beginPath();
      g.arc(0, -0.38, 0.14, 0, TAU);
      g.fill();
      g.fillStyle = hair;
      g.beginPath();
      g.arc(0, -0.4, 0.14, Math.PI, TAU);
      g.fill();
      g.strokeStyle = `rgba(220,30,30,${0.4 + 0.3 * Math.sin(t * 5)})`;
      g.lineWidth = 0.05;
      g.beginPath();
      g.arc(0, 0, 0.62, 0, TAU);
      g.stroke();
      g.restore();
      return;
    }
    const s = p.cr ? 0.84 : 1;
    g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.ellipse(0.05, 0.07, 0.36, 0.33, 0, 0, TAU);
    g.fill();
    g.rotate(p.a);
    const swing = p.mv ? Math.sin(p.walk || 0) * 0.08 : 0;
    g.fillStyle = shade(p.color, -60);
    rrect(g, -0.38, -0.17, 0.17, 0.34, 0.05);
    g.fill();
    g.fillStyle = shade(p.color, -20);
    g.beginPath();
    g.arc(0.14 + swing, -0.24, 0.085, 0, TAU);
    g.arc(0.2 - swing, 0.22, 0.085, 0, TAU);
    g.fill();
    g.fillStyle = p.color;
    g.beginPath();
    g.ellipse(0, 0, 0.24, 0.3, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#3a3c40';
    g.fillRect(0.2 - swing, 0.17, 0.24, 0.08);
    g.fillStyle = p.fl ? '#fff3c8' : '#666';
    g.fillRect(0.42 - swing, 0.17, 0.03, 0.08);
    g.fillStyle = skin;
    g.beginPath();
    g.arc(0.03, 0, 0.15, 0, TAU);
    g.fill();
    g.fillStyle = hair;
    g.beginPath();
    g.arc(0.0, 0, 0.155, Math.PI * 0.5, Math.PI * 1.5);
    g.fill();
    g.restore();
  }

  drawMonster(g, m, t) {
    g.save();
    let jx = 0;
    let jy = 0;
    if (m.st === 'chase' || m.st === 'grab') {
      jx = (Math.random() - 0.5) * 0.06;
      jy = (Math.random() - 0.5) * 0.06;
    }
    g.translate(m.x + jx, m.y + jy);
    const aura = g.createRadialGradient(0, 0, 0, 0, 0, 1.6);
    aura.addColorStop(0, 'rgba(0,0,0,0.75)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aura;
    g.beginPath();
    g.arc(0, 0, 1.6, 0, TAU);
    g.fill();
    g.rotate(m.a);
    g.scale(MON_SCALE, MON_SCALE);
    if (m.st === 'dormant') {
      g.fillStyle = '#141216';
      g.beginPath();
      g.ellipse(0, 0, 0.42, 0.36, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#a8a196';
      g.lineWidth = 0.05;
      g.beginPath();
      g.arc(0, 0, 0.36, -1.2, 1.4);
      g.stroke();
      g.restore();
      return;
    }
    const ph = m.walk || 0;
    const reach = m.st === 'chase' || m.st === 'grab' ? 0.35 : 0;
    const limb = '#bdb5aa';
    g.strokeStyle = limb;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const sw = Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 0.22;
      const sx = 0.02;
      const sy = side * 0.3;
      const ex = 0.38 + sw + reach * 0.4;
      const ey = side * (0.62 - reach * 0.15);
      const hx = 0.95 + sw * 0.6 + reach;
      const hy = side * (0.42 - reach * 0.2);
      g.lineWidth = 0.075;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      g.lineTo(hx, hy);
      g.stroke();
      g.lineWidth = 0.025;
      g.beginPath();
      for (let f = -1.5; f <= 1.5; f++) {
        const fa = Math.atan2(hy - ey, hx - ex) + f * 0.28;
        g.moveTo(hx, hy);
        g.lineTo(hx + Math.cos(fa) * 0.3, hy + Math.sin(fa) * 0.3);
      }
      g.stroke();
    }
    // legs trailing behind
    g.lineWidth = 0.07;
    for (const side of [-1, 1]) {
      const sw = Math.sin(ph + (side > 0 ? Math.PI : 0)) * 0.2;
      g.beginPath();
      g.moveTo(-0.15, side * 0.14);
      g.lineTo(-0.55 + sw, side * 0.3);
      g.stroke();
    }
    g.fillStyle = '#17141a';
    g.beginPath();
    g.ellipse(0, 0, 0.34, 0.36, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#7d766d';
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.arc(-0.24 + k * 0.1, 0, 0.035, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#e2dccf';
    g.beginPath();
    g.ellipse(0.36, 0, 0.17, 0.14, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(0.43, -0.055, 0.045, 0.03, 0, 0, TAU);
    g.ellipse(0.43, 0.055, 0.045, 0.03, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 0.02;
    g.beginPath();
    g.moveTo(0.5, -0.04);
    g.lineTo(0.5, 0.04);
    g.stroke();
    g.restore();
  }

  // ---------- frame
  frame(S, V) {
    const { g, W, H } = this;
    const ts = this.ts;
    const m = this.map;
    const t = S.t;
    const cx = V.cx;
    const cy = V.cy;
    const sx = (V.shake || 0) * (Math.random() - 0.5);
    const sy = (V.shake || 0) * (Math.random() - 0.5);
    const ox = W / 2 - cx * ts + sx;
    const oy = H / 2 - cy * ts + sy;
    const vx0 = cx - W / 2 / ts;
    const vx1 = cx + W / 2 / ts;
    const vy0 = cy - H / 2 / ts;
    const vy1 = cy + H / 2 / ts;
    const inView = (x, y, pad = 2) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // pre-rendered map, clipped to the image bounds
    {
      const k = MS / ts;
      let sx0 = (vx0 - sx / ts) * MS;
      let sy0 = (vy0 - sy / ts) * MS;
      let sw = W * k;
      let sh = H * k;
      let dx = 0;
      let dy = 0;
      if (sx0 < 0) {
        dx = -sx0 / k;
        sw += sx0;
        sx0 = 0;
      }
      if (sy0 < 0) {
        dy = -sy0 / k;
        sh += sy0;
        sy0 = 0;
      }
      sw = Math.min(sw, this.img.width - sx0);
      sh = Math.min(sh, this.img.height - sy0);
      if (sw > 0 && sh > 0) g.drawImage(this.img, sx0, sy0, sw, sh, dx, dy, sw / k, sh / k);
    }

    g.setTransform(ts, 0, 0, ts, ox, oy);
    this.drawDoors(g, inView);
    this.drawExit(g, S);
    this.drawFusebox(g, S);
    this.drawItems(g, S, inView);
    for (const p of S.players.values()) {
      if ((p.st === 'alive' || p.st === 'down') && p.h < 0 && inView(p.x, p.y)) this.drawPlayer(g, p, t);
    }
    for (const mo of S.monsters) if (inView(mo.x, mo.y)) this.drawMonster(g, mo, t);

    // ---- lights
    const lights = [];
    const vx = V.x;
    const vy = V.y;
    const losPts = rayPoly(m, vx, vy, 0, TAU, V.hidden ? 120 : 300, 16, 0.25);
    const flick = V.flick ?? 1;
    if (V.fl && !V.hidden) {
      const ax = vx + Math.cos(V.a) * 0.18;
      const ay = vy + Math.sin(V.a) * 0.18;
      const fx = opaqueAt(m, Math.floor(ax), Math.floor(ay)) ? vx : ax;
      const fy = opaqueAt(m, Math.floor(ax), Math.floor(ay)) ? vy : ay;
      lights.push({ pts: rayPoly(m, fx, fy, V.a - 0.7, V.a + 0.7, 90, 10), x: fx, y: fy, r: 10, a: 0.78 * flick, cone: true });
      lights.push({ pts: rayPoly(m, fx, fy, V.a - 0.34, V.a + 0.34, 46, 11.5), x: fx, y: fy, r: 11.5, a: 0.92 * flick, cone: true });
    }
    for (const p of S.players.values()) {
      if (p === V.me || !p.fl || p.h >= 0 || (p.st !== 'alive' && p.st !== 'down')) continue;
      if (Math.hypot(p.x - vx, p.y - vy) > 26) continue;
      lights.push({ pts: rayPoly(m, p.x, p.y, p.a - 0.6, p.a + 0.6, 48, 9.5), x: p.x, y: p.y, r: 9.5, a: 0.8, cone: true });
    }

    // warm/cool tints under the darkness
    g.globalCompositeOperation = 'soft-light';
    for (const L of lights) {
      const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      gr.addColorStop(0, 'rgba(255,200,130,0.55)');
      gr.addColorStop(1, 'rgba(255,200,130,0)');
      g.fillStyle = gr;
      pathPoly(g, L.pts, L.x, L.y);
      g.fill();
    }
    // Static lights (moonlight, exit sign) only show where the viewer can actually see.
    const statics = this.statics.filter((L) => inView(L.x, L.y, L.r));
    g.save();
    pathPoly(g, losPts);
    g.clip();
    for (const L of statics) {
      const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      const col = L.c === 'exit' ? '60,255,120' : '90,130,255';
      gr.addColorStop(0, `rgba(${col},0.7)`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      pathPoly(g, L.pts, L.full ? null : L.x, L.full ? null : L.y);
      g.fill();
    }
    g.restore();
    if (S.power) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = `rgba(255,20,20,${0.3 + 0.25 * Math.max(0, Math.sin(t * 3.2))})`;
      g.fillRect(0, 0, W, H);
      g.setTransform(ts, 0, 0, ts, ox, oy);
    }
    g.globalCompositeOperation = 'source-over';

    // ---- darkness mask
    const d = this.dg;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.fillStyle = 'rgb(3,4,9)';
    d.fillRect(0, 0, W, H);
    d.setTransform(ts, 0, 0, ts, ox, oy);
    d.globalCompositeOperation = 'destination-out';
    let dim = V.hidden ? 0.24 : 0.12; // peering through locker slats lets you see a little further
    if (S.power) dim = 0.32 + 0.14 * Math.max(0, Math.sin(t * 3.2));
    d.fillStyle = `rgba(0,0,0,${dim})`;
    pathPoly(d, losPts);
    d.fill();
    if (!V.hidden) {
      d.fillStyle = radial(d, vx, vy, 2.6, V.fl ? 0.4 : 0.6);
      pathPoly(d, losPts);
      d.fill();
    }
    for (const L of lights) {
      d.fillStyle = radial(d, L.x, L.y, L.r, L.a);
      pathPoly(d, L.pts, L.x, L.y);
      d.fill();
    }
    d.save();
    pathPoly(d, losPts);
    d.clip();
    for (const L of statics) {
      d.fillStyle = radial(d, L.x, L.y, L.r, L.i, 0.3);
      pathPoly(d, L.pts, L.full ? null : L.x, L.full ? null : L.y);
      d.fill();
    }
    d.restore();
    for (const c of S.clocks) {
      if (Math.sin(t * 14) > 0) {
        d.fillStyle = radial(d, c.x, c.y, 1.4, 0.5);
        d.beginPath();
        d.arc(c.x, c.y, 1.4, 0, TAU);
        d.fill();
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.dark, 0, 0);

    // ---- glows that pierce the dark
    g.setTransform(ts, 0, 0, ts, ox, oy);
    g.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, col, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    };
    for (const mo of S.monsters) {
      if (mo.st === 'dormant') continue;
      const dist = Math.hypot(mo.x - vx, mo.y - vy);
      if (dist > 15 || !los(m, vx, vy, mo.x, mo.y)) continue;
      const hunting = mo.st === 'chase' || mo.st === 'grab';
      const col = hunting ? '255,40,25' : '255,235,200';
      const a = (hunting ? 0.95 : 0.55) * (0.75 + 0.25 * Math.sin(t * 9 + mo.x));
      for (const s of [-1, 1]) {
        const ex = mo.x + (Math.cos(mo.a) * 0.43 - Math.sin(mo.a) * 0.055 * s) * MON_SCALE;
        const ey = mo.y + (Math.sin(mo.a) * 0.43 + Math.cos(mo.a) * 0.055 * s) * MON_SCALE;
        glow(ex, ey, 0.2, col, a);
      }
    }
    const ex = m.exit;
    glow(ex.x0 + 1, ex.y - 0.35, 1.0, '40,255,90', 0.22 + 0.06 * Math.sin(t * 2));
    if (m.fusebox) {
      const f = m.fusebox;
      const on = S.power ? true : Math.sin(t * 4) > 0;
      if (on) glow(f.x + 0.5 + [0, -0.35, 0, 0.35][f.dir], f.y + 0.5 + [0.35, 0, -0.35, 0][f.dir], 0.35, S.power ? '60,255,90' : '255,40,30', 0.6);
    }
    for (const it of S.items) {
      if (it.taken || it.k !== 'fuse') continue;
      const dist = Math.hypot(it.x - vx, it.y - vy);
      if (dist < 9 && los(m, vx, vy, it.x, it.y)) glow(it.x, it.y, 0.45, '255,170,60', 0.12 + 0.08 * Math.sin(t * 4 + it.id));
    }
    for (const c of S.clocks) if (Math.sin(t * 14) > 0) glow(c.x, c.y, 0.5, '255,40,30', 0.7);
    g.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
    text(g, 'EXIT', (ex.x0 + 1) * ts + ox, (ex.y - 0.3) * ts + oy, 0.32 * ts, 'rgba(90,255,130,0.9)');
    g.setTransform(1, 0, 0, 1, 0, 0);

    // ---- labels: teammates, cries for help, chat bubbles
    g.font = '13px "Courier New", monospace';
    g.textAlign = 'center';
    for (const p of S.players.values()) {
      if (p === V.me || (p.st !== 'alive' && p.st !== 'down') || p.h >= 0) continue;
      const px = p.x * ts + ox;
      const py = p.y * ts + oy;
      const dist = Math.hypot(p.x - vx, p.y - vy);
      const visible = dist < 16 && los(m, vx, vy, p.x, p.y);
      if (p.st === 'down') {
        const onScreen = px > 30 && px < W - 30 && py > 40 && py < H - 30;
        const pulse = 0.6 + 0.4 * Math.sin(t * 6);
        const label = `HELP! ${p.name} ${Math.ceil(p.downT || 0)}s`;
        g.fillStyle = `rgba(255,60,50,${pulse})`;
        if (onScreen) {
          g.font = 'bold 14px "Courier New", monospace';
          g.fillText(label, px, py - ts * 0.8);
        } else {
          // Pin an arrow to the screen edge pointing at them.
          const ang = Math.atan2(py - H / 2, px - W / 2);
          const ddx = px - W / 2;
          const ddy = py - H / 2;
          const kk = Math.min((W / 2 - 60) / Math.max(1e-6, Math.abs(ddx)), (H / 2 - 50) / Math.max(1e-6, Math.abs(ddy)));
          const cxp = W / 2 + ddx * kk;
          const cyp = H / 2 + ddy * kk;
          g.save();
          g.translate(cxp, cyp);
          g.rotate(ang);
          g.beginPath();
          g.moveTo(14, 0);
          g.lineTo(-6, -9);
          g.lineTo(-6, 9);
          g.closePath();
          g.fill();
          g.restore();
          g.font = 'bold 12px "Courier New", monospace';
          g.fillText(`${p.name} ${Math.round(dist)}m`, cxp, cyp + 22);
        }
        g.font = '13px "Courier New", monospace';
      } else {
        g.fillStyle = visible ? 'rgba(235,230,220,0.85)' : 'rgba(235,230,220,0.28)';
        if (visible || dist < 40) g.fillText(p.name, px, py - ts * 0.55);
      }
      const b = S.bubbles.get(p.id);
      if (b && b.until > t && (visible || dist < 12)) this.bubble(g, b.text, px, py - ts * 0.55 - 22);
    }
    const mb = V.me && S.bubbles.get(V.me.id);
    if (mb && mb.until > t) this.bubble(g, mb.text, V.me.x * ts + ox, V.me.y * ts + oy - ts * 0.55 - 8);

    // ---- screen effects
    if (V.hidden) {
      g.drawImage(this.slats, 0, 0);
    }
    if (V.chase > 0.01) {
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(120,0,0,0)');
      gr.addColorStop(1, `rgba(140,0,0,${0.55 * V.chase * (0.75 + 0.25 * Math.sin(t * 8))})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    if (V.flash > 0) {
      g.fillStyle = `rgba(160,0,0,${V.flash})`;
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(this.vignette, 0, 0);
    g.save();
    g.globalAlpha = 0.55 + V.chase * 0.4;
    g.translate(-Math.random() * 256, -Math.random() * 256);
    g.fillStyle = this.grainPat;
    g.fillRect(0, 0, W + 256, H + 256);
    g.restore();
  }

  bubble(g, msg, x, y) {
    g.font = '13px "Courier New", monospace';
    const w = Math.min(260, g.measureText(msg).width + 14);
    g.fillStyle = 'rgba(10,10,14,0.8)';
    rrect(g, x - w / 2, y - 12, w, 22, 6);
    g.fill();
    g.fillStyle = '#eee';
    g.textAlign = 'center';
    g.fillText(msg.length > 34 ? msg.slice(0, 33) + '…' : msg, x, y + 4);
  }

  // ---------- map overlay (M)
  drawMap(S, V) {
    const { g, W, H } = this;
    const m = this.map;
    const k = Math.floor(Math.min((W * 0.86) / m.w, (H * 0.8) / m.h));
    const mw = m.w * k;
    const mh = m.h * k;
    const x0 = Math.floor((W - mw) / 2);
    const y0 = Math.floor((H - mh) / 2) + 10;
    if (!this.mini || this.miniK !== k || S.exploredDirty) {
      S.exploredDirty = false;
      this.miniK = k;
      const c = (this.mini = this.mini && this.mini.width === mw ? this.mini : document.createElement('canvas'));
      c.width = mw;
      c.height = mh;
      const mg = c.getContext('2d');
      mg.clearRect(0, 0, mw, mh);
      const ex = S.explored;
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          const t = m.tiles[i];
          if (t === T.VOID) continue;
          let known = ex[i];
          if (t === T.WALL) {
            known = (x > 0 && ex[i - 1]) || (x < m.w - 1 && ex[i + 1]) || (y > 0 && ex[i - m.w]) || (y < m.h - 1 && ex[i + m.w]);
          }
          if (!known) continue;
          if (t === T.WALL) mg.fillStyle = '#54525c';
          else if (t === T.DOOR) mg.fillStyle = '#8a5a30';
          else if (t === T.EXIT) mg.fillStyle = '#3ad06a';
          else if (FSOLID[m.furn[i]]) mg.fillStyle = '#2a2a30';
          else mg.fillStyle = t === T.HALL ? '#1d1d24' : '#24232c';
          mg.fillRect(x * k, y * k, k, k);
        }
      }
      mg.font = `bold ${Math.max(9, k * 0.9)}px "Courier New", monospace`;
      mg.textAlign = 'center';
      mg.textBaseline = 'middle';
      for (const r of m.rooms) {
        const cxr = Math.floor((r.x0 + r.x1) / 2);
        const cyr = Math.floor((r.y0 + r.y1) / 2);
        if (!ex[cyr * m.w + cxr]) continue;
        mg.fillStyle = r.type === 'boiler' ? '#e0b030' : 'rgba(200,195,185,0.75)';
        mg.fillText(r.name.replace('Detention · ', 'Detention '), ((r.x0 + r.x1 + 1) / 2) * k, ((r.y0 + r.y1 + 1) / 2) * k);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.82)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0c0c10';
    g.fillRect(x0 - 8, y0 - 8, mw + 16, mh + 16);
    g.drawImage(this.mini, x0, y0);
    g.font = 'bold 18px "Courier New", monospace';
    g.textAlign = 'center';
    g.fillStyle = '#d8d2c4';
    g.fillText('SCHOOL MAP — only places you have seen', W / 2, y0 - 18);
    const dot = (x, y, col, r) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x0 + x * k, y0 + y * k, r, 0, TAU);
      g.fill();
    };
    const ex = m.exit;
    g.font = `bold ${Math.max(10, k)}px "Courier New", monospace`;
    g.fillStyle = '#3ad06a';
    g.fillText('EXIT', x0 + (ex.x0 + 1) * k, y0 + (ex.y + 1.6) * k);
    if (m.fusebox && S.explored[m.fusebox.fy * m.w + m.fusebox.fx]) {
      dot(m.fusebox.x + 0.5, m.fusebox.y + 0.5, '#ffcc33', Math.max(4, k * 0.5));
      g.fillStyle = '#ffcc33';
      g.fillText('FUSE BOX', x0 + (m.fusebox.x + 0.5) * k, y0 + (m.fusebox.y - 0.8) * k);
    }
    for (const it of S.items) {
      if (!it.taken && it.k === 'fuse' && S.explored[Math.floor(it.y) * m.w + Math.floor(it.x)] && it.seen) dot(it.x, it.y, '#ff9a3c', Math.max(3, k * 0.35));
    }
    for (const p of S.players.values()) {
      if (p.st !== 'alive' && p.st !== 'down') continue;
      if (p.st === 'down') dot(p.x, p.y, Math.sin(S.t * 8) > 0 ? '#ff3030' : '#661010', Math.max(5, k * 0.6));
      dot(p.x, p.y, p.color, Math.max(3, k * 0.45));
      if (p === V.me) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x0 + p.x * k, y0 + p.y * k, Math.max(6, k * 0.8), 0, TAU);
        g.stroke();
      }
    }
    g.font = '14px "Courier New", monospace';
    g.fillStyle = '#8a857a';
    g.fillText('[M] close', W / 2, y0 + mh + 26);
  }

  // ---------- jumpscare
  // The Hall Monitor's face lunging out of the dark. p: 0..1 progress.
  drawScare(p) {
    const { g, W, H } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const lunge = Math.min(1, p * 2.2);
    const s = Math.min(W, H) * (0.55 + lunge * lunge * 1.05 + p * 0.25);
    const jit = 10 + lunge * 30;
    g.save();
    g.translate(W / 2 + (Math.random() - 0.5) * jit, H / 2 + (Math.random() - 0.5) * jit + s * 0.06);
    g.rotate((Math.random() - 0.5) * 0.1);
    g.scale(1, 1.08);
    // long pale porcelain face, lit from below
    const fg = g.createRadialGradient(0, s * 0.12, s * 0.02, 0, -s * 0.05, s * 0.5);
    fg.addColorStop(0, '#f2eee4');
    fg.addColorStop(0.45, '#b9b2a4');
    fg.addColorStop(0.8, '#4a443c');
    fg.addColorStop(1, '#0a0908');
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(0, -s * 0.5);
    g.bezierCurveTo(s * 0.34, -s * 0.48, s * 0.33, s * 0.1, s * 0.16, s * 0.42);
    g.quadraticCurveTo(0, s * 0.56, -s * 0.16, s * 0.42);
    g.bezierCurveTo(-s * 0.33, s * 0.1, -s * 0.34, -s * 0.48, 0, -s * 0.5);
    g.fill();
    // cracks
    g.strokeStyle = 'rgba(20,12,8,0.75)';
    g.lineWidth = Math.max(1.5, s * 0.004);
    g.beginPath();
    g.moveTo(-s * 0.04, -s * 0.5);
    g.lineTo(-s * 0.01, -s * 0.36);
    g.lineTo(-s * 0.07, -s * 0.27);
    g.lineTo(-s * 0.05, -s * 0.18);
    g.moveTo(s * 0.2, -s * 0.3);
    g.lineTo(s * 0.13, -s * 0.22);
    g.lineTo(s * 0.16, -s * 0.12);
    g.stroke();
    // hollow eye sockets that drip
    for (const sd of [-1, 1]) {
      const eg = g.createRadialGradient(sd * s * 0.1, -s * 0.1, 0, sd * s * 0.1, -s * 0.1, s * 0.12);
      eg.addColorStop(0, '#000');
      eg.addColorStop(0.7, '#000');
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(sd * s * 0.1, -s * 0.1, s * 0.085, s * 0.12, sd * 0.3, 0, TAU);
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(sd * s * 0.1 - s * 0.006, -s * 0.02, s * 0.012, s * (0.08 + 0.06 * p));
      // pinprick pupils
      g.fillStyle = `rgba(255,${40 + Math.random() * 40},20,0.95)`;
      g.beginPath();
      g.arc(sd * s * 0.095, -s * 0.1, s * 0.006, 0, TAU);
      g.fill();
    }
    // stretched mouth
    const open = 0.16 + p * 0.12;
    g.fillStyle = '#030202';
    g.beginPath();
    g.moveTo(-s * 0.1, s * 0.12);
    g.quadraticCurveTo(0, s * 0.06, s * 0.1, s * 0.12);
    g.quadraticCurveTo(s * 0.07, s * (0.12 + open), 0, s * (0.15 + open));
    g.quadraticCurveTo(-s * 0.07, s * (0.12 + open), -s * 0.1, s * 0.12);
    g.fill();
    g.fillStyle = '#d6cdb4';
    for (let k = -5; k <= 5; k++) {
      const tx = k * s * 0.016;
      const top = s * 0.105 + Math.abs(k) * s * 0.004;
      const len = s * (0.03 + ((k * 7919) % 5) * 0.006);
      g.beginPath();
      g.moveTo(tx - s * 0.007, top);
      g.lineTo(tx + s * 0.007, top);
      g.lineTo(tx, top + len);
      g.fill();
    }
    g.restore();
    // darkness closing in around it
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    // tearing scanlines
    for (let k = 0; k < 7; k++) {
      const y = Math.random() * H;
      const hh = Math.random() * 26 + 3;
      g.drawImage(this.c, 0, y, W, hh, (Math.random() - 0.5) * 90, y, W, hh);
    }
    if (Math.random() < 0.35) {
      g.fillStyle = 'rgba(120,0,0,0.35)';
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 0.85;
    g.translate(-Math.random() * 256, -Math.random() * 256);
    g.fillStyle = this.grainPat;
    g.fillRect(0, 0, W + 256, H + 256);
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
