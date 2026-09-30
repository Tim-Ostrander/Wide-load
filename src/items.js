// Carryable items. The host simulates free items as physics bodies; everyone
// else renders them from the host's snapshot. Held items ride on their
// holder's avatar.
import { THREE, CANNON } from './lib.js';
import { ModelBuilder, flatMaterial } from './util/geo.js';
import { G } from './physics.js';
import { createWheelModel } from './rig/models.js';

export const ITEM_TYPES = {
  plank: { label: 'plank', half: [0.43, 0.07, 5.1], mass: 90, heavy: true, long: true },
  post: { label: 'support post', half: [0.21, 2.25, 0.21], mass: 60, heavy: true, long: true, carryRot: [Math.PI / 2, 0, 0] },
  tire: { label: 'spare tire', half: [0.25, 0.55, 0.55], mass: 60, heavy: false },
  jerrycan: { label: 'jerry can', half: [0.12, 0.25, 0.2], mass: 20, heavy: false },
  chainsaw: { label: 'chainsaw', half: [0.12, 0.15, 0.5], mass: 8, heavy: false },
  hotstick: { label: 'hot stick', half: [0.05, 0.05, 2.2], mass: 6, heavy: false, long: true },
};

function itemModel(type) {
  const mb = new ModelBuilder();
  switch (type) {
    case 'plank':
      mb.box(0.86, 0.14, 10.2, 0x8a6441, [0, 0, 0]);
      mb.box(0.88, 0.02, 0.1, 0x5a3d26, [0, 0.07, -4]);
      mb.box(0.88, 0.02, 0.1, 0x5a3d26, [0, 0.07, 4]);
      break;
    case 'post':
      mb.box(0.42, 4.5, 0.42, 0x8a6441, [0, 0, 0]);
      mb.box(0.9, 0.2, 0.9, 0x5a3d26, [0, 2.15, 0]);
      break;
    case 'tire': {
      const g = createWheelModel(0.55, 0.5);
      return g;
    }
    case 'jerrycan':
      mb.box(0.24, 0.5, 0.4, 0xc8281e, [0, 0, 0]);
      mb.box(0.06, 0.08, 0.26, 0x222222, [0, 0.3, -0.02]);
      mb.cyl(0.04, 0.04, 0.1, 6, 0xf2c21b, [0, 0.28, 0.14]);
      break;
    case 'chainsaw':
      mb.box(0.24, 0.3, 0.4, 0xf06a1c, [0, 0, -0.2]);
      mb.box(0.06, 0.1, 0.8, 0x9a9a9a, [0, -0.02, 0.35]);
      mb.box(0.06, 0.12, 0.2, 0x222222, [0, 0.2, -0.25]);
      break;
    case 'hotstick':
      mb.cyl(0.035, 0.035, 4.4, 6, 0xf2c21b, [0, 0, 0], [Math.PI / 2, 0, 0]);
      mb.box(0.03, 0.25, 0.05, 0x333333, [0, 0.12, 2.2]);
      mb.box(0.03, 0.05, 0.15, 0x333333, [0, 0.24, 2.14]);
      break;
  }
  const g = new THREE.Group();
  g.add(mb.mesh(flatMaterial()));
  return g;
}

export const INITIAL_ITEMS = (structures, road) => {
  const list = [];
  let id = 1;
  const add = (type, where) => list.push({ id: id++, type, where });
  // stowed in the truck's toolbox at the start
  add('chainsaw', 'toolbox');
  add('hotstick', 'toolbox');
  add('tire', 'toolbox');
  add('tire', 'toolbox');
  add('jerrycan', 'toolbox');
  const st = structures.spots.station;
  add('jerrycan', { pos: st.at(-21, 0.4, -12), yaw: st.yaw });
  add('jerrycan', { pos: st.at(-21.6, 0.4, -12.4), yaw: st.yaw });
  add('tire', { pos: st.at(-26, 0.7, -3), yaw: st.yaw });
  add('tire', { pos: st.at(-27.2, 0.7, -3), yaw: st.yaw });
  const br = structures.spots.bridge;
  for (let k = 0; k < 5; k++) add('post', { pos: br.at(9 + k * 0.6, 0.3, -24), yaw: br.yaw, lie: true });
  const wo = structures.spots.washout;
  for (let k = 0; k < 7; k++) add('plank', { pos: wo.at(-9.5 - (k % 2) * 1.2, 0.2 + Math.floor(k / 2) * 0.16, -16), yaw: wo.yaw });
  void road;
  return list;
};

export class Items {
  constructor(game) {
    this.game = game;
    this.map = new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.toolbox = []; // ids stowed in the truck's toolbox (authoritative on host)
  }

  reset(defs) {
    for (const it of this.map.values()) this._remove(it);
    this.map.clear();
    this.toolbox = [];
    for (const d of defs) {
      const it = this._create(d.id, d.type);
      if (d.where === 'toolbox') {
        it.stowed = true;
        this.toolbox.push(d.id);
      } else {
        const { pos, yaw, lie } = d.where;
        it.pos.copy(pos);
        it.quat.setFromEuler(new THREE.Euler(lie ? Math.PI / 2 : 0, yaw, 0, 'YXZ'));
        if (d.type === 'tire') it.quat.setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2 * 0, 'YXZ'));
      }
    }
  }

  _create(id, type) {
    const mesh = itemModel(type);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(mesh);
    const it = { id, type, def: ITEM_TYPES[type], mesh, body: null, holder: null, stowed: false, gone: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.map.set(id, it);
    return it;
  }

  _remove(it) {
    this.group.remove(it.mesh);
    if (it.body) this.game.physics.world.removeBody(it.body);
    it.body = null;
  }

  /** Host: make sure every free item has a physics body. */
  ensureBodies() {
    for (const it of this.map.values()) {
      const free = !it.holder && !it.stowed && !it.gone;
      if (free && !it.body) this._makeBody(it);
      if (!free && it.body) {
        this.game.physics.world.removeBody(it.body);
        it.body = null;
      }
    }
  }

  _makeBody(it) {
    const { world, mats } = this.game.physics;
    const h = it.def.half;
    const body = new CANNON.Body({ mass: it.def.mass, material: mats.item, collisionFilterGroup: G.ITEM, collisionFilterMask: G.GROUND | G.RIG | G.ITEM | G.DEBRIS | G.PROP, allowSleep: true });
    if (it.type === 'tire') body.addShape(new CANNON.Cylinder(0.55, 0.55, 0.5, 10), new CANNON.Vec3(), new CANNON.Quaternion().setFromEuler(0, 0, Math.PI / 2));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(h[0], h[1], h[2])));
    body.position.set(it.pos.x, it.pos.y, it.pos.z);
    body.quaternion.set(it.quat.x, it.quat.y, it.quat.z, it.quat.w);
    body.linearDamping = 0.05;
    body.angularDamping = 0.2;
    body.sleepSpeedLimit = 0.2;
    body.sleepTimeLimit = 0.6;
    body.userData = { kind: 'item', id: it.id };
    world.addBody(body);
    it.body = body;
  }

  get(id) {
    return this.map.get(id);
  }

  // host operations ------------------------------------------------------
  pickup(id, peer) {
    const it = this.map.get(id);
    if (!it || it.gone || it.holder) return false;
    if (it.stowed) {
      it.stowed = false;
      this.toolbox = this.toolbox.filter((x) => x !== id);
    }
    it.holder = peer;
    return true;
  }

  takeFromToolbox(peer) {
    const id = this.toolbox[0];
    if (id === undefined) return null;
    this.toolbox.shift();
    const it = this.map.get(id);
    it.stowed = false;
    it.holder = peer;
    return id;
  }

  stow(id, peer) {
    const it = this.map.get(id);
    if (!it || it.holder !== peer || it.def.heavy) return false;
    it.holder = null;
    it.stowed = true;
    this.toolbox.push(id);
    return true;
  }

  drop(id, peer, pos, yaw, vel) {
    const it = this.map.get(id);
    if (!it || it.holder !== peer) return false;
    it.holder = null;
    it.pos.set(pos[0], pos[1], pos[2]);
    it.quat.setFromEuler(new THREE.Euler(it.type === 'post' ? Math.PI / 2 : 0, yaw, 0, 'YXZ'));
    this.ensureBodies();
    if (it.body && vel) it.body.velocity.set(vel[0], vel[1], vel[2]);
    return true;
  }

  consume(id) {
    const it = this.map.get(id);
    if (!it) return;
    it.gone = true;
    it.holder = null;
    it.stowed = false;
    this.toolbox = this.toolbox.filter((x) => x !== id);
  }

  /** Drop everything a departed peer was holding where they stood. */
  releaseHolder(peer, pos) {
    for (const it of this.map.values()) {
      if (it.holder === peer) {
        it.holder = null;
        it.pos.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
      }
    }
  }

  // snapshots -------------------------------------------------------------
  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const out = [];
    for (const it of this.map.values()) {
      if (it.gone) {
        out.push([it.id, 0]);
        continue;
      }
      if (it.stowed) {
        out.push([it.id, 1]);
        continue;
      }
      if (it.holder) {
        out.push([it.id, 2, it.holder]);
        continue;
      }
      const p = it.body ? it.body.position : it.pos;
      const q = it.body ? it.body.quaternion : it.quat;
      out.push([it.id, 3, r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]);
    }
    return { l: out, tb: [...this.toolbox] };
  }

  applySnapshot(s) {
    if (!s) return;
    for (const e of s.l) {
      const it = this.map.get(e[0]);
      if (!it || e[1] === 4) continue;
      it.gone = e[1] === 0;
      it.stowed = e[1] === 1;
      it.holder = e[1] === 2 ? e[2] : null;
      if (e[1] === 3) {
        it.pos.set(e[2], e[3], e[4]);
        it.quat.set(e[5], e[6], e[7], e[8]);
      }
    }
    this.toolbox = [...s.tb];
  }

  // visuals ----------------------------------------------------------------
  update(dt, avatars) {
    for (const it of this.map.values()) {
      const vis = !it.gone && !it.stowed;
      it.mesh.visible = vis;
      if (!vis) continue;
      if (it.holder) {
        const av = avatars(it.holder);
        if (av) {
          av.holdTransform(it, it.mesh);
          continue;
        }
      }
      if (it.body) {
        it.pos.set(it.body.position.x, it.body.position.y, it.body.position.z);
        it.quat.set(it.body.quaternion.x, it.body.quaternion.y, it.body.quaternion.z, it.body.quaternion.w);
      }
      it.mesh.position.lerp(it.pos, it.body ? 1 : Math.min(1, dt * 12));
      it.mesh.quaternion.slerp(it.quat, it.body ? 1 : Math.min(1, dt * 12));
    }
  }

  /** Nearest free item to a point. */
  nearest(pos, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const it of this.map.values()) {
      if (it.gone || it.stowed || it.holder) continue;
      const p = it.mesh.position;
      let d = p.distanceToSquared(pos);
      if (it.def.long) {
        // distance to the item's long axis
        const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(it.mesh.quaternion);
        if (it.type === 'post') ax.set(0, 1, 0).applyQuaternion(it.mesh.quaternion);
        const len = it.type === 'plank' ? 5 : it.type === 'post' ? 2.2 : 2.2;
        const rel = pos.clone().sub(p);
        const t = Math.max(-len, Math.min(len, rel.dot(ax)));
        d = rel.sub(ax.multiplyScalar(t)).lengthSq();
      }
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }
}
