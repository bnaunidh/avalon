// First-person 3D renderer (three.js). Same map, same server — just seen from inside.
// World axes: map x -> world x, map y -> world z, y is up. One tile = one metre.
import * as THREE from '../vendor/three.min.js';
import { T, F, FSOLID } from '../shared/constants.js';
import { los } from '../shared/grid.js';
import { prerenderFloor } from './render.js';

const WALL_H = 3;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

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

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noise(g, w, h, n, alpha, R) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.6})`;
    g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3);
  }
}

// ---------------------------------------------------------------- textures
function makeTextures() {
  const R = rng(99);
  const wall = canvasTex(256, 768, (g, w, h) => {
    g.fillStyle = '#b3a88f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, 0.05, R);
    const band = h * (1 - 1.15 / WALL_H);
    g.fillStyle = '#4c5d55';
    g.fillRect(0, band, w, h - band);
    noise(g, w, h - band, 1500, 0.06, R);
    g.fillStyle = '#2b3530';
    g.fillRect(0, band - 6, w, 8);
    g.fillStyle = '#211d1a';
    g.fillRect(0, h - 26, w, 26);
    for (let i = 0; i < 7; i++) {
      const x = R() * w;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(60,45,30,0)');
      gr.addColorStop(0.5, 'rgba(60,45,30,0.18)');
      gr.addColorStop(1, 'rgba(60,45,30,0)');
      g.fillStyle = gr;
      g.fillRect(x, R() * h * 0.4, 3 + R() * 8, h * 0.6);
    }
  });
  const ceiling = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7d7a73';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 3000, 0.05, R);
    g.strokeStyle = '#3a3936';
    g.lineWidth = 5;
    for (let k = 0; k <= 2; k++) {
      g.beginPath();
      g.moveTo(k * (w / 2), 0);
      g.lineTo(k * (w / 2), h);
      g.moveTo(0, k * (h / 2));
      g.lineTo(w, k * (h / 2));
      g.stroke();
    }
    g.fillStyle = 'rgba(90,70,40,0.35)';
    g.beginPath();
    g.ellipse(170, 70, 34, 22, 0.4, 0, TAU);
    g.fill();
    g.fillStyle = '#9a978e';
    g.fillRect(12, 140, 104, 104);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 6; k++) g.fillRect(16, 146 + k * 17, 96, 3);
  }, [1, 1]);
  const locker = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(w / 2 - 2, 0, 4, h);
    g.fillRect(0, 0, 3, h);
    g.fillRect(w - 3, 0, 3, h);
    for (const ox of [0, w / 2]) {
      for (let k = 0; k < 6; k++) g.fillRect(ox + 14, 18 + k * 9, w / 2 - 28, 4);
      for (let k = 0; k < 6; k++) g.fillRect(ox + 14, h - 70 + k * 9, w / 2 - 28, 4);
      g.fillStyle = '#9a9a92';
      g.fillRect(ox + w / 2 - 14, h / 2 - 10, 6, 26);
      g.fillStyle = 'rgba(0,0,0,0.55)';
    }
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, 0, w, 4);
  });
  const closet = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#6e4c2e';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 900, 0.08, R);
    g.strokeStyle = '#3a2614';
    g.lineWidth = 4;
    g.strokeRect(4, 4, w / 2 - 6, h - 8);
    g.strokeRect(w / 2 + 2, 4, w / 2 - 6, h - 8);
    g.fillStyle = '#c9b070';
    g.fillRect(w / 2 - 10, h / 2, 5, 18);
    g.fillRect(w / 2 + 5, h / 2, 5, 18);
  });
  const door = canvasTex(128, 320, (g, w, h) => {
    g.fillStyle = '#5a3a22';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 1200, 0.07, R);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(R() * w, 0, 1, h);
    }
    g.fillStyle = '#121a26';
    g.fillRect(w * 0.3, h * 0.14, w * 0.4, h * 0.22);
    g.strokeStyle = '#2b1a0e';
    g.lineWidth = 4;
    g.strokeRect(w * 0.3, h * 0.14, w * 0.4, h * 0.22);
    g.fillStyle = '#8a8a82';
    g.fillRect(0, h * 0.86, w, h * 0.1);
    g.fillStyle = '#c8b070';
    g.fillRect(w * 0.82, h * 0.5, 10, 8);
  });
  const glass = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#5a7896';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(6, 0, 4, h);
  });
  const windowTex = canvasTex(128, 192, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5b78a8');
    gr.addColorStop(1, '#1d2a44');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8eef8';
    g.beginPath();
    g.arc(w * 0.72, h * 0.22, 9, 0, TAU);
    g.fill();
    g.fillStyle = '#0d0f14';
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 8, w, 8);
    g.fillRect(0, 0, 8, h);
    g.fillRect(w - 8, 0, 8, h);
    g.fillRect(w / 2 - 4, 0, 8, h);
    g.fillRect(0, h / 2 - 4, w, 8);
    for (let k = 0; k < 5; k++) {
      g.fillStyle = 'rgba(10,14,20,0.9)';
      const x = R() * w;
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 6, h * (0.55 + R() * 0.3));
      g.lineTo(x + 12, h);
      g.fill();
    }
  });
  const posterTexts = ['BE KIND', 'READ!', 'SCIENCE FAIR', 'NO RUNNING', 'VOTE', 'STAY QUIET', 'GO OWLS', 'LOST CAT'];
  const posterCols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#7d3c98', '#ca6f1e', '#909497', '#a93226'];
  const posters = posterTexts.map((txt, i) =>
    canvasTex(128, 176, (g, w, h) => {
      g.fillStyle = posterCols[i];
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = 'bold 22px Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText(txt, w / 2, 44);
      for (let k = 0; k < 5; k++) g.fillRect(16, 70 + k * 16, w - 32 - R() * 30, 5);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, h - 8, w, 8);
    }),
  );
  const frame = canvasTex(96, 128, (g, w, h) => {
    g.fillStyle = '#9b7b2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16120d';
    g.fillRect(9, 9, w - 18, h - 18);
    g.fillStyle = '#cfc6b4';
    g.beginPath();
    g.ellipse(w / 2, h * 0.42, 17, 22, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#2a2a30';
    g.fillRect(24, h * 0.62, w - 48, h * 0.3);
    g.fillStyle = '#000';
    g.fillRect(w / 2 - 9, h * 0.4, 6, 4);
    g.fillRect(w / 2 + 3, h * 0.4, 6, 4);
  });
  const exit = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#0a4a1c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7dff9c';
    g.font = 'bold 48px Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('EXIT', w / 2, h / 2 + 2);
  });
  const fusebox = canvasTex(96, 128, (g, w, h) => {
    g.fillStyle = '#6a6e72';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2c2e';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#e0b81f';
    g.beginPath();
    g.moveTo(54, 14);
    g.lineTo(34, 48);
    g.lineTo(48, 48);
    g.lineTo(40, 76);
    g.lineTo(62, 40);
    g.lineTo(48, 40);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    g.fillText('DANGER', w / 2, 100);
  });
  return { wall, ceiling, locker, closet, door, glass, windowTex, posters, frame, exit, fusebox };
}

function boardTexture(text, len) {
  return canvasTex(160 * len, 176, (g, w, h) => {
    g.fillStyle = '#5b3e24';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f3a2a';
    g.fillRect(8, 8, w - 16, h - 22);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let k = 0; k < 14; k++) g.fillRect(Math.random() * w, 20 + Math.random() * (h - 50), 60 + Math.random() * 120, 10);
    g.fillStyle = 'rgba(235,235,225,0.88)';
    g.font = `bold ${Math.min(54, (w / Math.max(4, text.length)) * 1.4)}px "Comic Sans MS", "Chalkboard", cursive`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 - 6);
  });
}

// ---------------------------------------------------------------- instancing helpers
class Batch {
  constructor() {
    this.items = [];
  }
  add(x, y, z, sx, sy, sz, rotY, color, rx = 0, rz = 0) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, rotY, rz, 'YXZ'));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    this.items.push({ m, c: new THREE.Color(color) });
  }
  mesh(geo, mat, shadows = true) {
    const n = Math.max(1, this.items.length);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    this.items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    if (!this.items.length) mesh.count = 0;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function setSeg(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, d.normalize());
}

// ---------------------------------------------------------------- renderer
export class Renderer3D {
  constructor(canvas) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010102);
    this.scene.fog = new THREE.FogExp2(0x010102, 0.085);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.ambient = new THREE.AmbientLight(0x8a93b8, 0.07);
    this.scene.add(this.ambient);
    this.tex = makeTextures();

    // the player's flashlight, with shadows
    const fl = (this.flash = new THREE.SpotLight(0xffe7c4, 9, 20, 0.46, 0.75, 1.1));
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    fl.shadow.camera.near = 0.1;
    fl.shadow.camera.far = 20;
    fl.shadow.bias = -0.0004;
    this.scene.add(fl, fl.target);
    // a faint glow around yourself so you are never completely blind
    this.near = new THREE.PointLight(0xa0a8c8, 0.5, 3.2, 1.5);
    this.scene.add(this.near);
    // teammates' flashlights (fixed pool so shaders never recompile)
    this.mates = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.SpotLight(0xffe7c4, 0, 16, 0.44, 0.55, 1.1);
      this.scene.add(s, s.target);
      this.mates.push(s);
    }
    // moonlight through nearby windows, plus the green exit sign and the red fuse box LED
    this.moons = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.PointLight(0x7f9cff, 0, 6, 1.3);
      this.scene.add(p);
      this.moons.push(p);
    }
    this.exitLight = new THREE.PointLight(0x40ff70, 0, 6, 1.4);
    this.fuseLight = new THREE.PointLight(0xff2a1a, 0, 3, 1.5);
    this.clockLight = new THREE.PointLight(0xff2010, 0, 4, 1.5);
    this.scene.add(this.exitLight, this.fuseLight, this.clockLight);
    this.world = null;
    this.players = new Map();
    this.monsters = [];
    this.itemMeshes = new Map();
    this.clockMeshes = new Map();
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMap(map) {
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material && !o.material.shared) [].concat(o.material).forEach((m) => m.dispose());
      });
    }
    this.map = map;
    this.players.clear();
    this.monsters = [];
    this.itemMeshes.clear();
    this.clockMeshes.clear();
    const W = map.w;
    const H = map.h;
    const world = (this.world = new THREE.Group());
    this.scene.add(world);
    const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.VOID : map.tiles[y * W + x]);
    const floorish = (t) => t === T.HALL || t === T.ROOM || t === T.DOOR || t === T.EXIT;
    const R = rng(1234);

    // floor: the top-down art becomes the floor texture
    const floorTex = new THREE.CanvasTexture(prerenderFloor(map));
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.anisotropy = this.r.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    world.add(floor);
    const ceilTex = this.tex.ceiling.clone();
    ceilTex.needsUpdate = true;
    ceilTex.repeat.set(W / 2, H / 2);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(W / 2, WALL_H, H / 2);
    ceiling.receiveShadow = true;
    world.add(ceiling);

    // walls (only those touching walkable space) and lintels over doorways
    const walls = new Batch();
    const lintels = new Batch();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tile(x, y);
        if (t === T.WALL) {
          let visible = false;
          for (let dy = -1; dy <= 1 && !visible; dy++) for (let dx = -1; dx <= 1; dx++) if (floorish(tile(x + dx, y + dy))) visible = true;
          if (visible) walls.add(x + 0.5, WALL_H / 2, y + 0.5, 1, 1, 1, 0, 0xffffff);
        } else if (t === T.DOOR || t === T.EXIT) {
          lintels.add(x + 0.5, 2.3 + (WALL_H - 2.3) / 2, y + 0.5, 1, 1, 1, 0, 0xffffff);
        }
      }
    }
    const wallMat = new THREE.MeshStandardMaterial({ map: this.tex.wall, roughness: 0.9 });
    wallMat.shared = true;
    world.add(walls.mesh(new THREE.BoxGeometry(1, WALL_H, 1), wallMat));
    world.add(lintels.mesh(new THREE.BoxGeometry(1, WALL_H - 2.3, 1), new THREE.MeshStandardMaterial({ color: 0xb3a88f, roughness: 0.9 })));

    // furniture: a few instanced primitives with per-instance colours
    const boxes = new Batch();
    const cyls = new Batch();
    const balls = new Batch();
    const solidAt = (x, y) => FSOLID[map.furn[y * W + x]];
    const orient = (tx, ty, d) => {
      const [fx, fy] = DIRS[d % 4];
      const rx = -fy;
      const ry = fx;
      return {
        at: (lx, lz) => [tx + 0.5 + rx * lx + fx * lz, ty + 0.5 + ry * lx + fy * lz],
        rot: Math.atan2(-ry, rx),
        f: [fx, fy],
      };
    };
    const BOOKS = [0x7a2e2e, 0x2e4a7a, 0x2e6a3e, 0x7a6a2e, 0x5a2e6a, 0x8a5a2e, 0x3e3e3e, 0xa08868];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = map.furn[y * W + x];
        if (!k || !FSOLID[k]) continue;
        const d = map.fdir[y * W + x];
        const o = orient(x, y, d);
        const B = (lx, cy, lz, sx, sy, sz, col, rx = 0, rz = 0) => {
          const [wx, wz] = o.at(lx, lz);
          boxes.add(wx, cy, wz, sx, sy, sz, o.rot, col, rx, rz);
        };
        const C = (lx, cy, lz, r, h, col) => {
          const [wx, wz] = o.at(lx, lz);
          cyls.add(wx, cy, wz, r, h, r, 0, col);
        };
        switch (k) {
          case F.DESK:
            B(0, 0.74, 0.08, 0.7, 0.04, 0.5, 0x9a7448);
            for (const [lx, lz] of [[-0.3, -0.12], [0.3, -0.12], [-0.3, 0.28], [0.3, 0.28]]) B(lx, 0.36, lz, 0.04, 0.72, 0.04, 0x3c4048);
            B(0, 0.45, -0.38, 0.42, 0.04, 0.4, 0x3c4048);
            B(0, 0.68, -0.58, 0.42, 0.42, 0.04, 0x3c4048);
            if (R() < 0.4) B((R() - 0.5) * 0.3, 0.765, 0.1, 0.22, 0.01, 0.28, 0xddd8cc);
            break;
          case F.TDESK:
            B(0, 0.38, 0, 1, 0.76, 0.8, 0x5e4027);
            B(0, 0.78, 0, 1.02, 0.04, 0.84, 0x704c2e);
            if (R() < 0.5) B((R() - 0.5) * 0.4, 0.82, 0, 0.3, 0.04, 0.22, 0xddd8cc);
            break;
          case F.SHELF:
            B(0, 1.05, 0, 1, 2.1, 0.5, 0x35261a);
            for (const side of [-1, 1]) {
              for (let row = 0; row < 4; row++) {
                let lx = -0.46;
                while (lx < 0.42) {
                  const bw = 0.12 + R() * 0.22;
                  if (R() > 0.12) B(lx + bw / 2, 0.32 + row * 0.5, side * 0.2, bw - 0.02, 0.3 + R() * 0.08, 0.14, BOOKS[Math.floor(R() * BOOKS.length)]);
                  lx += bw;
                }
              }
            }
            break;
          case F.TABLE:
            B(0, 0.74, 0, 1, 0.05, 0.7, 0x8a8d93);
            B(0, 0.36, 0, 0.12, 0.72, 0.5, 0x4f535a);
            B(0, 0.45, 0.48, 1, 0.05, 0.22, 0x4f535a);
            B(0, 0.45, -0.48, 1, 0.05, 0.22, 0x4f535a);
            if (R() < 0.4) B((R() - 0.5) * 0.5, 0.78, (R() - 0.5) * 0.3, 0.32, 0.03, 0.24, 0x6a7a8a);
            break;
          case F.BENCH:
            B(0, 0.45, 0, 1, 0.9, 0.7, 0x26282c);
            B(0, 0.92, 0, 1.02, 0.04, 0.74, 0x3a3d42);
            if (R() < 0.6) C((R() - 0.5) * 0.6, 1.02, (R() - 0.5) * 0.4, 0.05, 0.16, 0x7fd8c0);
            break;
          case F.SINK:
            B(0, 0.42, -0.2, 0.7, 0.85, 0.55, 0xc8cccc);
            B(0, 0.98, -0.42, 0.06, 0.25, 0.06, 0x8f9799);
            break;
          case F.BLEACH: {
            const back = tile(x - o.f[0], y - o.f[1]) === T.WALL;
            const h = back ? 1.1 : 0.55;
            B(0, h / 2, 0, 1, h, 0.98, back ? 0x5d6066 : 0x70737a);
            B(0, h + 0.02, 0, 1, 0.04, 0.98, 0x8a8d93);
            break;
          }
          case F.STALL:
            B(0, 1.05, 0, 0.9, 1.8, 0.9, 0x5f6d64);
            break;
          case F.BOILER:
            if (map.furn[y * W + x - 1] !== F.BOILER && map.furn[(y - 1) * W + x] !== F.BOILER) {
              cyls.add(x + 1, 1.25, y + 1, 0.92, 2.5, 0.92, 0, 0x4a4642);
              balls.add(x + 1, 2.5, y + 1, 0.92, 0.3, 0.92, 0, 0x3a3632);
              cyls.add(x + 1, 2.75, y + 1, 0.14, 0.5, 0.14, 0, 0x545a60);
              cyls.add(x + 1.6, 1.2, y + 1.35, 0.17, 0.08, 0.17, 0, 0xd8d4c4);
            }
            break;
          case F.PIPE:
            B(0, 0.3, -0.25, 1, 0.6, 0.45, 0x545a60);
            B(0, 1.6, -0.36, 1, 0.12, 0.12, 0x6e4b2e);
            B(0, 2.4, -0.36, 1, 0.16, 0.16, 0x545a60);
            break;
          case F.VEND:
            B(0, 0.95, -0.05, 0.9, 1.9, 0.8, 0x1e2a44);
            B(0, 1.3, 0.36, 0.7, 0.9, 0.02, 0x3e5a8a);
            B(0, 0.3, 0.36, 0.7, 0.2, 0.02, 0xa0281e);
            break;
          case F.CABINET:
            B(0, 0.65, -0.15, 0.8, 1.3, 0.6, 0x5a5e63);
            for (let s = 0; s < 3; s++) B(0, 0.3 + s * 0.4, 0.16, 0.12, 0.03, 0.02, 0x2c2e31);
            break;
          case F.PIANO:
            B(0, 0.5, 0, 1, 1.0, 0.6, 0x111114);
            B(0, 0.76, 0.36, 1, 0.04, 0.2, 0xe8e6de);
            break;
          case F.COUNTER:
            B(0, 0.46, 0, 1, 0.92, 0.7, 0x9da0a6);
            B(0, 1.25, 0, 1, 0.02, 0.5, 0xc6c9ce);
            break;
          case F.TRASH:
            C(0, 0.35, 0, 0.25, 0.7, 0x4a5550);
            break;
          case F.PLANT:
            C(0, 0.2, 0, 0.22, 0.4, 0x7a4a2a);
            balls.add(x + 0.5, 0.78, y + 0.5, 0.42, 0.5, 0.42, 0, R() < 0.4 ? 0x5a4a22 : 0x2f5a2a);
            break;
          case F.TROPHY:
            B(0, 0.95, 0, 0.95, 1.9, 0.55, 0x3a2618);
            for (const hh of [1.05, 1.5]) {
              const [wx, wz] = o.at((R() - 0.5) * 0.4, 0.3);
              balls.add(wx, hh, wz, 0.09, 0.12, 0.09, 0, 0xc9a23a);
            }
            break;
          case F.COT:
            B(0, 0.22, 0, 0.95, 0.45, 0.8, 0xd6d8cf);
            break;
          case F.EASEL:
            B(0, 0.7, 0.05, 0.04, 1.4, 0.04, 0x7a5530, 0.15);
            B(-0.25, 0.65, 0, 0.04, 1.3, 0.04, 0x7a5530, -0.1, 0.15);
            B(0.25, 0.65, 0, 0.04, 1.3, 0.04, 0x7a5530, -0.1, -0.15);
            B(0, 1.3, -0.02, 0.62, 0.5, 0.03, 0xe6e0d0, 0.15);
            break;
          case F.DEBRIS:
            for (let s = 0; s < 6; s++) {
              const col = [0x4b4945, 0x5e5b55, 0x3a3936, 0x8a877d, 0x6b4a2e][Math.floor(R() * 5)];
              B((R() - 0.5) * 0.7, 0.2 + R() * 1.6, (R() - 0.5) * 0.7, 0.3 + R() * 0.6, 0.1 + R() * 0.3, 0.3 + R() * 0.6, col, (R() - 0.5) * 1.2, (R() - 0.5) * 1.2);
            }
            break;
          case F.BUCKET:
            B(0, 0.22, 0, 0.5, 0.45, 0.4, 0xc9a314);
            B(0.15, 0.8, 0, 0.04, 1.2, 0.04, 0x8a6a3a, 0, 0.3);
            break;
          case F.SEAT:
            B(0, 0.22, 0, 1, 0.45, 0.45, 0x5b3f26);
            break;
          default:
            if (solidAt(x, y)) B(0, 0.4, 0, 0.8, 0.8, 0.8, 0x555555);
        }
      }
    }
    const furnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    world.add(boxes.mesh(new THREE.BoxGeometry(1, 1, 1), furnMat));
    world.add(cyls.mesh(new THREE.CylinderGeometry(1, 1, 1, 16), furnMat));
    world.add(balls.mesh(new THREE.SphereGeometry(1, 16, 12), furnMat));

    // things on walls
    const face = (x, y, d, out = 0.5) => {
      const [dx, dy] = DIRS[d];
      return { x: x + 0.5 + dx * out, z: y + 0.5 + dy * out, rot: Math.atan2(dx, dy) };
    };
    const lockers = new Batch();
    const closets = new Batch();
    for (const h of map.hides) {
      const f = face(h.x, h.y, h.dir, 0.55);
      if (h.kind === 'locker') lockers.add(f.x, 1.0, f.z, 1, 1, 1, f.rot, h.color || '#3c5a7a');
      else closets.add(f.x, 1.0, f.z, 1, 1, 1, f.rot, 0xffffff);
    }
    world.add(lockers.mesh(new THREE.BoxGeometry(0.96, 2.0, 0.12), new THREE.MeshStandardMaterial({ map: this.tex.locker, roughness: 0.55, metalness: 0.35 })));
    world.add(closets.mesh(new THREE.BoxGeometry(0.9, 2.0, 0.14), new THREE.MeshStandardMaterial({ map: this.tex.closet, roughness: 0.8 })));
    const plane = (w, h, mat, f, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(f.x, y, f.z);
      m.rotation.y = f.rot;
      m.receiveShadow = true;
      world.add(m);
      return m;
    };
    const windowMat = new THREE.MeshBasicMaterial({ map: this.tex.windowTex, color: 0x9aaad0, fog: true });
    const frameMat = new THREE.MeshStandardMaterial({ map: this.tex.frame, roughness: 0.6 });
    const posterMats = this.tex.posters.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
    for (const d of map.decor) {
      if (d.k === 'window') plane(0.86, 1.3, windowMat, face(d.x, d.y, d.dir, 0.505), 1.65);
      else if (d.k === 'poster') {
        const p = plane(0.5, 0.7, posterMats[d.v % posterMats.length], face(d.x, d.y, d.dir, 0.505), 1.45 + (d.v % 3) * 0.08);
        p.rotation.z = ((d.v % 5) - 2) * 0.03;
      } else if (d.k === 'frame') plane(0.42, 0.56, frameMat, face(d.x, d.y, d.dir, 0.505), 1.6);
      else if (d.k === 'board') {
        const n = d.cells.length;
        const cx = d.cells.reduce((s, c) => s + c[0], 0) / n;
        const cy = d.cells.reduce((s, c) => s + c[1], 0) / n;
        plane(n - 0.1, 1.15, new THREE.MeshStandardMaterial({ map: boardTexture(d.text, n), roughness: 0.95 }), face(cx, cy, d.dir, 0.505), 1.5);
      }
    }
    // fuse box with a slot per fuse
    this.fuseSlots = [];
    this.fuseLed = null;
    if (map.fusebox) {
      const fb = map.fusebox;
      const f = face(fb.x, fb.y, fb.dir, 0.58);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.95, 0.16), new THREE.MeshStandardMaterial({ map: this.tex.fusebox, roughness: 0.6, metalness: 0.4 }));
      box.position.set(f.x, 1.45, f.z);
      box.rotation.y = f.rot;
      box.castShadow = true;
      world.add(box);
      const [dx, dy] = DIRS[fb.dir];
      const rx = -dy;
      const ry = dx;
      const n = map.fusesNeeded || 4;
      for (let i = 0; i < n; i++) {
        const off = -0.27 + (0.54 * (i + 0.5)) / n;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.04), new THREE.MeshBasicMaterial({ color: 0x151618 }));
        s.position.set(f.x + rx * off + dx * 0.09, 1.12, f.z + ry * off + dy * 0.09);
        s.rotation.y = f.rot;
        world.add(s);
        this.fuseSlots.push(s);
      }
      const led = (this.fuseLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2010 })));
      led.position.set(f.x + rx * 0.28 + dx * 0.09, 1.82, f.z + ry * 0.28 + dy * 0.09);
      world.add(led);
      this.fuseLight.position.set(f.x + dx * 0.5, 1.8, f.z + dy * 0.5);
    }

    // doors swing on hinges
    const doorMat = new THREE.MeshStandardMaterial({ map: this.tex.door, roughness: 0.7 });
    const slabGeo = new THREE.BoxGeometry(0.9, 2.28, 0.07);
    this.doors = map.doors.map((d) => {
      const pivot = new THREE.Group();
      if (d.ax === 'h') {
        pivot.position.set(d.x + 0.05, 0, d.y + 0.5);
        pivot.userData.base = 0;
      } else {
        pivot.position.set(d.x + 0.5, 0, d.y + 0.05);
        pivot.userData.base = -Math.PI / 2;
      }
      const slab = new THREE.Mesh(slabGeo, doorMat);
      slab.position.set(0.45, 1.14, 0);
      slab.castShadow = true;
      slab.receiveShadow = true;
      pivot.add(slab);
      pivot.userData.ang = d.open ? -Math.PI / 2 : 0;
      pivot.rotation.y = pivot.userData.base + pivot.userData.ang;
      world.add(pivot);
      return pivot;
    });

    // front doors: glass, chained shut until the power returns
    const ex = map.exit;
    const glassMat = new THREE.MeshStandardMaterial({ map: this.tex.glass, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2 });
    this.exitDoors = [];
    for (const [x, side] of [[ex.x0, -1], [ex.x1, 1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(side < 0 ? x + 0.03 : x + 0.97, 0, ex.y + 0.5);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.28, 0.05), glassMat);
      slab.position.set(side < 0 ? 0.47 : -0.47, 1.14, 0);
      pivot.add(slab);
      pivot.userData.side = side;
      world.add(pivot);
      this.exitDoors.push(pivot);
    }
    const chains = (this.chains = new THREE.Group());
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.8, roughness: 0.35 });
    for (const [h, tilt] of [[1.0, 0.35], [1.25, -0.3], [1.5, 0.1]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.05), chainMat);
      c.position.set(ex.x0 + 1, h, ex.y + 0.45);
      c.rotation.z = tilt;
      c.castShadow = true;
      chains.add(c);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.08), new THREE.MeshStandardMaterial({ color: 0xc9a314, metalness: 0.7, roughness: 0.3 }));
    lock.position.set(ex.x0 + 1, 1.15, ex.y + 0.4);
    chains.add(lock);
    world.add(chains);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.28, 0.08), new THREE.MeshBasicMaterial({ map: this.tex.exit }));
    sign.position.set(ex.x0 + 1, 2.62, ex.y - 0.05);
    sign.rotation.y = Math.PI;
    world.add(sign);
    this.exitLight.position.set(ex.x0 + 1, 2.4, ex.y - 0.6);
    this.exitLight.intensity = 1.6;

    this.moonSpots = map.lights.filter((l) => l.c === 'moon');
    this.itemGeo = {
      fuse: new THREE.CylinderGeometry(0.06, 0.06, 0.26, 12),
      cap: new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12),
      battery: new THREE.CylinderGeometry(0.045, 0.045, 0.2, 12),
      clock: new THREE.SphereGeometry(0.11, 14, 10),
      drink: new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12),
    };
    this.itemMat = {
      fuse: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, emissive: 0xff8a20, emissiveIntensity: 0.35, roughness: 0.5 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.3, emissive: 0x664411, emissiveIntensity: 0.3 }),
      battery: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, emissive: 0x204a20, emissiveIntensity: 0.25, roughness: 0.4 }),
      clock: new THREE.MeshStandardMaterial({ color: 0xb3241c, emissive: 0x400000, emissiveIntensity: 0.4, roughness: 0.4 }),
      drink: new THREE.MeshStandardMaterial({ color: 0x6cf03a, emissive: 0x2a6a10, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5 }),
    };
  }

  // ------------------------------------------------------------ dynamic actors
  itemMesh(it) {
    let m = this.itemMeshes.get(it.id);
    if (m) return m;
    m = new THREE.Group();
    const G = this.itemGeo;
    const M = this.itemMat;
    if (it.k === 'fuse') {
      const body = new THREE.Mesh(G.fuse, M.fuse);
      body.rotation.z = Math.PI / 2;
      m.add(body);
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(G.cap, M.cap);
        cap.rotation.z = Math.PI / 2;
        cap.position.x = s * 0.14;
        m.add(cap);
      }
    } else {
      const body = new THREE.Mesh(G[it.k] || G.battery, M[it.k] || M.battery);
      if (it.k === 'battery') body.rotation.z = Math.PI / 2;
      m.add(body);
    }
    m.traverse((o) => {
      o.castShadow = true;
    });
    this.world.add(m);
    this.itemMeshes.set(it.id, m);
    return m;
  }

  playerMesh(p) {
    let o = this.players.get(p.id);
    if (o) return o;
    const skin = [0xe8c4a0, 0xc99a6e, 0x8d5a3a, 0xf0d0b0, 0xa87250, 0x5e3a24][p.id % 6];
    const hair = [0x2a1a10, 0x111111, 0x6a4a20, 0xb08840, 0x3a2418, 0x7a2a1a][(p.id * 7) % 6];
    const g = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.75, 14), jacket);
    body.position.y = 1.1;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, 0.36), dark);
    legs.position.y = 0.38;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
    head.position.y = 1.64;
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12, Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 }));
    hairM.position.set(-0.01, 1.66, 0);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.34), new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.45) }));
    pack.position.set(-0.3, 1.15, 0);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 10), dark);
    torch.rotation.z = Math.PI / 2;
    torch.position.set(0.3, 1.2, 0.2);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: 0xfff3c8 }));
    lens.rotation.y = Math.PI / 2;
    lens.position.set(0.415, 1.2, 0.2);
    g.add(body, legs, head, hairM, pack, torch, lens);
    g.traverse((m) => {
      m.castShadow = true;
    });
    this.world.add(g);
    o = { g, lens, legs };
    this.players.set(p.id, o);
    return o;
  }

  monsterMesh(i) {
    if (this.monsters[i]) return this.monsters[i];
    const g = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9c1b4, roughness: 0.55 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x141216, roughness: 0.95 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.0, 6, 12), bodyMat);
    torso.position.set(0.05, 1.75, 0);
    torso.rotation.z = -0.28;
    const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.9, 4, 8), skinMat);
    spine.position.set(-0.18, 1.85, 0);
    spine.rotation.z = -0.28;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), new THREE.MeshStandardMaterial({ color: 0xe6e0d2, roughness: 0.35 }));
    head.scale.set(0.85, 1.3, 0.85);
    head.position.set(0.42, 2.48, 0);
    const sockMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a14 });
    const eyes = [];
    for (const s of [-1, 1]) {
      const sock = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), sockMat);
      sock.scale.set(0.6, 1.3, 1);
      sock.position.set(0.58, 2.52, s * 0.075);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeMat);
      eye.position.set(0.61, 2.52, s * 0.075);
      g.add(sock, eye);
      eyes.push(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.12), sockMat);
    mouth.position.set(0.585, 2.3, 0);
    const limbGeo = new THREE.CylinderGeometry(0.035, 0.03, 1, 8);
    limbGeo.translate(0, 0, 0);
    const mk = () => {
      const m = new THREE.Mesh(limbGeo, skinMat);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const arms = [-1, 1].map((side) => ({ side, upper: mk(), lower: mk(), fingers: [mk(), mk(), mk(), mk()] }));
    const legs = [-1, 1].map((side) => ({ side, upper: mk(), lower: mk() }));
    g.add(torso, spine, head, mouth);
    g.traverse((m) => {
      if (m.isMesh && m.material !== eyeMat) m.castShadow = true;
    });
    this.world.add(g);
    const o = { g, head, torso, eyes, eyeMat, arms, legs };
    this.monsters[i] = o;
    return o;
  }

  poseMonster(o, m, t) {
    const hunting = m.st === 'chase' || m.st === 'grab';
    const dormant = m.st === 'dormant';
    const ph = m.walk || 0;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    o.g.scale.set(1, dormant ? 0.45 : 1, 1);
    o.eyeMat.color.setHex(hunting ? 0xff2010 : 0xffe8c8);
    o.eyes.forEach((e) => {
      e.visible = !dormant;
    });
    const jit = hunting ? (Math.random() - 0.5) * 0.1 : Math.sin(t * 1.3 + m.x) * 0.04;
    o.head.rotation.z = jit;
    o.head.rotation.x = hunting ? Math.sin(t * 23) * 0.15 : Math.sin(t * 0.7) * 0.1;
    for (const a of o.arms) {
      const sw = Math.sin(ph + (a.side > 0 ? 0 : Math.PI)) * 0.35;
      const reach = hunting ? 1 : 0;
      const sh = V(0.15, 2.1, a.side * 0.32);
      const el = V(0.35 + sw * 0.3 + reach * 0.35, 1.55 + reach * 0.45, a.side * (0.48 - reach * 0.08));
      const hd = V(0.55 + sw * 0.5 + reach * 0.75, 0.75 + reach * 0.85 + Math.abs(sw) * 0.1, a.side * (0.4 - reach * 0.1));
      setSeg(a.upper, sh, el);
      setSeg(a.lower, el, hd);
      const dir = new THREE.Vector3().subVectors(hd, el).normalize();
      a.fingers.forEach((f, k) => {
        const spread = (k - 1.5) * 0.12;
        const tip = hd.clone().addScaledVector(dir, 0.3).add(V(0, -0.05 + Math.abs(spread) * 0.2, spread));
        f.scale.set(0.45, 1, 0.45);
        setSeg(f, hd, tip);
        f.scale.x = f.scale.z = 0.4;
      });
    }
    for (const l of o.legs) {
      const sw = Math.sin(ph + (l.side > 0 ? Math.PI : 0)) * 0.3;
      const hip = V(-0.05, 1.15, l.side * 0.14);
      const knee = V(0.15 + sw * 0.4, 0.62, l.side * 0.2);
      const foot = V(-0.05 + sw * 0.6, 0.02, l.side * 0.22);
      setSeg(l.upper, hip, knee);
      setSeg(l.lower, knee, foot);
    }
  }

  // ------------------------------------------------------------ frame
  frame(S, V, dt) {
    const map = this.map;
    const t = S.t;
    const cam = this.camera;
    // camera
    let eye = 1.6;
    if (V.down) eye = 0.32;
    else if (V.cr) eye = 1.05;
    let cx = V.x;
    let cz = V.y;
    let yaw = V.yaw;
    if (V.hide) {
      const h = V.hide;
      const [dx, dy] = DIRS[h.dir];
      cx = h.x + 0.5 + dx * 0.62;
      cz = h.y + 0.5 + dy * 0.62;
      eye = 1.55;
    }
    const bob = V.moving && !V.hide ? Math.sin(V.walk * 0.7) * (V.sprint ? 0.06 : 0.03) : 0;
    const sh = V.shake ? V.shake * 0.004 : 0;
    cam.position.set(cx + (Math.random() - 0.5) * sh, eye + bob + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
    cam.rotation.y = -yaw - Math.PI / 2;
    cam.rotation.x = V.pitch || 0;
    cam.rotation.z = V.down ? 0.35 : Math.sin(V.walk * 0.35) * (V.moving ? 0.006 : 0);
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

    // flashlight
    const fl = this.flash;
    if (V.fl && !V.hide) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      fl.position.copy(cam.position).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.22, 0));
      fl.target.position.copy(cam.position).addScaledVector(fwd, 6);
      fl.intensity = 9 * (V.flick ?? 1);
    } else fl.intensity = 0;
    this.near.position.copy(cam.position);
    this.near.intensity = V.hide ? 0.12 : V.fl ? 0.35 : 0.55;

    // ambience: emergency red once the power is back
    if (S.power) {
      const pulse = Math.max(0, Math.sin(t * 3.2));
      this.ambient.color.setHex(0xff3020);
      this.ambient.intensity = 0.25 + 0.55 * pulse;
      this.scene.fog.color.setRGB(0.05 * pulse, 0, 0);
    } else {
      this.ambient.color.setHex(0x8a93b8);
      // inside a locker your eyes adjust: peek through the slats
      this.ambient.intensity = V.hide ? 0.45 : 0.07;
      this.scene.fog.color.setHex(0x010102);
    }
    this.scene.background.copy(this.scene.fog.color);

    // moonlight from the closest windows
    const near = this.moonSpots
      .map((l) => ({ l, d: (l.x - V.x) ** 2 + (l.y - V.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.moons.length);
    this.moons.forEach((p, i) => {
      const n = near[i];
      if (n && n.d < 200) {
        p.position.set(n.l.x + Math.cos(n.l.a) * 0.6, 1.8, n.l.y + Math.sin(n.l.a) * 0.6);
        p.intensity = 0.75;
      } else p.intensity = 0;
    });

    // doors
    map.doors.forEach((d, i) => {
      const pv = this.doors[i];
      const target = d.open ? -Math.PI / 2 : 0;
      pv.userData.ang += (target - pv.userData.ang) * Math.min(1, dt * 7);
      pv.rotation.y = pv.userData.base + pv.userData.ang;
    });
    for (const pv of this.exitDoors) {
      const target = map.exitOpen ? pv.userData.side * 1.4 : 0;
      pv.rotation.y += (target - pv.rotation.y) * Math.min(1, dt * 3);
    }
    this.chains.visible = !map.exitOpen;

    // fuse box
    this.fuseSlots.forEach((s, i) => s.material.color.setHex(i < S.fusesIn ? 0xffb030 : 0x151618));
    if (this.fuseLed) {
      const on = S.power || Math.sin(t * 4) > 0;
      this.fuseLed.material.color.setHex(S.power ? 0x40ff60 : on ? 0xff2010 : 0x300000);
      this.fuseLight.color.setHex(S.power ? 0x40ff60 : 0xff2a1a);
      this.fuseLight.intensity = on ? 0.6 : 0;
    }

    // items
    const seen = new Set();
    for (const it of S.items) {
      if (it.taken) continue;
      seen.add(it.id);
      const m = this.itemMesh(it);
      m.position.set(it.x, 0.18 + Math.sin(t * 2.5 + it.id) * 0.04, it.y);
      m.rotation.y = t * 0.8 + it.id;
    }
    for (const [id, m] of this.itemMeshes) {
      if (!seen.has(id)) {
        this.world.remove(m);
        this.itemMeshes.delete(id);
      }
    }
    // thrown alarm clocks
    let blink = null;
    const live = new Set();
    for (const c of S.clocks) {
      live.add(c.id);
      let m = this.clockMeshes.get(c.id);
      if (!m) {
        m = new THREE.Mesh(this.itemGeo.clock, new THREE.MeshStandardMaterial({ color: 0xb3241c, emissive: 0xff2010, emissiveIntensity: 0 }));
        this.world.add(m);
        this.clockMeshes.set(c.id, m);
      }
      const on = Math.sin(t * 14) > 0;
      m.material.emissiveIntensity = on ? 1.5 : 0.1;
      m.position.set(c.x + (Math.random() - 0.5) * 0.03, 0.12, c.y + (Math.random() - 0.5) * 0.03);
      if (on && !blink) blink = c;
    }
    for (const [id, m] of this.clockMeshes) {
      if (!live.has(id)) {
        this.world.remove(m);
        this.clockMeshes.delete(id);
      }
    }
    if (blink) {
      this.clockLight.position.set(blink.x, 0.5, blink.y);
      this.clockLight.intensity = 1.2;
    } else this.clockLight.intensity = 0;

    // players
    let mate = 0;
    const present = new Set();
    for (const p of S.players.values()) {
      const visible = (p.st === 'alive' || p.st === 'down') && p.h < 0 && p !== V.me;
      const o = visible || this.players.has(p.id) ? this.playerMesh(p) : null;
      if (!o) continue;
      present.add(p.id);
      o.g.visible = visible;
      if (!visible) continue;
      o.g.position.set(p.x, 0, p.y);
      o.g.rotation.set(0, -p.a, 0);
      if (p.st === 'down') {
        o.g.rotation.set(0, -p.a, Math.PI / 2 - 0.1);
        o.g.position.y = 0.25;
      }
      o.g.scale.set(1, p.cr && p.st !== 'down' ? 0.72 : 1, 1);
      o.legs.rotation.z = p.mv ? Math.sin(p.walk || 0) * 0.15 : 0;
      o.lens.material.color.setHex(p.fl ? 0xfff3c8 : 0x333333);
      if (p.fl && mate < this.mates.length && Math.hypot(p.x - V.x, p.y - V.y) < 26) {
        const s = this.mates[mate++];
        const hy = p.st === 'down' ? 0.3 : p.cr ? 0.95 : 1.25;
        s.position.set(p.x + Math.cos(p.a) * 0.4, hy, p.y + Math.sin(p.a) * 0.4);
        s.target.position.set(p.x + Math.cos(p.a) * 6, hy - 0.6, p.y + Math.sin(p.a) * 6);
        s.intensity = 7;
      }
    }
    for (let i = mate; i < this.mates.length; i++) this.mates[i].intensity = 0;
    for (const [id, o] of this.players) if (!present.has(id)) o.g.visible = false;

    // the Hall Monitor
    S.monsters.forEach((m, i) => {
      const o = this.monsterMesh(i);
      o.g.position.set(m.x, 0, m.y);
      o.g.rotation.y = -m.a;
      this.poseMonster(o, m, t);
    });

    this.r.render(this.scene, cam);
  }

  // Screen position of a world point (map coords + height), or null if behind the camera.
  project(x, y, h) {
    const v = new THREE.Vector3(x, h, y);
    const rel = v.clone().sub(this.camera.position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (rel.dot(fwd) < 0.1) return null;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // 2D layer over the 3D view: names, cries for help, chat, locker slats, grain.
  overlay(R2, S, V) {
    const g = R2.g;
    const W = R2.W;
    const H = R2.H;
    const t = S.t;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    for (const p of S.players.values()) {
      if (p === V.me || (p.st !== 'alive' && p.st !== 'down') || p.h >= 0) continue;
      const dist = Math.hypot(p.x - V.x, p.y - V.y);
      const vis = dist < 18 && los(this.map, V.x, V.y, p.x, p.y);
      const s = this.project(p.x, p.y, p.st === 'down' ? 0.8 : 2.0);
      if (p.st === 'down') {
        const pulse = 0.6 + 0.4 * Math.sin(t * 6);
        g.fillStyle = `rgba(255,60,50,${pulse})`;
        g.font = 'bold 14px "Courier New", monospace';
        if (s) g.fillText(`HELP! ${p.name} ${Math.ceil(p.downT || 0)}s · ${Math.round(dist)}m`, s.x, s.y);
        else {
          // behind you: pin to the bottom edge on the correct side
          const rel = Math.atan2(p.y - V.y, p.x - V.x) - V.yaw;
          const side = Math.sin(rel) > 0 ? 1 : -1;
          g.fillText(`${side > 0 ? '' : '◀ '}HELP! ${p.name} (behind you)${side > 0 ? ' ▶' : ''}`, W / 2 + side * W * 0.3, H - 70);
        }
      } else if (s && (vis || dist < 30)) {
        g.font = '13px "Courier New", monospace';
        g.fillStyle = vis ? 'rgba(235,230,220,0.85)' : 'rgba(235,230,220,0.25)';
        g.fillText(p.name, s.x, s.y);
      }
      const b = S.bubbles.get(p.id);
      if (b && b.until > t && s && (vis || dist < 12)) R2.bubble(g, b.text, s.x, s.y - 22);
    }
    const mb = V.me && S.bubbles.get(V.me.id);
    if (mb && mb.until > t) R2.bubble(g, mb.text, W / 2, H * 0.7);
    if (V.hide) g.drawImage(R2.slats, 0, 0);
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
    if (V.down) {
      g.fillStyle = `rgba(90,0,0,${0.25 + 0.1 * Math.sin(t * 3)})`;
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(R2.vignette, 0, 0);
    g.save();
    g.globalAlpha = 0.45 + V.chase * 0.4;
    g.translate(-Math.random() * 256, -Math.random() * 256);
    g.fillStyle = R2.grainPat;
    g.fillRect(0, 0, W + 256, H + 256);
    g.restore();
  }
}
