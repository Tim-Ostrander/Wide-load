// Terrain: a 1024 m square heightfield (2 m grid) shaped around the road,
// a creek, a railway embankment, a washout gully and the coast.
import { THREE, CANNON } from '../lib.js';
import { createNoise2D, fbm } from '../util/noise.js';
import { clamp, lerp, smoothstep } from '../util/rng.js';

export const SIZE = 1024;
export const ES = 2;
export const N = SIZE / ES + 1; // 513
export const HALF = SIZE / 2;

export function coastX(z) {
  return -385 + 25 * Math.sin(z * 0.011) + 12 * Math.sin(z * 0.031 + 1);
}

export const CREEK_PATH = [
  [-20, 520], [-34, 420], [-52, 300], [-70, 200], [-80, 104], [-96, 20], [-136, -80],
  [-196, -180], [-258, -256], [-330, -300], [-430, -320], [-540, -330],
];

function distToPolyline(path, x, z) {
  let best = Infinity, bt = 0, acc = 0, total = 0;
  const lens = [];
  for (let k = 0; k < path.length - 1; k++) {
    const l = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
    lens.push(l);
    total += l;
  }
  for (let k = 0; k < path.length - 1; k++) {
    const [ax, az] = path[k], [bx, bz] = path[k + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bt = (acc + t * lens[k]) / total;
    }
    acc += lens[k];
  }
  return [best, bt];
}

function detailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const n = createNoise2D(99);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable-ish: blend noise with wrapped copies
      const u = x / S, v = y / S;
      const f = (a, b) => n(a * 24, b * 24) * 0.6 + n(a * 70, b * 70) * 0.4;
      const val = f(u, v) * (1 - u) * (1 - v) + f(u - 1, v) * u * (1 - v) + f(u, v - 1) * (1 - u) * v + f(u - 1, v - 1) * u * v;
      const k = 222 + val * 34 + (Math.random() - 0.5) * 22;
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, k));
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Terrain {
  constructor(road, seed = 7) {
    this.road = road;
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 11);
    this.heights = new Float32Array(N * N);
    this.features = {};
    this._shapeRoad();
    this._bake();
  }

  /** Natural terrain before any carving. */
  baseHeight(x, z) {
    const d = x - coastX(z);
    let h;
    if (d < 0) {
      h = Math.max(-12, -0.6 + d * 0.09);
    } else {
      h = 0.4 + Math.min(d, 30) * 0.08 + Math.max(0, d - 30) * 0.045;
      h += 21 * smoothstep(70, 132, d);
      h += fbm(this.noise, x * 0.0055, z * 0.0055, 4) * 13 * smoothstep(40, 170, d);
      h += fbm(this.noise2, x * 0.02, z * 0.02, 2) * 1.6 * smoothstep(10, 60, d);
    }
    // frame the world with hills
    const ez = Math.abs(z) - 300;
    if (ez > 0) h += Math.pow(ez, 1.25) * 0.55 * smoothstep(-300, -200, x);
    const ex = x - 440;
    if (ex > 0) h += ex * 0.8;
    return h;
  }

  _shapeRoad() {
    const r = this.road;
    const raw = new Float32Array(r.count);
    for (let i = 0; i < r.count; i++) raw[i] = this.baseHeight(r.x[i], r.z[i]);
    const h = r.h;
    h.set(raw);
    for (let pass = 0; pass < 3; pass++) r._smoothArray(h, 22);
    // switchbacks: steady descent
    const a = r.places.hairpins, b = r.nearestIndex(-322, -62);
    const ha = h[a], hb = h[b];
    for (let i = a; i <= b; i++) h[i] = lerp(ha, hb, (i - a) / (b - a));
    // depot yard flat
    const dep = r.places.depot;
    for (let i = 0; i <= dep + 30; i++) h[i] = h[dep + 30];
    // bridge span flat
    const br = r.places.bridge;
    const bh = (h[br - 20] + h[br + 20]) / 2;
    for (let i = br - 20; i <= br + 20; i++) h[i] = bh;
    // coast: keep the road above the sea until the ramp
    const hb0 = r.nearestIndex(-398, -24);
    for (let i = 0; i < r.count; i++) h[i] = Math.max(h[i], 1.7);
    for (let i = hb0; i < r.count; i++) {
      const t = (i - hb0) / (r.count - 1 - hb0);
      h[i] = lerp(1.7, -2.6, smoothstep(0.35, 1, t));
    }
    // grade limit
    const g = 0.095 * r.ds;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < r.count; i++) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
      for (let i = r.count - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
    }
    r._smoothArray(h, 4);
    for (let i = br - 14; i <= br + 14; i++) h[i] = bh;

    // features
    const ov = r.places.overpass;
    this.features.overpass = { i: ov, clearance: 4.5, deck: 1.1, h: h[ov] };
    this.features.bridge = { i: br, h: bh, bed: bh - 5.4 };
    const wi = r.places.washout;
    this.features.washout = { i: wi, h: h[wi], depth: 3.4, x: r.x[wi], z: r.z[wi], tx: r.tx[wi], tz: r.tz[wi] };
    for (let i = wi - 8; i <= wi + 8; i++) h[i] = h[wi];
    const st = r.places.station;
    const stPos = r.point(st, -24);
    this.features.station = { i: st, x: stPos.x, z: stPos.z, h: h[st] };
    const dp = r.point(r.places.depot + 8, 30);
    this.features.depot = { i: r.places.depot, x: dp.x, z: dp.z, h: h[r.places.depot] };
    this.pads = [
      { x: this.features.depot.x, z: this.features.depot.z, r: 48, blend: 24, h: this.features.depot.h },
      { x: stPos.x, z: stPos.z, r: 16, blend: 14, h: h[st] },
    ];
    // town lots
    this.features.town = { i: r.places.town };
    // creek bed heights along path (monotone toward the sea)
    const cp = CREEK_PATH;
    const samples = 200;
    this.creekBed = new Float32Array(samples + 1);
    const pathPt = (t) => {
      let total = 0;
      const lens = [];
      for (let k = 0; k < cp.length - 1; k++) {
        const l = Math.hypot(cp[k + 1][0] - cp[k][0], cp[k + 1][1] - cp[k][1]);
        lens.push(l);
        total += l;
      }
      let d = t * total;
      for (let k = 0; k < lens.length; k++) {
        if (d <= lens[k] || k === lens.length - 1) {
          const u = clamp(d / lens[k], 0, 1);
          return [lerp(cp[k][0], cp[k + 1][0], u), lerp(cp[k][1], cp[k + 1][1], u)];
        }
        d -= lens[k];
      }
      return cp[cp.length - 1];
    };
    this.creekPt = pathPt;
    const [, tBridge] = distToPolyline(cp, r.x[br], r.z[br]);
    this.features.bridge.t = tBridge;
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const [x, z] = pathPt(t);
      this.creekBed[k] = this.baseHeight(x, z) - 4.2;
    }
    const kb = Math.round(tBridge * samples);
    this.creekBed[kb] = this.features.bridge.bed;
    for (let k = kb + 1; k <= samples; k++) this.creekBed[k] = Math.min(this.creekBed[k], this.creekBed[k - 1] - 0.02);
    for (let k = kb - 1; k >= 0; k--) this.creekBed[k] = Math.max(this.creekBed[k], this.creekBed[k + 1] + 0.02);
    for (let k = 0; k <= samples; k++) this.creekBed[k] = Math.max(this.creekBed[k], -3);
    // railway line through the overpass, perpendicular to the road
    const ox = r.x[ov], oz = r.z[ov];
    this.features.overpass.x = ox;
    this.features.overpass.z = oz;
    this.features.overpass.dir = [r.tz[ov], -r.tx[ov]]; // along the railway (road's left)
    this.features.overpass.railH = h[ov] + this.features.overpass.clearance + this.features.overpass.deck;
  }

  creekBedAt(t) {
    const k = clamp(t, 0, 1) * (this.creekBed.length - 1);
    const k0 = Math.floor(k), k1 = Math.min(this.creekBed.length - 1, k0 + 1);
    return lerp(this.creekBed[k0], this.creekBed[k1], k - k0);
  }

  _bake() {
    const r = this.road;
    const H = this.heights;
    const q = {};
    const ov = this.features.overpass;
    const wo = this.features.washout;
    const [rdx, rdz] = ov.dir;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * ES;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * ES;
        let h = this.baseHeight(x, z);
        // flat pads (depot yard, gas station) - before the road so the road wins
        for (const p of this.pads) {
          const d = Math.hypot(x - p.x, z - p.z);
          const w = 1 - smoothstep(p.r, p.r + p.blend, d);
          if (w > 0) h = lerp(h, p.h, w);
        }
        // road corridor
        r.nearest(x, z, 34, q);
        let lat = 1e9, roadI = -1;
        if (q.i >= 0) {
          roadI = q.i;
          lat = Math.abs(q.lat);
          const hw = r.hw[q.i];
          const rh = r.h[q.i];
          const w = 1 - smoothstep(hw + 1.6, hw + 22, q.d);
          // fill below the road gets an embankment; cuts get a wider bank
          h = lerp(h, rh, w);
          if (q.d < hw + 1.6) h = rh;
        }
        // railway embankment
        {
          const dx = x - ov.x, dz = z - ov.z;
          const u = dx * rdx + dz * rdz;
          const v = Math.abs(dx * -rdz + dz * rdx);
          if (Math.abs(u) < 300 && v < 22 && !(roadI >= 0 && lat < 7.2 && q.d < 12)) {
            const w = (1 - smoothstep(4.5, 20, v)) * (1 - smoothstep(240, 300, Math.abs(u)));
            h = lerp(h, ov.railH - 0.3, w);
          }
        }
        // creek
        {
          const [d, t] = distToPolyline(CREEK_PATH, x, z);
          if (d < 40) {
            const bed = this.creekBedAt(t);
            const carve = bed + Math.max(0, d - 3.2) * 0.95;
            if (carve < h) h = lerp(h, carve, 1 - smoothstep(26, 40, d));
          }
        }
        // washout gully across the road (a straight channel, perpendicular to the road)
        {
          const dx = x - wo.x, dz = z - wo.z;
          const along = Math.abs(dx * wo.tx + dz * wo.tz);
          const wlat = Math.abs(dx * wo.tz - dz * wo.tx);
          if (along < 6 && wlat < 80) {
            const depthScale = 1 - smoothstep(50, 80, wlat);
            const prof = along < 2.2 ? 1 : 1 - smoothstep(2.2, 4.6, along);
            if (prof > 0 && depthScale > 0) h = Math.min(h, Math.min(h, wo.h) - (wo.depth + 0.3) * prof * depthScale);
          }
        }
        H[j * N + i] = h;
      }
    }
  }

  /** Height at grid index (clamped). */
  hIdx(i, j) {
    i = clamp(i, 0, N - 1);
    j = clamp(j, 0, N - 1);
    return this.heights[j * N + i];
  }

  /** Interpolated height matching the physics triangulation. */
  heightAt(x, z) {
    const fx = (x + HALF) / ES, fz = (z + HALF) / ES;
    const i = clamp(Math.floor(fx), 0, N - 2), j = clamp(Math.floor(fz), 0, N - 2);
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const a = this.hIdx(i, j), b = this.hIdx(i + 1, j), c = this.hIdx(i, j + 1), d = this.hIdx(i + 1, j + 1);
    // diagonal from (i,j) to (i+1,j+1)
    if (u > v) return a + (b - a) * u + (d - b) * v;
    return a + (d - c) * u + (c - a) * v;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  createBody(material) {
    const data = [];
    for (let xi = 0; xi < N; xi++) {
      const col = new Array(N);
      for (let yi = 0; yi < N; yi++) col[yi] = this.heights[(N - 1 - yi) * N + xi];
      data.push(col);
    }
    const shape = new CANNON.Heightfield(data, { elementSize: ES });
    const body = new CANNON.Body({ mass: 0, material });
    body.addShape(shape);
    body.position.set(-HALF, 0, HALF);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    return body;
  }

  createMeshes() {
    const group = new THREE.Group();
    const CH = 64;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, map: detailTexture() });
    const r = this.road;
    const q = {};
    const col = new THREE.Color();
    const cGrass = new THREE.Color(0x6f8a3a), cDry = new THREE.Color(0xa39a52), cDark = new THREE.Color(0x4d6a2c);
    const cDirt = new THREE.Color(0x8b7358), cRock = new THREE.Color(0x857d72), cSand = new THREE.Color(0xd9c79b);
    const cBed = new THREE.Color(0x8d8468), cDeep = new THREE.Color(0x5f6b62);
    const nrm = new THREE.Vector3();
    for (let cj = 0; cj < (N - 1) / CH; cj++) {
      for (let ci = 0; ci < (N - 1) / CH; ci++) {
        const V = CH + 1;
        const pos = new Float32Array(V * V * 3);
        const nor = new Float32Array(V * V * 3);
        const colors = new Float32Array(V * V * 3);
        const uvs = new Float32Array(V * V * 2);
        for (let b = 0; b < V; b++) {
          for (let a = 0; a < V; a++) {
            const i = ci * CH + a, j = cj * CH + b;
            const x = -HALF + i * ES, z = -HALF + j * ES;
            const h = this.heights[j * N + i];
            const k = (b * V + a) * 3;
            pos[k] = x;
            pos[k + 1] = h;
            pos[k + 2] = z;
            uvs[(b * V + a) * 2] = x / 7;
            uvs[(b * V + a) * 2 + 1] = z / 7;
            const hx = this.hIdx(i + 1, j) - this.hIdx(i - 1, j);
            const hz = this.hIdx(i, j + 1) - this.hIdx(i, j - 1);
            nrm.set(-hx, 2 * ES, -hz).normalize();
            nor[k] = nrm.x;
            nor[k + 1] = nrm.y;
            nor[k + 2] = nrm.z;
            // color
            const n1 = this.noise2(x * 0.013, z * 0.013);
            const n2 = this.noise(x * 0.05 + 40, z * 0.05);
            col.copy(cGrass).lerp(cDry, clamp(0.5 + n1 * 0.6, 0, 1) * 0.7);
            col.lerp(cDark, clamp(n2 * 0.5 + 0.1, 0, 0.45));
            const slope = 1 - nrm.y;
            if (slope > 0.18) col.lerp(cRock, smoothstep(0.18, 0.4, slope));
            const dc = x - coastX(z);
            if (h < 3.2 && dc < 45) col.lerp(cSand, smoothstep(3.2, 1.6, h));
            if (h < -0.4) col.copy(cSand).lerp(cDeep, smoothstep(-0.4, -9, h));
            r.nearest(x, z, 20, q);
            if (q.i >= 0) {
              const hw = r.hw[q.i];
              if (q.d < hw + 3.2) col.lerp(cDirt, 1 - smoothstep(hw + 1.2, hw + 3.2, q.d));
            }
            const [dcr] = distToPolyline(CREEK_PATH, x, z);
            if (dcr < 6) col.lerp(cBed, 1 - smoothstep(3, 6, dcr));
            colors[k] = col.r;
            colors[k + 1] = col.g;
            colors[k + 2] = col.b;
          }
        }
        const idx = [];
        for (let b = 0; b < CH; b++) {
          for (let a = 0; a < CH; a++) {
            const A = b * V + a, B = A + 1, C = A + V, D = C + 1;
            idx.push(C, D, A, B, A, D);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = true;
        group.add(m);
      }
    }
    return group;
  }

  /** Creek water surface as a ribbon along the creek path. */
  createCreekMesh(material) {
    const steps = 260;
    const pos = [], idx = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const [x, z] = this.creekPt(t);
      const [x2, z2] = this.creekPt(Math.min(1, t + 1 / steps));
      const [x0, z0] = this.creekPt(Math.max(0, t - 1 / steps));
      let dx = x2 - x0, dz = z2 - z0;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const y = Math.max(this.creekBedAt(t) + 0.75, 0.02);
      const w = 5.2;
      pos.push(x - dz * w, y, z + dx * w, x + dz * w, y, z - dx * w);
      if (k < steps) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}
