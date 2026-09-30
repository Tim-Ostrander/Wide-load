// Structures along the route (trestle, power lines, bridge, washout, gas
// station, town, harbor, depot), scenery (trees, rocks, signs) and their
// static colliders. Obstacle state changes are applied through setters so
// every peer renders the same thing.
import { THREE, CANNON } from '../lib.js';
import { ModelBuilder, flatMaterial, textTexture, colorize } from '../util/geo.js';
import { mulberry32, clamp, smoothstep, lerp } from '../util/rng.js';
import { G, staticBox } from '../physics.js';
import { CREEK_PATH, coastX } from './terrain.js';
import { PAINT } from '../rig/models.js';

const WOOD = 0x7a5536, WOOD_DARK = 0x5a3d26, STONE = 0x8d877c, CONCRETE = 0xa7a39a, ROOF = 0x6b3a2e;

/** Frame at road sample i: map (lat, y, along) to world. */
function frame(road, i) {
  const p = road.point(i);
  const tx = road.tx[i], tz = road.tz[i];
  return {
    i,
    p,
    yaw: road.heading(i),
    at(lat, y, along) {
      return new THREE.Vector3(p.x + tz * lat + tx * along, p.y + y, p.z - tx * lat + tz * along);
    },
  };
}

function sign(lines, { w = 2.4, h = 1.4, bg = '#f5c518', fg = '#141414', post = 2.2, font } = {}) {
  const g = new THREE.Group();
  const tex = textTexture(lines, { w: 512, h: Math.round((512 * h) / w), bg, fg, border: 12, font: font || `900 ${lines.length > 1 ? 64 : 84}px "Big Shoulders Display", Impact, sans-serif` });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [
    new THREE.MeshStandardMaterial({ color: 0x555555 }), new THREE.MeshStandardMaterial({ color: 0x555555 }),
    new THREE.MeshStandardMaterial({ color: 0x555555 }), new THREE.MeshStandardMaterial({ color: 0x555555 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x777777 }),
  ]);
  board.position.y = post + h / 2;
  board.castShadow = true;
  g.add(board);
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, post + h / 2, 0.1), new THREE.MeshStandardMaterial({ color: 0x8a8a8a }));
  p.position.y = (post + h / 2) / 2;
  g.add(p);
  return g;
}

export class Structures {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.scene = game.scene;
    this.pw = game.physics.world;
    this.mat = game.physics.mats.ground;
    this.road = world.road;
    this.terrain = world.terrain;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.rand = mulberry32(4242);
    this.spots = {}; // interaction anchors keyed by name
    this.props = []; // knockable props {body, mesh, kind, fine}
    this.blockers = []; // {x,z,r} areas where trees must not grow

    this._depot();
    this._tree();
    this._powerLines();
    this._overpass();
    this._station();
    this._bridge();
    this._washout();
    this._town();
    this._harbor();
    this._signs();
    this._scenery();
  }

  _add(obj) {
    this.group.add(obj);
    return obj;
  }

  _box(size, pos, yaw = 0) {
    return staticBox(this.pw, this.mat, size, [pos.x, pos.y, pos.z], yaw);
  }

  // ---------------------------------------------------------------- depot
  _depot() {
    const r = this.road;
    const f = frame(r, r.places.depot + 8);
    const mb = new ModelBuilder();
    // warehouse
    const wh = f.at(28, 0, 0);
    const whYaw = f.yaw;
    const whM = new ModelBuilder();
    whM.box(18, 9, 30, 0x9aa3a8, [0, 4.5, 0]);
    whM.box(18.6, 0.6, 30.6, 0x6d767b, [0, 9.2, 0]);
    whM.box(0.2, 6, 10, 0x4b5257, [-9.05, 3, 0]);
    for (let k = 0; k < 6; k++) whM.box(0.22, 0.12, 9.8, 0x3a4044, [-9.1, 0.5 + k, 0]);
    whM.box(0.2, 1.2, 14, PAINT.cab, [-9.1, 7.6, 0]);
    const whMesh = whM.mesh(flatMaterial());
    whMesh.position.copy(wh);
    whMesh.rotation.y = whYaw;
    this._add(whMesh);
    this._box([18, 9, 30], wh.clone().setY(wh.y + 4.5), whYaw);
    const title = textTexture(['TWO GUYS & A FLATBED', 'HEAVY HAUL'], { w: 1024, h: 256, bg: '#b8322a', fg: '#f3efe2', font: '900 96px "Big Shoulders Display", Impact, sans-serif' });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: title }));
    sm.position.copy(f.at(18.85, 7.6, 0));
    sm.rotation.y = whYaw - Math.PI / 2;
    this._add(sm);
    // office trailer + containers
    const off = f.at(18, 0, -26);
    mb.box(4, 3, 10, 0xe3dccb, [off.x, off.y + 1.6, off.z]);
    const c1 = f.at(-12, 0, 12), c2 = f.at(-12, 0, 24);
    const cm = new ModelBuilder();
    cm.box(2.5, 2.6, 12, 0x2f6f8f, [0, 1.3, 0]);
    for (let k = 0; k < 10; k++) cm.box(2.56, 2.4, 0.1, 0x27607c, [0, 1.3, -5.5 + k * 1.2]);
    for (const [c, col] of [[c1, 0x2f6f8f], [c2, 0x9a3b2d]]) {
      const m = cm.mesh(flatMaterial());
      m.position.copy(c);
      m.rotation.y = f.yaw;
      if (col !== 0x2f6f8f) m.material = flatMaterial();
      this._add(m);
      this._box([2.5, 2.6, 12], c.clone().setY(c.y + 1.3), f.yaw);
    }
    // fence posts along the yard
    for (let k = -8; k <= 8; k++) {
      const p = f.at(-16, 0, k * 4);
      mb.box(0.12, 1.8, 0.12, 0x8d8d8d, [p.x, this.terrain.heightAt(p.x, p.z) + 0.9, p.z]);
    }
    this._add(mb.mesh(flatMaterial()));
    this.blockers.push({ x: f.p.x, z: f.p.z, r: 70 });
    const flag = sign(['JOB #0412', 'DOLORES → GULL HARBOR'], { w: 3.6, h: 1.4, bg: '#17613f', fg: '#f3efe2', post: 1.6 });
    flag.position.copy(f.at(-7.5, 0, 14));
    flag.rotation.y = f.yaw + Math.PI / 2 + 0.3;
    this._add(flag);
    this.spots.depot = f;
  }

  // ---------------------------------------------------------------- fallen tree
  _tree() {
    const f = frame(this.road, this.road.places.tree);
    this.spots.tree = f;
    const g = new THREE.Group();
    const mk = (len, x) => {
      const mb = new ModelBuilder();
      mb.cyl(0.5, 0.42, len, 9, 0x5b3f29, [0, 0, 0], [0, 0, Math.PI / 2]);
      for (let k = 0; k < Math.floor(len / 2.5); k++) {
        const a = k * 2.1;
        mb.cone(0.9, 2.2, 5, 0x355c2b, [(-len / 2) + 1.2 + k * 2.4, Math.sin(a) * 0.5, Math.cos(a) * 0.6], [Math.cos(a) * 1.2, 0, Math.PI / 2]);
      }
      const m = mb.mesh(flatMaterial());
      m.position.x = x;
      return m;
    };
    const left = mk(6, 5.5), mid = mk(7, -0.9), right = mk(4, -6.5);
    g.add(left, mid, right);
    // root ball and stump
    const rb = new ModelBuilder();
    rb.sphere(1.6, 0x5a4632, [0, 0, 0], [0.5, 1.2, 1.2], 1);
    const root = rb.mesh(flatMaterial());
    root.position.x = 9;
    g.add(root);
    const pos = f.at(0, 0.45, 0);
    g.position.copy(pos);
    g.rotation.y = f.yaw + 0.12;
    this._add(g);
    this.treeParts = { g, left, mid, right };
    this.treeBody = this._box([18, 1.0, 1.0], pos, f.yaw + 0.12);
    this.treeBody.userData = { kind: 'log' };
    this.spots.log = pos.clone().setY(pos.y + 0.3);
    this.treeCut = false;
  }

  setTreeCut(cut) {
    if (cut === this.treeCut) return;
    this.treeCut = cut;
    const t = this.treeParts;
    t.mid.visible = !cut;
    t.left.position.x = cut ? 8.5 : 5.5;
    t.right.position.x = cut ? -9.5 : -6.5;
    if (cut) this.pw.removeBody(this.treeBody);
    else this.pw.addBody(this.treeBody);
  }

  // ---------------------------------------------------------------- power lines
  _powerLines() {
    const r = this.road;
    const f = frame(r, r.places.lines);
    this.spots.lines = f;
    const mb = new ModelBuilder();
    const poleAt = (lat, along, height) => {
      const p = f.at(lat, 0, along);
      const gy = this.terrain.heightAt(p.x, p.z);
      mb.cyl(0.16, 0.2, height, 7, WOOD_DARK, [p.x, gy + height / 2, p.z]);
      const arm = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
      mb.box(0.14, 0.14, 2.4, WOOD_DARK, [p.x, gy + height - 0.4, p.z], [0, f.yaw, 0]);
      for (const o of [-1, 0, 1]) mb.box(0.08, 0.22, 0.08, 0xdddddd, [p.x + Math.sin(f.yaw) * o, gy + height - 0.2, p.z + Math.cos(f.yaw) * o]);
      void arm;
      return new THREE.Vector3(p.x, gy + height - 0.12, p.z);
    };
    // the two poles by the road (short, old)
    const pl = poleAt(7.2, 0, 5.3), pr = poleAt(-7.2, 0, 5.3);
    // continuing line both ways (tall)
    const tall = [];
    for (let k = 1; k <= 6; k++) {
      tall.push([poleAt(7.2 + k * 34, 0, 9), poleAt(-7.2 - k * 34, 0, 9)]);
    }
    this._add(mb.mesh(flatMaterial()));
    // wires: 3 conductors, offsets along the road
    this.wireGroup = new THREE.Group();
    this._add(this.wireGroup);
    this.wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    const catenary = (a, b, sag, n = 16) => {
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const p = a.clone().lerp(b, t);
        p.y -= sag * 4 * t * (1 - t);
        pts.push(p);
      }
      return pts;
    };
    const fwd = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    this.wireEnds = { pl, pr, fwd };
    // static far wires
    const far = new THREE.Group();
    for (const off of [-1, 0, 1]) {
      const o = fwd.clone().multiplyScalar(off);
      let prevL = pl, prevR = pr;
      for (const [tl, tr] of tall) {
        for (const [a, b] of [[prevL, tl], [prevR, tr]]) {
          const c = new THREE.CatmullRomCurve3(catenary(a.clone().add(o), b.clone().add(o), 1.4));
          far.add(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.025, 4), this.wireMat));
        }
        prevL = tl;
        prevR = tr;
      }
    }
    this._add(far);
    this.catenary = catenary;
    this.linesState = null;
    this.setLines({ lifted: 0, hooked: false, broken: false });
    this.spots.poleL = f.at(7.2, 0, 0);
    this.spots.poleR = f.at(-7.2, 0, 0);
    this.blockers.push({ x: f.p.x, z: f.p.z, r: 12 });
  }

  /** Lowest wire height (world y) above road lateral position lat. */
  wireHeightAt(lat) {
    const { pl, pr } = this.wireEnds;
    const t = clamp((7.2 - lat) / 14.4, 0, 1);
    const y = lerp(pl.y, pr.y, t) - this.wireSag * 4 * t * (1 - t);
    return y;
  }

  setLines(st) {
    const key = `${st.lifted.toFixed(2)}|${st.hooked}|${st.broken}`;
    if (key === this._linesKey) return;
    this._linesKey = key;
    this.linesState = st;
    const { pl, pr, fwd } = this.wireEnds;
    // lowest wire sits 4.0 m above the road; lifting/hooking raises it
    const roadY = this.spots.lines.p.y;
    const baseSag = pl.y - (roadY + 4.0);
    const lift = st.hooked ? 1 : st.lifted;
    this.wireSag = lerp(baseSag, baseSag - 3.4, lift);
    for (const c of [...this.wireGroup.children]) {
      this.wireGroup.remove(c);
      c.geometry.dispose();
    }
    if (st.broken) {
      for (const off of [-1, 0, 1]) {
        const o = fwd.clone().multiplyScalar(off);
        for (const end of [pl, pr]) {
          const a = end.clone().add(o);
          const b = a.clone();
          b.y = this.terrain.heightAt(a.x, a.z) + 0.1;
          const mid = end.clone().lerp(this.spots.lines.p, 0.3).add(o);
          mid.y = b.y + 0.4;
          const c = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y - 1.5), mid]);
          this.wireGroup.add(new THREE.Mesh(new THREE.TubeGeometry(c, 10, 0.03, 4), this.wireMat));
        }
      }
      this.wireSag = -50;
      return;
    }
    for (const off of [-1, 0, 1]) {
      const o = fwd.clone().multiplyScalar(off);
      const sag = this.wireSag - (off === 0 ? 0 : -0.15);
      const c = new THREE.CatmullRomCurve3(this.catenary(pl.clone().add(o), pr.clone().add(o), sag, 20));
      this.wireGroup.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.03, 4), this.wireMat));
    }
  }

  // ---------------------------------------------------------------- railway trestle
  _overpass() {
    const t = this.terrain.features.overpass;
    const r = this.road;
    const f = frame(r, t.i);
    this.spots.overpass = f;
    const deckBottom = t.h + t.clearance;
    const mb = new ModelBuilder();
    const [dx, dz] = t.dir;
    const railYaw = Math.atan2(dx, dz);
    const along = (u, y) => new THREE.Vector3(t.x + dx * u, y, t.z + dz * u);
    // deck over the road
    const c = along(0, deckBottom + t.deck / 2);
    mb.box(5.2, t.deck, 22, 0x6e5a4a, [c.x, c.y, c.z], [0, railYaw, 0]);
    mb.box(5.4, 0.3, 22.4, 0x4a3b30, [c.x, deckBottom + 0.12, c.z], [0, railYaw, 0]);
    // stripes on the deck faces
    for (let k = -4; k <= 4; k++) {
      const p = along(k * 2.2, deckBottom + 0.3);
      const side = new THREE.Vector3(dz, 0, -dx).multiplyScalar(2.72);
      for (const s of [1, -1]) mb.box(0.05, 0.5, 1.1, k % 2 ? PAINT.yellow : PAINT.black, [p.x + side.x * s, p.y, p.z + side.z * s], [0, railYaw, 0]);
    }
    // stone abutments either side of the road
    for (const u of [-8.2, 8.2]) {
      const a = along(u, 0);
      const gy = t.h;
      mb.box(5.6, deckBottom - gy + 0.4, 2.6, STONE, [a.x, gy + (deckBottom - gy) / 2 - 0.2, a.z], [0, railYaw, 0]);
      this._box([5.6, deckBottom - gy + 2, 2.6], new THREE.Vector3(a.x, gy + (deckBottom - gy) / 2, a.z), railYaw);
    }
    // track along the embankment
    const railTop = t.railH;
    for (let u = -290; u <= 290; u += 1.2) {
      const p = along(u, railTop + 0.05);
      mb.box(2.4, 0.12, 0.25, WOOD_DARK, [p.x, Math.abs(u) < 11 ? deckBottom + t.deck + 0.06 : p.y, p.z], [0, railYaw + Math.PI / 2, 0]);
    }
    for (const s of [-0.72, 0.72]) {
      for (let u = -290; u < 290; u += 20) {
        const p = along(u + 10, 0);
        const side = new THREE.Vector3(dz, 0, -dx).multiplyScalar(s);
        const y = Math.abs(u + 10) < 11 ? deckBottom + t.deck + 0.2 : railTop + 0.2;
        mb.box(0.1, 0.14, 20, 0x8b8f93, [p.x + side.x, y, p.z + side.z], [0, railYaw, 0]);
      }
    }
    this._add(mb.mesh(flatMaterial()));
    // the deck is what an un-lowered tank hits
    const deckBody = this._box([5.2, t.deck + 0.2, 22], c, railYaw);
    deckBody.userData = { kind: 'overpass' };
    this.overpassBottom = deckBottom;
    // clearance signs on both faces
    for (const s of [1, -1]) {
      const sg = textTexture(["LOW CLEARANCE 14'-5\""], { w: 1024, h: 160, bg: '#f5c518', fg: '#141414', border: 10, font: '900 110px "Big Shoulders Display", Impact, sans-serif' });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.86), new THREE.MeshStandardMaterial({ map: sg }));
      const p = f.at(0, t.clearance + 0.62, s * 2.66);
      m.position.copy(p);
      m.rotation.y = f.yaw + (s > 0 ? Math.PI : 0);
      this._add(m);
    }
    // retaining walls where the road cuts through the embankment
    const wm = new ModelBuilder();
    const wallH = t.railH - t.h + 0.2;
    for (const lat of [7.9, -7.9]) {
      for (let a = -22; a <= 22; a += 4) {
        const p = f.at(lat, 0, a);
        const top = Math.max(this.terrain.heightAt(p.x, p.z), t.h + 0.6);
        const hgt = Math.min(wallH, top - t.h + 0.3);
        if (hgt < 0.4) continue;
        wm.box(1.2, hgt, 4.05, 0x958d80, [p.x, t.h + hgt / 2 - 0.1, p.z], [0, f.yaw, 0]);
      }
    }
    this._add(wm.mesh(flatMaterial()));
    this.blockers.push({ x: t.x, z: t.z, r: 14 });
    this.railLine = { x: t.x, z: t.z, dx, dz };
  }

  // ---------------------------------------------------------------- gas station + water tower
  _station() {
    const st = this.terrain.features.station;
    const f = frame(this.road, st.i);
    this.spots.station = f;
    const mb = new ModelBuilder();
    const base = f.at(-24, 0, 0);
    const y0 = st.h;
    // shop
    const shop = f.at(-30, 0, -8);
    mb.box(8, 3.4, 7, 0xe7e1d0, [shop.x, y0 + 1.7, shop.z], [0, f.yaw, 0]);
    mb.box(8.6, 0.3, 7.6, 0x2c5c46, [shop.x, y0 + 3.5, shop.z], [0, f.yaw, 0]);
    this._box([8, 3.4, 7], new THREE.Vector3(shop.x, y0 + 1.7, shop.z), f.yaw);
    // canopy + pump island
    const pump = f.at(-11.5, 0, 0);
    mb.box(0.3, 4.8, 0.3, 0xdedede, [pump.x, y0 + 2.4, pump.z]);
    const canopy = f.at(-11.5, 0, 0);
    mb.box(9, 0.5, 10, 0x2c5c46, [canopy.x, y0 + 5.2, canopy.z], [0, f.yaw, 0]);
    mb.box(9.1, 0.2, 10.1, PAINT.yellow, [canopy.x, y0 + 4.9, canopy.z], [0, f.yaw, 0]);
    mb.box(1.6, 0.25, 3, CONCRETE, [pump.x, y0 + 0.12, pump.z], [0, f.yaw, 0]);
    mb.box(0.7, 1.6, 0.9, 0xc63b2a, [pump.x, y0 + 1.0, pump.z], [0, f.yaw, 0]);
    mb.box(0.72, 0.4, 0.92, 0xf3efe2, [pump.x, y0 + 1.6, pump.z], [0, f.yaw, 0]);
    this._box([1.6, 2, 1.4], new THREE.Vector3(pump.x, y0 + 1, pump.z), f.yaw);
    this.spots.pump = pump.clone().setY(y0 + 1.2);
    // water tower: spout reaches over the road edge
    const tw = f.at(-12, 0, 26);
    for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) mb.box(0.3, 12, 0.3, WOOD_DARK, [tw.x + ox, y0 + 6, tw.z + oz]);
    mb.cyl(3.2, 3.2, 4.2, 12, WOOD, [tw.x, y0 + 14.1, tw.z]);
    mb.cone(3.5, 1.8, 12, ROOF, [tw.x, y0 + 17.1, tw.z]);
    const spout = f.at(-5.6, 0, 26);
    const sp0 = tw.clone().setY(y0 + 12.4);
    const spDir = spout.clone().sub(tw);
    const spLen = spDir.length();
    const mid = tw.clone().add(spout).multiplyScalar(0.5).setY(y0 + 12.1);
    mb.box(0.4, 0.4, spLen, 0x4b5257, [mid.x, mid.y, mid.z], [0, Math.atan2(spDir.x, spDir.z), 0]);
    mb.cyl(0.25, 0.25, 1.6, 8, 0x4b5257, [spout.x, y0 + 11.2, spout.z]);
    void sp0;
    // valve lever at the tower foot
    const valve = f.at(-9.2, 0, 26);
    mb.box(0.25, 1.2, 0.25, 0xc63b2a, [valve.x, y0 + 0.6, valve.z]);
    this.spots.valve = valve.clone().setY(y0 + 1.0);
    this.spots.spout = spout.clone().setY(y0 + 11);
    this._add(mb.mesh(flatMaterial()));
    const fuelSign = sign(['FUEL · WATER · TIRES'], { w: 4.2, h: 1.0, bg: '#17613f', fg: '#f3efe2', post: 3.2 });
    fuelSign.position.copy(f.at(-8, 0, -12));
    fuelSign.rotation.y = f.yaw + Math.PI / 2;
    this._add(fuelSign);
    this.blockers.push({ x: base.x, z: base.z, r: 34 });
  }

  // ---------------------------------------------------------------- weak bridge
  _bridge() {
    const b = this.terrain.features.bridge;
    const r = this.road;
    const f = frame(r, b.i);
    this.spots.bridge = f;
    this.bridgeY = b.h;
    const segLen = 7;
    this.bridgeSegs = [];
    for (let k = 0; k < 4; k++) {
      const along = -14 + segLen * (k + 0.5);
      const mb = new ModelBuilder();
      mb.box(9.4, 0.4, segLen - 0.05, WOOD, [0, -0.2, 0]);
      for (let p = 0; p < 7; p++) mb.box(9.4, 0.06, 0.12, WOOD_DARK, [0, 0.01, -segLen / 2 + 0.5 + p]);
      mb.box(0.25, 1.0, segLen, WOOD_DARK, [4.6, 0.5, 0]);
      mb.box(0.25, 1.0, segLen, WOOD_DARK, [-4.6, 0.5, 0]);
      mb.box(0.6, 0.5, segLen, 0x4f3a28, [2.2, -0.65, 0]);
      mb.box(0.6, 0.5, segLen, 0x4f3a28, [-2.2, -0.65, 0]);
      const mesh = mb.mesh(flatMaterial());
      const pos = f.at(0, 0.05, along);
      mesh.position.copy(pos);
      mesh.rotation.y = f.yaw;
      this._add(mesh);
      const body = new CANNON.Body({ mass: 0, material: this.mat, collisionFilterGroup: G.GROUND });
      body.addShape(new CANNON.Box(new CANNON.Vec3(4.7, 0.2, segLen / 2)), new CANNON.Vec3(0, -0.2, 0));
      body.position.set(pos.x, pos.y, pos.z);
      body.quaternion.setFromEuler(0, f.yaw, 0);
      body.userData = { kind: 'bridge' };
      this.pw.addBody(body);
      this.bridgeSegs.push({ mesh, body, home: pos.clone(), yaw: f.yaw });
    }
    // stone abutments + old rotten piers
    const mb = new ModelBuilder();
    for (const along of [-15, 15]) {
      const p = f.at(0, 0, along);
      mb.box(10, 6, 2.4, STONE, [p.x, b.h - 3.1, p.z], [0, f.yaw, 0]);
    }
    for (const along of [-7, 7]) {
      const p = f.at(3.8, 0, along);
      mb.box(0.4, 3.2, 0.4, 0x3d2f22, [p.x, b.bed + 1.6, p.z], [0.25, f.yaw, 0.1]);
    }
    this._add(mb.mesh(flatMaterial()));
    // ghost support slots: under the deck, both sides of each joint
    this.supportSlots = [];
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.35, depthWrite: false });
    const postMat = flatMaterial();
    let n = 0;
    for (const along of [-7, 7]) {
      for (const lat of [2.2, -2.2]) {
        const p = f.at(lat, 0, along);
        const h = b.h - 0.9 - b.bed;
        const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), ghostMat);
        ghost.position.set(p.x, b.bed + h / 2, p.z);
        this._add(ghost);
        const pm = new ModelBuilder();
        pm.box(0.42, h, 0.42, WOOD, [0, 0, 0]);
        pm.box(0.9, 0.2, 0.9, WOOD_DARK, [0, h / 2 - 0.1, 0]);
        const post = pm.mesh(postMat);
        post.position.copy(ghost.position);
        post.visible = false;
        this._add(post);
        this.supportSlots.push({ n: n++, ghost, post, pos: new THREE.Vector3(p.x, b.bed + 1.2, p.z) });
      }
    }
    this.bridgeState = { supports: 0, collapsed: false };
    this.blockers.push({ x: f.p.x, z: f.p.z, r: 20 });
  }

  setBridge(supports, collapsed, owner) {
    for (const s of this.supportSlots) {
      const on = !!(supports & (1 << s.n));
      s.post.visible = on;
      s.ghost.visible = !on && !collapsed;
    }
    if (collapsed !== this.bridgeState.collapsed) {
      for (const seg of this.bridgeSegs) {
        const bd = seg.body;
        if (collapsed) {
          bd.type = CANNON.Body.DYNAMIC;
          bd.mass = 2500;
          bd.collisionFilterGroup = G.DEBRIS;
          bd.collisionFilterMask = G.GROUND | G.RIG | G.DEBRIS | G.PLAYER;
          bd.updateMassProperties();
          bd.velocity.set(0, -1, 0);
          bd.angularVelocity.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8);
          bd.wakeUp();
        } else {
          bd.type = CANNON.Body.STATIC;
          bd.mass = 0;
          bd.collisionFilterGroup = G.GROUND;
          bd.collisionFilterMask = -1;
          bd.updateMassProperties();
          bd.velocity.setZero();
          bd.angularVelocity.setZero();
          bd.position.set(seg.home.x, seg.home.y, seg.home.z);
          bd.quaternion.setFromEuler(0, seg.yaw, 0);
        }
      }
    }
    this.bridgeState = { supports, collapsed };
    void owner;
  }

  // ---------------------------------------------------------------- washout
  _washout() {
    const w = this.terrain.features.washout;
    const r = this.road;
    const f = frame(r, w.i);
    this.spots.washout = f;
    // boulders along both lips of the gully hide the stair-steps
    const mb = new ModelBuilder();
    const rnd = mulberry32(77);
    for (const side of [-1, 1]) {
      for (let lat = -78; lat <= 78; lat += 2.2) {
        if (Math.abs(lat) < 5.4) continue;
        const along = side * (3.4 + rnd() * 1.2);
        const p = f.at(lat, 0, along);
        const y = this.terrain.heightAt(p.x, p.z);
        const s = 0.9 + rnd() * 1.1;
        mb.sphere(1, 0x7d7468, [p.x, y - 0.2, p.z], [s * 1.3, s * 0.8, s], 0);
      }
    }
    // rubble at the bottom
    for (let k = 0; k < 40; k++) {
      const p = f.at((rnd() - 0.5) * 120, 0, (rnd() - 0.5) * 3.5);
      const y = this.terrain.heightAt(p.x, p.z);
      mb.sphere(0.4 + rnd() * 0.5, 0x6d655b, [p.x, y, p.z], [1.2, 0.7, 1], 0);
    }
    // broken asphalt slabs
    for (const side of [-1, 1]) {
      const p = f.at(side * 1.5, -1.8, side * 3.2);
      mb.box(3.5, 0.2, 2.2, 0x55524c, [p.x, p.y, p.z], [side * 0.5, f.yaw, 0.2]);
    }
    const m = mb.mesh(flatMaterial());
    this._add(m);
    // plank slots across the gap
    this.plankSlots = [];
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.3, depthWrite: false });
    const lats = [0.45, -0.45, 1.35, -1.35, 2.25, -2.25];
    lats.forEach((lat, n) => {
      const p = f.at(lat, -0.07, 0);
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.14, 10.2), ghostMat);
      ghost.position.copy(p);
      ghost.rotation.y = f.yaw;
      this._add(ghost);
      const pm = new ModelBuilder();
      pm.box(0.86, 0.14, 10.2, WOOD, [0, 0, 0]);
      pm.box(0.88, 0.02, 0.1, WOOD_DARK, [0, 0.07, -4]);
      pm.box(0.88, 0.02, 0.1, WOOD_DARK, [0, 0.07, 4]);
      const plank = pm.mesh(flatMaterial());
      plank.position.copy(p);
      plank.rotation.y = f.yaw;
      plank.visible = false;
      this._add(plank);
      const body = new CANNON.Body({ mass: 0, material: this.mat, collisionFilterGroup: G.GROUND });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.43, 0.07, 5.1)));
      body.position.set(p.x, p.y, p.z);
      body.quaternion.setFromEuler(0, f.yaw, 0);
      this.plankSlots.push({ n, ghost, plank, body, pos: p.clone(), added: false });
    });
    this.blockers.push({ x: f.p.x, z: f.p.z, r: 16 });
  }

  setWashout(mask) {
    for (const s of this.plankSlots) {
      const on = !!(mask & (1 << s.n));
      s.plank.visible = on;
      s.ghost.visible = !on;
      if (on && !s.added) {
        this.pw.addBody(s.body);
        s.added = true;
      } else if (!on && s.added) {
        this.pw.removeBody(s.body);
        s.added = false;
      }
    }
  }

  // ---------------------------------------------------------------- town
  _town() {
    const r = this.road;
    const i0 = r.nearestIndex(-330, -70), i1 = r.nearestIndex(-392, -28);
    const rnd = mulberry32(501);
    const houseColors = [0xd9c8a0, 0x9fb7c9, 0xe3a78a, 0xc8d6b0, 0xf0e2c2, 0xb49ac0];
    const mb = new ModelBuilder();
    let side = 1;
    for (let i = i0 + 4, k = 0; i < i1 - 4; i += 11, k++) {
      side = -side;
      const f = frame(r, i);
      const lat = side * (13 + rnd() * 3);
      const p = f.at(lat, 0, 0);
      const y = this.terrain.heightAt(p.x, p.z);
      const hm = new ModelBuilder();
      const col = houseColors[k % houseColors.length];
      hm.box(7, 3.4, 6, col, [0, 1.7, 0]);
      hm.box(7.6, 0.2, 6.6, 0xf3efe2, [0, 3.45, 0]);
      hm.add(new THREE.ConeGeometry(5.2, 2.4, 4), ROOF, [0, 4.6, 0], [0, Math.PI / 4, 0], [1, 1, 0.85]);
      hm.box(1.2, 2.1, 0.1, 0x5a3d26, [0, 1.05, side > 0 ? -3.02 : 3.02]);
      hm.box(1.3, 1.0, 0.1, 0x9cc3d5, [2, 2, side > 0 ? -3.02 : 3.02]);
      hm.box(1.3, 1.0, 0.1, 0x9cc3d5, [-2, 2, side > 0 ? -3.02 : 3.02]);
      hm.box(7, 0.6, 6, 0x8f8a80, [0, -0.3, 0]);
      const house = hm.mesh(flatMaterial());
      house.position.set(p.x, y, p.z);
      house.rotation.y = f.yaw + Math.PI / 2;
      this._add(house);
      this._box([6, 4, 7], new THREE.Vector3(p.x, y + 2, p.z), f.yaw);
      // picket fence
      for (let a = -3; a <= 3; a++) {
        const fp = f.at(side * 7.2, 0, a * 1.1);
        mb.box(0.08, 0.9, 0.08, 0xf3efe2, [fp.x, this.terrain.heightAt(fp.x, fp.z) + 0.45, fp.z]);
      }
      // mailbox (knockable)
      const mbp = f.at(side * 5.6, 0, 2.5);
      this._prop('mailbox', mbp, f.yaw, 150);
      // parked car on some lots
      if (k % 2 === 0) {
        const cp = f.at(side * 5.2, 0, -5);
        this._prop('car', cp, f.yaw, 600, houseColors[(k + 3) % houseColors.length]);
      }
      // street lamp
      const lp = f.at(-side * 6, 0, 0);
      const ly = this.terrain.heightAt(lp.x, lp.z);
      mb.box(0.14, 5, 0.14, 0x333333, [lp.x, ly + 2.5, lp.z]);
      mb.box(0.4, 0.2, 0.9, 0x333333, [lp.x, ly + 5, lp.z]);
    }
    this._add(mb.mesh(flatMaterial()));
    const welcome = sign(['WELCOME TO', 'GULL HARBOR'], { w: 3.4, h: 1.6, bg: '#f3efe2', fg: '#17613f', post: 1.4 });
    const f = frame(r, i0 - 6);
    welcome.position.copy(f.at(-6.8, 0, 0));
    welcome.rotation.y = f.yaw + Math.PI;
    this._add(welcome);
    this.blockers.push({ x: -360, z: -60, r: 44 });
  }

  _prop(kind, pos, yaw, fine, color = 0x3070a0) {
    const y = this.terrain.heightAt(pos.x, pos.z);
    const mb = new ModelBuilder();
    let half, mass;
    if (kind === 'mailbox') {
      mb.box(0.1, 1.1, 0.1, WOOD_DARK, [0, -0.1, 0]);
      mb.box(0.35, 0.35, 0.6, 0x3a5a8a, [0, 0.55, 0]);
      mb.box(0.04, 0.2, 0.1, 0xd8352a, [0.2, 0.7, 0.1]);
      half = [0.2, 0.65, 0.3];
      mass = 25;
    } else {
      mb.box(1.9, 0.7, 4.2, color, [0, 0.55, 0]);
      mb.box(1.7, 0.6, 2.2, color, [0, 1.15, -0.2]);
      mb.box(1.72, 0.45, 2.0, 0x2b3a44, [0, 1.15, -0.2]);
      for (const [x, z] of [[0.85, 1.3], [-0.85, 1.3], [0.85, -1.3], [-0.85, -1.3]]) mb.cyl(0.34, 0.34, 0.25, 10, 0x1d1d1d, [x, 0.34, z], [0, 0, Math.PI / 2]);
      half = [0.95, 0.72, 2.1];
      mass = 1100;
    }
    const mesh = mb.mesh(flatMaterial());
    this._add(mesh);
    const body = new CANNON.Body({ mass, material: this.game.physics.mats.item, collisionFilterGroup: G.PROP, collisionFilterMask: G.GROUND | G.RIG | G.PROP | G.DEBRIS | G.PLAYER, allowSleep: true });
    body.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(0, half[1] - (kind === 'mailbox' ? 0.75 : 0), 0));
    body.position.set(pos.x, y + (kind === 'mailbox' ? 0.75 : 0.02), pos.z);
    body.quaternion.setFromEuler(0, yaw, 0);
    body.sleepSpeedLimit = 0.3;
    body.userData = { kind, fine };
    this.pw.addBody(body);
    body.sleep();
    const prop = { kind, fine, body, mesh, home: body.position.clone(), homeQ: body.quaternion.clone(), knocked: false, yOff: kind === 'mailbox' ? -0.75 : 0 };
    this.props.push(prop);
    return prop;
  }

  // ---------------------------------------------------------------- harbor
  _harbor() {
    const r = this.road;
    const end = r.count - 1;
    const f = frame(r, end - 16);
    this.spots.harbor = f;
    this.spots.release = frame(r, end - 22);
    const mb = new ModelBuilder();
    // pier alongside the ramp
    const pier = f.at(-9, 0, 4);
    mb.box(5, 1.2, 34, CONCRETE, [pier.x, 1.0, pier.z], [0, f.yaw, 0]);
    this._box([5, 1.2, 34], new THREE.Vector3(pier.x, 1.0, pier.z), f.yaw);
    for (let k = -3; k <= 3; k++) {
      const p = f.at(-11.3, 0, 4 + k * 5);
      mb.cyl(0.18, 0.22, 0.5, 8, 0x333333, [p.x, 1.85, p.z]);
    }
    for (let k = -3; k <= 3; k++) {
      const p = f.at(-9, 0, 4 + k * 5.4);
      for (const s of [-2.2, 2.2]) {
        const q = f.at(-9 + s, 0, 4 + k * 5.4);
        mb.cyl(0.25, 0.25, 6, 7, WOOD_DARK, [q.x, -1.5, q.z]);
      }
      void p;
    }
    // lighthouse on the spit
    const lh = f.at(14, 0, 16);
    const ly = Math.max(0.5, this.terrain.heightAt(lh.x, lh.z));
    mb.cyl(1.2, 1.7, 11, 10, 0xf3efe2, [lh.x, ly + 5.5, lh.z]);
    for (let k = 0; k < 3; k++) mb.cyl(1.25 - k * 0.12, 1.33 - k * 0.12, 1.2, 10, 0xc63b2a, [lh.x, ly + 2 + k * 3.2, lh.z]);
    mb.cyl(1.0, 1.0, 1.2, 8, 0xfff2b8, [lh.x, ly + 11.6, lh.z]);
    mb.cone(1.3, 1.2, 8, 0xc63b2a, [lh.x, ly + 12.8, lh.z]);
    this._box([2.8, 12, 2.8], new THREE.Vector3(lh.x, ly + 6, lh.z));
    // fishing boat
    const bt = f.at(-16, 0, 8);
    const bm = new ModelBuilder();
    bm.box(3.2, 1.4, 9, 0x2f6f8f, [0, 0.3, 0]);
    bm.box(3.0, 0.2, 8.6, 0xf3efe2, [0, 1.05, 0]);
    bm.box(2.2, 1.8, 2.6, 0xf3efe2, [0, 2.0, -1.5]);
    bm.box(0.15, 5, 0.15, 0x7a5536, [0, 3.5, 1.8]);
    const boat = bm.mesh(flatMaterial());
    boat.position.set(bt.x, 0, bt.z);
    boat.rotation.y = f.yaw + 0.1;
    this._add(boat);
    this.boat = boat;
    this._add(mb.mesh(flatMaterial()));
    const hs = sign(['GULL HARBOR', 'BOAT RAMP'], { w: 3.2, h: 1.4, bg: '#17613f', fg: '#f3efe2', post: 1.6 });
    hs.position.copy(frame(r, end - 40).at(6.5, 0, 0));
    hs.rotation.y = f.yaw + Math.PI;
    this._add(hs);
    // release zone marker (painted chevrons)
    const rz = this.spots.release;
    const zm = new THREE.Mesh(new THREE.RingGeometry(5.5, 6.3, 40), new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity: 0.8, depthWrite: false }));
    zm.rotation.x = -Math.PI / 2;
    zm.position.copy(rz.at(0, 0.12, 0));
    this._add(zm);
    this.releaseMarker = zm;
    this.blockers.push({ x: f.p.x, z: f.p.z, r: 30 });
  }

  // ---------------------------------------------------------------- warning signs
  _signs() {
    const r = this.road;
    const put = (place, back, lines, opts = {}) => {
      const i = Math.max(0, r.places[place] - Math.round(back / r.ds));
      const f = frame(r, i);
      const s = sign(lines, opts);
      s.position.copy(f.at(-6.4 - (r.hw[i] - 4.6), 0, 0));
      s.position.y = this.terrain.heightAt(s.position.x, s.position.z);
      s.rotation.y = f.yaw + Math.PI;
      this._add(s);
    };
    put('tree', 60, ['TREE DOWN', 'AHEAD']);
    put('lines', 55, ['LOW WIRES', 'AHEAD']);
    put('overpass', 60, ["LOW CLEARANCE", "14'-5\""]);
    put('station', 70, ['FUEL · WATER', '½ MILE'], { bg: '#17613f', fg: '#f3efe2' });
    put('bridge', 60, ['WEIGHT LIMIT', '20 TONS'], { bg: '#f3efe2', fg: '#141414' });
    put('washout', 60, ['ROAD', 'WASHED OUT']);
    put('hairpins', 50, ['SWITCHBACKS', 'TRUCKS USE LOW GEAR']);
  }

  // ---------------------------------------------------------------- trees and rocks
  _scenery() {
    const rnd = this.rand;
    const T = this.terrain, r = this.road;
    const q = {};
    const pines = [], broad = [], rocks = [];
    const cell = 7;
    for (let x = -505; x < 505; x += cell) {
      for (let z = -505; z < 505; z += cell) {
        const px = x + rnd() * cell, pz = z + rnd() * cell;
        const h = T.heightAt(px, pz);
        if (h < 2.8) continue;
        const dens = T.noise(px * 0.008 + 7, pz * 0.008 - 3) * 0.5 + 0.5;
        const n = T.normalAt(px, pz);
        r.nearest(px, pz, 24, q);
        const nearRoad = q.i >= 0 && q.d < r.hw[q.i] + 5.5;
        if (nearRoad) continue;
        let blocked = false;
        for (const b of this.blockers) if ((px - b.x) ** 2 + (pz - b.z) ** 2 < b.r * b.r) blocked = true;
        if (blocked) continue;
        // creek banks and railway
        let dc = 1e9;
        for (let k = 0; k < CREEK_PATH.length - 1; k++) {
          const [ax, az] = CREEK_PATH[k], [bx, bz] = CREEK_PATH[k + 1];
          const dx = bx - ax, dz = bz - az;
          const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
          dc = Math.min(dc, Math.hypot(px - ax - dx * t, pz - az - dz * t));
        }
        if (dc < 7) continue;
        if (this.railLine) {
          const rl = this.railLine;
          const v = Math.abs((px - rl.x) * -rl.dz + (pz - rl.z) * rl.dx);
          if (v < 7) continue;
        }
        const slope = 1 - n.y;
        const u = rnd();
        if (slope > 0.3 || u < 0.08 * (1 - dens)) {
          if (rnd() < 0.35) rocks.push([px, h, pz, 0.6 + rnd() * 1.8, rnd() * 6]);
          continue;
        }
        if (u > dens * 0.85 + 0.08) continue;
        const s = 0.8 + rnd() * 0.7;
        const nearCoast = px - coastX(pz) < 110;
        if (nearCoast || rnd() < 0.3) broad.push([px, h, pz, s, rnd() * 6]);
        else pines.push([px, h, pz, s, rnd() * 6]);
      }
    }
    const mkInst = (geo, list, colorFn, yOff, scaleFn) => {
      const mesh = new THREE.InstancedMesh(geo, flatMaterial(), list.length);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
      const c = new THREE.Color();
      list.forEach(([x, y, z, s, rot], k) => {
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        scaleFn(sc, s);
        m.compose(new THREE.Vector3(x, y + yOff * s, z), qq, sc);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, colorFn(c, k));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this._add(mesh);
      return mesh;
    };
    const pineM = new ModelBuilder();
    pineM.cyl(0.18, 0.28, 2.2, 6, 0x5b3f29, [0, 1.1, 0]);
    pineM.cone(2.2, 3.4, 7, 0xffffff, [0, 3.2, 0]);
    pineM.cone(1.7, 2.9, 7, 0xffffff, [0, 4.8, 0]);
    pineM.cone(1.1, 2.3, 7, 0xffffff, [0, 6.2, 0]);
    // trunk keeps its color, foliage takes the instance tint (white base)
    const pineGeo = pineM.geometry();
    const broadM = new ModelBuilder();
    broadM.cyl(0.2, 0.3, 2.6, 6, 0x6a4a30, [0, 1.3, 0]);
    broadM.sphere(2.1, 0xffffff, [0, 3.9, 0], [1, 0.85, 1], 1);
    broadM.sphere(1.4, 0xffffff, [1.1, 3.4, 0.5], [1, 0.8, 1], 0);
    const broadGeo = broadM.geometry();
    const pal = [0x3f6b34, 0x355c2b, 0x4a7a3a, 0x2f5530];
    const pal2 = [0x6f8f3a, 0x5d8a3a, 0x86984a, 0x4d7a33, 0x9a8f3e];
    this.pines = mkInst(pineGeo, pines, (c, k) => c.setHex(pal[k % pal.length]), 0, (sc, s) => sc.set(s, s * (0.9 + (s % 0.2)), s));
    this.broads = mkInst(broadGeo, broad, (c, k) => c.setHex(pal2[k % pal2.length]), 0, (sc, s) => sc.set(s, s, s));
    const rockGeo = colorize(new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), 0xffffff);
    rockGeo.computeVertexNormals();
    this.rocks = mkInst(rockGeo, rocks, (c, k) => c.setHex([0x8a8378, 0x7b746a, 0x968f83][k % 3]), 0.2, (sc, s) => sc.set(s * 1.3, s * 0.8, s));
    // colliders for trees and rocks near the road so the rig can't cut corners through a forest
    let colliders = 0;
    for (const [x, y, z, s] of [...pines, ...broad]) {
      r.nearest(x, z, 40, q);
      if (q.i < 0) continue;
      const b = this._box([0.6 * s, 6, 0.6 * s], new THREE.Vector3(x, y + 3, z));
      b.userData = { kind: 'tree' };
      colliders++;
    }
    for (const [x, y, z, s] of rocks) {
      r.nearest(x, z, 40, q);
      if (q.i < 0 || s < 1.1) continue;
      this._box([s * 2, s * 1.4, s * 1.8], new THREE.Vector3(x, y + s * 0.3, z));
      colliders++;
    }
    this.counts = { pines: pines.length, broad: broad.length, rocks: rocks.length, colliders };
  }

  update(dt, time) {
    // knocked props follow their bodies
    for (const p of this.props) {
      const b = p.body;
      p.mesh.position.set(b.position.x, b.position.y + p.yOff, b.position.z);
      p.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
    for (const s of this.bridgeSegs) {
      const b = s.body;
      s.mesh.position.set(b.position.x, b.position.y, b.position.z);
      s.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
    if (this.releaseMarker) this.releaseMarker.material.opacity = 0.45 + 0.35 * Math.sin(time * 3);
    if (this.boat) this.boat.position.y = Math.sin(time * 0.9) * 0.15 - 0.1;
    const pulse = 0.25 + 0.15 * Math.sin(time * 4);
    for (const s of this.plankSlots) s.ghost.material.opacity = pulse;
  }
}
