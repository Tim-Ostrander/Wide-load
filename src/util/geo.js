// Geometry helpers: low-poly models are assembled from primitives with baked
// vertex colors and merged into one BufferGeometry per model.
import { THREE } from '../lib.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export function colorize(geo, hex) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Merge geometries (indexed or not) into one non-indexed geometry with position/normal/color. */
export function mergeGeometries(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    else col.fill(1, o * 3, (o + n) * 3);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Collects colored primitives in a local frame and merges them. */
export class ModelBuilder {
  constructor() {
    this.parts = [];
  }
  add(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(...scale));
    g.applyMatrix4(_m);
    colorize(g, color);
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, pos, rot) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot);
  }
  cyl(rTop, rBot, h, seg, color, pos, rot) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, pos, rot);
  }
  sphere(r, color, pos, scale = [1, 1, 1], detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, [0, 0, 0], scale);
  }
  cone(r, h, seg, color, pos, rot) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot);
  }
  merge(other, pos = [0, 0, 0], rot = [0, 0, 0]) {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(1, 1, 1));
    for (const p of other.parts) this.parts.push(p.clone().applyMatrix4(_m));
    return this;
  }
  geometry() {
    return mergeGeometries(this.parts);
  }
  mesh(material) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

let _flatMat, _smoothMat;
export function flatMaterial() {
  if (!_flatMat) _flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
  return _flatMat;
}
export function smoothMaterial() {
  if (!_smoothMat) _smoothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  return _smoothMat;
}

/** Canvas texture with text, for signs and banners. */
export function textTexture(lines, { w = 512, h = 128, bg = '#f5c518', fg = '#111', font = '900 88px "Big Shoulders Display", Impact, sans-serif', border = 0, borderColor = '#111' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = borderColor;
    g.lineWidth = border;
    g.strokeRect(border / 2 + 4, border / 2 + 4, w - border - 8, h - border - 8);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  const arr = Array.isArray(lines) ? lines : [lines];
  const lh = h / arr.length;
  arr.forEach((t, i) => g.fillText(t, w / 2, lh * (i + 0.5) + 4, w - 24));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
