// Crew members: the avatar model (shared by local and remote players) and the
// local player's physics controller.
import { THREE, CANNON } from './lib.js';
import { ModelBuilder, flatMaterial } from './util/geo.js';
import { G } from './physics.js';
import { clamp, damp, angleDiff } from './util/rng.js';
import { SEATS } from './rig/rig.js';

export const HAT_COLORS = [0xf5c518, 0xe8572a, 0x3fb6c9, 0x8bc34a, 0xe86fa8, 0xf3efe2];
export const HAT_NAMES = ['Yellow', 'Orange', 'Teal', 'Lime', 'Pink', 'White'];
export const HATS = [
  ['cowboy', 'Cowboy hat'],
  ['trucker', 'Trucker cap'],
  ['bucket', 'Bucket hat'],
  ['hardhat', 'Hard hat'],
  ['beanie', 'Beanie'],
  ['none', 'No hat'],
];
export const GLASSES = [
  ['aviator', 'Aviators'],
  ['shades', 'Wraparounds'],
  ['round', 'Round shades'],
  ['none', 'No shades'],
];
export const SKIN = [0xf0b48a, 0xffcfae, 0xc98f67, 0x9a6444, 0x6e4630];
const JEANS = 0x3d5a8a, BOOT = 0x5a3a22, UNDERSHIRT = 0xf1ede2, WHISKERS = 0x4a2e1e;
// proportions: short legs, barrel chest, no neck, long arms
const HIP = 0.42, SHOULDER = 0.72, HEAD_Y = 0.8;
const SIT_HIP = 0.62;
export const CIG_BURN = 40; // seconds per cigarette
export const PACK_START = 5;
export const PACK_SIZE = 10;
const SMOKE_BOOST = 1.2;
const LIGHT_TIME = 1.2;

const idx = (list, v, dflt) => {
  if (typeof v === 'number' && list[v]) return v;
  const k = list.findIndex((e) => e[0] === v);
  return k >= 0 ? k : dflt;
};
/** Normalize a look ({hat, glasses} as indices or names, skin as an index) to indices. */
export function lookOf(look = {}) {
  const skin = Number(look.skin);
  return { hat: idx(HATS, look.hat, 0), glasses: idx(GLASSES, look.glasses, 0), skin: Number.isInteger(skin) && SKIN[skin] !== undefined ? skin : 0 };
}

const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const tint = (hex, to, k) => new THREE.Color(hex).lerp(new THREE.Color(to), k).getHex();

function limb(build) {
  const g = new THREE.Group();
  const mb = new ModelBuilder();
  build(mb);
  g.add(mb.mesh(flatMaterial()));
  return g;
}

function buildHat(mb, hat, hc) {
  const top = 0.44;
  switch (HATS[hat][0]) {
    case 'cowboy': {
      const tan = 0xc8a066;
      mb.box(0.36, 0.2, 0.34, tan, [0, top + 0.12, 0]);
      mb.box(0.1, 0.04, 0.3, shade(tan, 0.8), [0, top + 0.21, 0]);
      mb.box(0.37, 0.06, 0.35, hc, [0, top + 0.04, 0]);
      mb.box(0.56, 0.035, 0.66, tan, [0, top, 0]);
      mb.box(0.14, 0.035, 0.6, tan, [0.33, top + 0.05, 0], [0, 0, 0.7]);
      mb.box(0.14, 0.035, 0.6, tan, [-0.33, top + 0.05, 0], [0, 0, -0.7]);
      break;
    }
    case 'trucker':
      mb.box(0.48, 0.2, 0.46, hc, [0, top + 0.06, -0.01]);
      mb.box(0.42, 0.19, 0.03, 0xf3efe2, [0, top + 0.06, 0.225]);
      mb.box(0.16, 0.08, 0.01, shade(hc, 0.7), [0, top + 0.07, 0.242]);
      mb.box(0.06, 0.03, 0.06, shade(hc, 0.7), [0, top + 0.175, 0]);
      mb.box(0.42, 0.03, 0.26, hc, [0, top - 0.02, 0.33], [0.14, 0, 0]);
      break;
    case 'bucket':
      mb.cyl(0.2, 0.25, 0.2, 8, shade(hc, 0.75), [0, top + 0.08, 0]);
      mb.cyl(0.26, 0.38, 0.08, 8, shade(hc, 0.75), [0, top - 0.03, 0]);
      mb.cyl(0.255, 0.255, 0.04, 8, shade(hc, 0.55), [0, top + 0.02, 0]);
      break;
    case 'hardhat':
      mb.sphere(0.27, hc, [0, top - 0.02, 0], [1, 0.7, 1.08]);
      mb.box(0.07, 0.06, 0.5, hc, [0, top + 0.17, 0]);
      mb.cyl(0.32, 0.32, 0.03, 10, hc, [0, top - 0.03, 0.03]);
      break;
    case 'beanie':
      mb.box(0.48, 0.22, 0.46, hc, [0, top + 0.06, 0]);
      mb.box(0.5, 0.09, 0.48, shade(hc, 0.75), [0, top - 0.02, 0]);
      mb.sphere(0.08, 0xf3efe2, [0, top + 0.22, 0], [1, 1, 1], 0);
      break;
    default:
      // bald on top, a proud comb-over
      mb.box(0.3, 0.025, 0.2, WHISKERS, [0.02, top + 0.005, 0], [0, 0, -0.08]);
  }
}

function buildGlasses(mb, glasses) {
  const y = 0.285, z = 0.232;
  switch (GLASSES[glasses][0]) {
    case 'aviator':
      mb.box(0.15, 0.11, 0.02, 0x274652, [0.1, y, z]);
      mb.box(0.15, 0.11, 0.02, 0x274652, [-0.1, y, z]);
      mb.box(0.36, 0.02, 0.02, 0xd9b04a, [0, y + 0.055, z]);
      mb.box(0.02, 0.02, 0.24, 0xd9b04a, [0.235, y + 0.04, z - 0.12]);
      mb.box(0.02, 0.02, 0.24, 0xd9b04a, [-0.235, y + 0.04, z - 0.12]);
      break;
    case 'shades':
      mb.box(0.47, 0.09, 0.03, 0x161616, [0, y, z + 0.005]);
      mb.box(0.02, 0.07, 0.22, 0x161616, [0.235, y, z - 0.1]);
      mb.box(0.02, 0.07, 0.22, 0x161616, [-0.235, y, z - 0.1]);
      break;
    case 'round':
      mb.cyl(0.065, 0.065, 0.02, 10, 0x1d1d24, [0.1, y, z], [Math.PI / 2, 0, 0]);
      mb.cyl(0.065, 0.065, 0.02, 10, 0x1d1d24, [-0.1, y, z], [Math.PI / 2, 0, 0]);
      mb.box(0.08, 0.02, 0.02, 0x8a8a8a, [0, y + 0.02, z]);
      mb.box(0.02, 0.02, 0.24, 0x8a8a8a, [0.235, y + 0.02, z - 0.12]);
      mb.box(0.02, 0.02, 0.24, 0x8a8a8a, [-0.235, y + 0.02, z - 0.12]);
      break;
    default:
      break;
  }
}

/** Low-poly smoke puffs in world space: they swell, drift up and shrink away. */
class Puffs {
  constructor(scene, n = 36) {
    this.scene = scene;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xece8e0, flatShading: true, emissive: 0x4a4a4a }), n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.list = Array.from({ length: n }, () => ({ life: 0, max: 1, size: 0.1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    for (let k = 0; k < n; k++) this.mesh.setMatrixAt(k, this._m.makeScale(0, 0, 0));
    scene.add(this.mesh);
  }

  emit(pos, vel, size, life) {
    const p = this.list[this.next];
    this.next = (this.next + 1) % this.list.length;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.size = size;
    p.life = p.max = life;
    p.spin = Math.random() * 6;
  }

  update(dt) {
    let any = false;
    this.list.forEach((p, k) => {
      if (p.life <= 0) return;
      any = true;
      p.life -= dt;
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 1.8));
      p.vel.y += 0.35 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.max;
      const s = p.life > 0 ? p.size * (0.35 + t * 1.3) * Math.min(1, (1 - t) * 3) : 0;
      this._q.setFromEuler(this._e.set(p.spin + t, p.spin * 0.7, t));
      this.mesh.setMatrixAt(k, this._m.compose(p.pos, this._q, this._s.setScalar(s)));
    });
    if (any || this._dirty) this.mesh.instanceMatrix.needsUpdate = true;
    this._dirty = any;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

function nameSprite(text, hex) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 30px "Overpass", "Barlow", system-ui, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(20,22,20,0.72)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 10, w, 44, 10);
  g.fill();
  g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g.fillRect((256 - w) / 2 + 10, 26, 10, 12);
  g.fillStyle = '#f3efe2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128 + 8, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 20;
  return s;
}

/**
 * A crew member: short, barrel-chested, no neck, big nose and mustache, a hat,
 * shades and usually a cigarette.
 */
export class Avatar {
  constructor(scene, colorIdx = 0, name = 'Crew', { local = false, look } = {}) {
    this.scene = scene;
    this.colorIdx = colorIdx;
    this.name = name;
    this.look = lookOf(look);
    const hc = HAT_COLORS[colorIdx % HAT_COLORS.length];
    const shirt = shade(hc, 0.92);
    const skin = SKIN[this.look.skin];
    const g = new THREE.Group();
    this.group = g;
    const body = new THREE.Group();
    body.position.y = HIP;
    g.add(body);
    this.body = body;
    const tb = new ModelBuilder();
    tb.box(0.56, 0.2, 0.4, JEANS, [0, 0.06, 0]);
    tb.box(0.6, 0.07, 0.44, 0x4a3020, [0, 0.19, 0]);
    tb.box(0.13, 0.09, 0.03, 0xe0b040, [0, 0.19, 0.225]);
    tb.box(0.62, 0.3, 0.56, UNDERSHIRT, [0, 0.36, 0.08]); // the belly shows under the shirt
    tb.box(0.76, 0.36, 0.52, shirt, [0, 0.62, 0]);
    tb.box(0.72, 0.06, 0.53, shade(shirt, 0.8), [0, 0.47, 0.02]);
    tb.box(0.14, 0.13, 0.02, shade(shirt, 0.8), [0.18, 0.66, 0.265]);
    tb.box(0.3, 0.06, 0.1, shade(shirt, 0.8), [0, 0.8, 0.21]);
    body.add(tb.mesh(flatMaterial()));
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    const hb = new ModelBuilder();
    hb.box(0.46, 0.44, 0.44, skin, [0, 0.22, 0]);
    hb.box(0.47, 0.16, 0.45, shade(skin, 0.8), [0, 0.08, 0]); // stubble
    hb.box(0.13, 0.15, 0.12, tint(skin, 0xe0705a, 0.35), [0, 0.2, 0.26]); // sunburnt nose
    hb.box(0.3, 0.075, 0.07, WHISKERS, [0, 0.115, 0.235]); // mustache
    hb.box(0.06, 0.1, 0.06, WHISKERS, [0.13, 0.08, 0.232]);
    hb.box(0.06, 0.1, 0.06, WHISKERS, [-0.13, 0.08, 0.232]);
    hb.box(0.07, 0.06, 0.02, 0x1d1a1a, [0.1, 0.29, 0.222]);
    hb.box(0.07, 0.06, 0.02, 0x1d1a1a, [-0.1, 0.29, 0.222]);
    hb.box(0.34, 0.05, 0.05, WHISKERS, [0, 0.345, 0.225]); // unibrow
    hb.box(0.05, 0.12, 0.09, skin, [0.245, 0.22, 0]);
    hb.box(0.05, 0.12, 0.09, skin, [-0.245, 0.22, 0]);
    hb.box(0.04, 0.14, 0.2, WHISKERS, [0.232, 0.32, -0.08]);
    hb.box(0.04, 0.14, 0.2, WHISKERS, [-0.232, 0.32, -0.08]);
    buildHat(hb, this.look.hat, hc);
    buildGlasses(hb, this.look.glasses);
    head.add(hb.mesh(flatMaterial()));
    // the cigarette hangs from the corner of the mouth
    const cig = new THREE.Group();
    cig.position.set(0.08, 0.06, 0.24);
    cig.rotation.set(0.35, 0.35, 0);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.16), new THREE.MeshLambertMaterial({ color: 0xf6f3ea }));
    paper.position.z = 0.08;
    const filter = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.037, 0.04), new THREE.MeshLambertMaterial({ color: 0xd98a3a }));
    filter.position.z = 0.02;
    this.ember = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.03), new THREE.MeshBasicMaterial({ color: 0xff6a1f }));
    this.ember.position.z = 0.17;
    cig.add(paper, filter, this.ember);
    cig.visible = false;
    head.add(cig);
    this.cig = cig;
    body.add(head);
    this.head = head;
    const arm = (side) =>
      limb((mb) => {
        mb.box(0.22, 0.2, 0.22, shirt, [0, -0.08, 0]); // short sleeve
        mb.box(0.16, 0.36, 0.16, skin, [0, -0.3, 0]);
        mb.box(0.19, 0.17, 0.2, skin, [side * -0.01, -0.54, 0.01]); // mitt
      });
    this.armL = arm(1);
    this.armR = arm(-1);
    this.armL.position.set(0.47, SHOULDER, 0);
    this.armR.position.set(-0.47, SHOULDER, 0);
    body.add(this.armL, this.armR);
    const leg = () =>
      limb((mb) => {
        mb.box(0.22, 0.34, 0.24, JEANS, [0, -0.17, 0]);
        mb.box(0.24, 0.1, 0.34, BOOT, [0, -0.37, 0.05]);
      });
    this.legL = leg();
    this.legR = leg();
    this.legL.position.set(0.15, 0.0, 0);
    this.legR.position.set(-0.15, 0.0, 0);
    body.add(this.legL, this.legR);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (!local) {
      this.tag = nameSprite(name, hc);
      this.tag.position.y = 2.25;
      g.add(this.tag);
    }
    scene.add(g);
    this.puffs = new Puffs(scene);
    this.phase = 0;
    this.anim = { speed: 0, grounded: true, seated: false, carrying: null, action: null };
    this.yaw = 0;
    this.bubble = null;
    // smoking: lit (wanted), light (lighter timer), drag timers, flicked butt
    this.smoke = { lit: false, light: 0, drag: 0, nextDrag: 2 + Math.random() * 3, exhale: 0, wisp: 0, flick: 0 };
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  dispose() {
    this.scene.remove(this.group);
    this.puffs.dispose();
  }

  setVisible(v) {
    this.group.visible = v;
  }

  get smoking() {
    return this.smoke.lit;
  }

  /** Light up (with a lighter animation, unless instant) or flick the butt away. */
  setSmoking(lit, instant = false) {
    const sm = this.smoke;
    if (lit === sm.lit) return;
    sm.lit = lit;
    if (lit) {
      sm.light = instant ? 0 : LIGHT_TIME;
      sm.nextDrag = LIGHT_TIME + 2 + Math.random() * 3;
    } else if (this.cig.visible && !instant) {
      sm.flick = 0.45;
    }
  }

  /** World position of a point in head space. */
  _headPoint(x, y, z, out) {
    return this.head.localToWorld(out.set(x, y, z));
  }

  _updateSmoke(dt, busy) {
    const sm = this.smoke;
    const visible = this.group.visible;
    sm.light = Math.max(0, sm.light - dt);
    sm.drag = Math.max(0, sm.drag - dt);
    sm.flick = Math.max(0, sm.flick - dt);
    this.cig.visible = sm.lit || sm.flick > 0;
    if (sm.lit && sm.light <= 0) {
      sm.nextDrag -= dt;
      if (sm.nextDrag <= 0 && !busy) {
        sm.drag = 1.1;
        sm.nextDrag = 5 + Math.random() * 4;
        sm.exhale = 1.4;
      }
    }
    // the ember glows hot during a drag
    const hot = sm.drag > 0 ? 1 : 0;
    this.ember.material.color.setHex(hot ? 0xffc04a : 0xff6a1f);
    this.ember.scale.setScalar(hot ? 1.35 : 1);
    if (!visible) return;
    this.group.updateMatrixWorld(true);
    if (sm.lit && sm.light <= 0) {
      sm.wisp -= dt;
      if (sm.wisp <= 0) {
        sm.wisp = 0.28 + Math.random() * 0.2;
        const tip = this.ember.getWorldPosition(this._v);
        this.puffs.emit(tip, this._w.set((Math.random() - 0.5) * 0.08, 0.35, (Math.random() - 0.5) * 0.08), 0.035 + Math.random() * 0.02, 1.6);
      }
    }
    if (sm.exhale > 0) {
      const before = sm.exhale;
      sm.exhale -= dt;
      // breathe out a cloud a beat after the drag
      if (before > 0.3 && sm.exhale <= 0.3) {
        const mouth = this._headPoint(0, 0.1, 0.3, this._v);
        const fwd = this._headPoint(0, 0.1, 1.3, new THREE.Vector3()).sub(mouth);
        for (let k = 0; k < 6; k++) {
          const v = this._w.copy(fwd).multiplyScalar(0.6 + Math.random() * 0.5);
          v.x += (Math.random() - 0.5) * 0.3;
          v.y += 0.1 + Math.random() * 0.25;
          v.z += (Math.random() - 0.5) * 0.3;
          this.puffs.emit(mouth, v, 0.07 + Math.random() * 0.06, 1.3 + Math.random() * 0.6);
        }
      }
    }
    if (sm.light > 0 && sm.light < LIGHT_TIME - 0.5 && Math.random() < dt * 14) {
      // lighter flame, then the first puff
      const tip = this._headPoint(0.12, 0.02, 0.4, this._v);
      this.puffs.emit(tip, this._w.set(0, 0.3, 0), 0.03, 0.4);
    }
    this.puffs.update(dt);
  }

  update(dt, time) {
    const a = this.anim;
    const g = this.group;
    const sm = this.smoke;
    g.rotation.y = this.yaw;
    const moving = a.speed > 0.4 && a.grounded && !a.seated;
    // short legs take quick steps
    this.phase += dt * (moving ? 3.2 + a.speed * 1.6 : 0);
    const sw = moving ? Math.sin(this.phase) * clamp(a.speed / 5, 0.35, 0.95) : 0;
    let armL = -sw * 0.9, armR = sw * 0.9, legL = sw * 1.1, legR = -sw * 1.1, bodyY = HIP, lean = moving ? a.speed * 0.025 : 0;
    let armSpreadL = 0.12, armSpreadR = -0.12;
    let waddle = moving ? Math.sin(this.phase) * 0.09 : 0;
    let headX = 0;
    if (!a.grounded && !a.seated) {
      legL = 0.6;
      legR = -0.3;
      armL = armR = -2.4;
      armSpreadL = 0.5;
      armSpreadR = -0.5;
    }
    if (a.seated) {
      legL = legR = -1.5;
      armL = armR = -1.1;
      bodyY = SIT_HIP;
      waddle = 0;
    }
    if (a.carrying) {
      const heavy = a.carrying === 'plank' || a.carrying === 'post';
      if (heavy) {
        armL = -2.9; // up to the shoulder
        armR = -0.4 + sw * 0.3;
      } else if (a.carrying === 'hotstick') {
        armL = -1.2;
        armR = -1.0;
      } else {
        armL = armR = -1.1;
        armSpreadL = 0.3;
        armSpreadR = -0.3;
      }
    }
    switch (a.action) {
      case 'chop':
        armL = armR = -1.2 + Math.sin(time * 30) * 0.08;
        break;
      case 'ratchet':
        armR = -1.0 + Math.sin(time * 10) * 0.6;
        armL = -0.6;
        lean = 0.35;
        break;
      case 'jack':
      case 'place':
        armL = armR = -0.8 + Math.sin(time * 6) * 0.3;
        lean = 0.55;
        bodyY = HIP - 0.08;
        legL = -0.5;
        legR = 0.4;
        break;
      case 'lift':
        armL = armR = -2.9;
        break;
      case 'pour':
        armL = armR = -1.3 + Math.sin(time * 3) * 0.1;
        lean = 0.2;
        break;
      case 'wave':
        armR = -2.7 + Math.sin(time * 12) * 0.35;
        armSpreadR = -0.3;
        break;
    }
    const busy = !!a.action || !!a.carrying;
    // smoking gestures: cup the lighter, raise the cig hand for a drag, flick the butt
    if (!busy) {
      if (sm.light > 0) {
        // lighter in the right hand, the left cupped around the flame
        armR = -1.95;
        armSpreadR = 0.5;
        armL = -1.85;
        armSpreadL = -0.95;
        headX = 0.15;
      } else if (sm.drag > 0.2) {
        armR = -2.0;
        armSpreadR = 0.62;
        headX = -0.1;
      } else if (sm.flick > 0) {
        armR = -1.6 + (0.45 - sm.flick) * 3;
        armSpreadR = 0.2;
      }
    }
    this._updateSmoke(dt, busy || moving);
    const k = Math.min(1, dt * 14);
    this.armL.rotation.x += (armL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (armSpreadL - this.armL.rotation.z) * k;
    this.armR.rotation.z += (armSpreadR - this.armR.rotation.z) * k;
    this.legL.rotation.x += (legL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * k;
    const breathe = moving ? Math.abs(Math.cos(this.phase)) * 0.06 : Math.sin(time * 2.1) * 0.008;
    this.body.position.y += (bodyY + breathe - this.body.position.y) * k;
    this.body.rotation.x += (lean - this.body.rotation.x) * k;
    this.body.rotation.z += (waddle - this.body.rotation.z) * k;
    this.head.rotation.x += (headX - this.head.rotation.x) * k;
    if (this.bubble) {
      this.bubble.life -= dt;
      if (this.bubble.life <= 0) {
        g.remove(this.bubble.sprite);
        this.bubble = null;
      }
    }
  }

  /** Where a held item sits relative to this avatar. */
  holdTransform(it, mesh) {
    const g = this.group;
    g.updateMatrixWorld();
    const local = new THREE.Vector3();
    const rot = new THREE.Euler();
    switch (it.type) {
      case 'plank':
        local.set(0.3, 1.35, 0.9);
        rot.set(0, 0, 0.1);
        break;
      case 'post':
        local.set(0.3, 1.32, 0.3);
        rot.set(Math.PI / 2, 0, 0);
        break;
      case 'hotstick':
        local.set(-0.1, 1.1, 1.6);
        rot.set(this.anim.action === 'lift' ? -1.2 : -0.35, 0, 0);
        if (this.anim.action === 'lift') local.set(0, 2.45, 0.6);
        break;
      case 'tire':
        local.set(0, 0.9, 0.6);
        rot.set(0, Math.PI / 2, 0);
        break;
      case 'chainsaw':
        local.set(-0.1, 0.8, 0.6);
        break;
      default:
        local.set(0, 0.82, 0.55);
    }
    mesh.position.copy(local.applyMatrix4(g.matrixWorld));
    mesh.quaternion.setFromEuler(rot).premultiply(g.getWorldQuaternion(new THREE.Quaternion()));
  }

  say(text) {
    if (this.bubble) this.group.remove(this.bubble.sprite);
    const s = nameSprite(text, HAT_COLORS[this.colorIdx % HAT_COLORS.length]);
    s.scale.set(2.6, 0.65, 1);
    s.position.y = 2.65;
    this.group.add(s);
    this.bubble = { sprite: s, life: 4 };
  }
}

/** The local player's body and movement. */
export class LocalPlayer {
  constructor(game, colorIdx, name, look) {
    this.game = game;
    this.avatar = new Avatar(game.scene, colorIdx, name, { local: true, look });
    const { world, mats } = game.physics;
    this.world = world;
    const body = new CANNON.Body({ mass: 80, material: mats.player, collisionFilterGroup: G.PLAYER, collisionFilterMask: G.GROUND | G.RIG | G.PROP | G.DEBRIS, fixedRotation: true, allowSleep: false });
    body.addShape(new CANNON.Sphere(0.34), new CANNON.Vec3(0, 0, 0));
    body.addShape(new CANNON.Sphere(0.3), new CANNON.Vec3(0, 0.95, 0));
    body.linearDamping = 0;
    body.updateMassProperties();
    world.addBody(body);
    this.body = body;
    this.inWorld = true;
    this.yaw = 0;
    this.seat = null;
    this.held = null;
    this.grounded = false;
    this.groundBody = null;
    this.platformVel = new CANNON.Vec3();
    this.action = null; // {name, anim, t, dur, done}
    this.rayResult = new CANNON.RaycastResult();
    this.coyote = 0;
    this.lastSafe = new THREE.Vector3();
    this.cigs = PACK_START;
    this.cigT = 0; // seconds left on the lit cigarette
  }

  get smoking() {
    return this.cigT > 0;
  }

  /** C: light one up, or flick the one you're smoking. Returns what happened. */
  toggleSmoke() {
    if (this.cigT > 0) {
      this.cigT = 0;
      this.avatar.setSmoking(false);
      return 'flick';
    }
    if (this.cigs <= 0) return 'empty';
    this.cigs--;
    this.cigT = CIG_BURN;
    this.avatar.setSmoking(true);
    return 'lit';
  }

  resetSmokes() {
    this.cigs = PACK_START;
    this.cigT = 0;
    this.avatar.setSmoking(false, true);
  }

  get position() {
    return this.body.position;
  }

  setLook(colorIdx, name, look) {
    const old = this.avatar;
    this.avatar = new Avatar(this.game.scene, colorIdx, name, { local: true, look });
    this.avatar.yaw = old.yaw;
    this.avatar.setSmoking(this.cigT > 0, true);
    old.dispose();
  }

  feet(out = new THREE.Vector3()) {
    return out.set(this.body.position.x, this.body.position.y - 0.34, this.body.position.z);
  }

  teleport(p, yaw) {
    this.body.position.set(p.x, p.y + 0.4, p.z);
    this.body.velocity.setZero();
    if (yaw !== undefined) this.yaw = yaw;
  }

  sit(seat) {
    this.seat = seat;
    if (this.inWorld) {
      this.world.removeBody(this.body);
      this.inWorld = false;
    }
  }

  stand(pos) {
    this.seat = null;
    if (!this.inWorld) {
      this.world.addBody(this.body);
      this.inWorld = true;
    }
    this.teleport(pos);
  }

  /** Fixed-step movement. move: {x, z} in camera space, jump, sprint. */
  fixedUpdate(h, ctl, camYaw) {
    if (this.cigT > 0) {
      this.cigT -= h;
      if (this.cigT <= 0) this.avatar.setSmoking(false);
    }
    if (this.seat) {
      const s = SEATS[this.seat];
      const p = this.game.rig.toWorld(s.body, s.sit);
      this.body.position.set(p.x, p.y, p.z);
      this.body.velocity.setZero();
      return;
    }
    const b = this.body;
    // ground probe
    const from = new CANNON.Vec3(b.position.x, b.position.y + 0.1, b.position.z);
    const to = new CANNON.Vec3(b.position.x, b.position.y - 0.62, b.position.z);
    this.rayResult.reset();
    this.world.raycastClosest(from, to, { collisionFilterMask: G.GROUND | G.RIG | G.PROP | G.DEBRIS | G.ITEM, skipBackfaces: true }, this.rayResult);
    const wasGrounded = this.grounded;
    this.grounded = this.rayResult.hasHit && this.rayResult.hitNormalWorld.y > 0.45;
    this.groundBody = this.grounded ? this.rayResult.body : null;
    if (this.grounded) this.coyote = 0.12;
    else this.coyote -= h;
    this.platformVel.setZero();
    if (this.groundBody && this.groundBody.type !== CANNON.Body.STATIC) {
      this.groundBody.getVelocityAtWorldPoint(this.rayResult.hitPointWorld, this.platformVel);
    }
    // desired velocity
    const heavy = this.held && ['plank', 'post'].includes(this.game.items.get(this.held)?.type);
    const busy = !!this.action;
    let speed = ctl.sprint && !heavy ? 6.8 : heavy ? 3.0 : 4.4;
    // a smoke break puts a spring in the step
    if (this.cigT > 0) speed *= SMOKE_BOOST;
    if (busy) speed = 0;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * ctl.z + rx * ctl.x, mz = fz * ctl.z + rz * ctl.x;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const control = this.grounded ? 1 : 0.35;
    const tvx = mx * speed + this.platformVel.x, tvz = mz * speed + this.platformVel.z;
    b.velocity.x += (tvx - b.velocity.x) * Math.min(1, control * 18 * h);
    b.velocity.z += (tvz - b.velocity.z) * Math.min(1, control * 18 * h);
    if (ml > 0.1 && !busy) {
      const target = Math.atan2(mx, mz);
      this.yaw += angleDiff(this.yaw, target) * Math.min(1, h * 12);
    }
    // ride along with platform rotation
    if (this.groundBody && this.groundBody.type !== CANNON.Body.STATIC) this.yaw += this.groundBody.angularVelocity.y * h;
    if (ctl.jump && this.coyote > 0 && !heavy && !busy) {
      b.velocity.y = this.platformVel.y + 6.2;
      this.coyote = 0;
      this.grounded = false;
    }
    // stick to moving platforms
    if (this.grounded && !ctl.jump && this.groundBody && this.groundBody.type !== CANNON.Body.STATIC && b.velocity.y > this.platformVel.y + 0.5) {
      b.velocity.y = this.platformVel.y;
    }
    b.force.y -= 80 * 9.0;
    void wasGrounded;
    // safety
    const floor = this.game.world.heightAt(b.position.x, b.position.z);
    if (this.grounded && this.groundBody === this.game.world.terrainBody) this.lastSafe.set(b.position.x, b.position.y, b.position.z);
    if (b.position.y < floor - 3 || b.position.y < -4 || Math.abs(b.position.x) > 505 || Math.abs(b.position.z) > 505) this.respawnAtRig();
  }

  respawnAtRig() {
    const p = this.game.rig.toWorld('truck', [3.2, 0, 1.5]);
    p.y = Math.max(p.y, this.game.world.heightAt(p.x, p.z) + 0.6);
    this.teleport(p);
  }

  updateVisual(dt, time) {
    const av = this.avatar;
    av.yaw = this.yaw;
    av.setSmoking(this.cigT > 0);
    const b = this.body;
    if (this.seat) {
      const s = SEATS[this.seat];
      const p = this.game.rig.toWorld(s.body, s.sit);
      av.group.position.set(p.x, p.y - 0.62, p.z);
      const q = s.body === 'truck' ? this.game.rig.truck.quaternion : this.game.rig.trailer.quaternion;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      av.yaw = yaw + (this.seat === 'tiller' ? Math.PI : 0);
      this.yaw = av.yaw;
    } else {
      av.group.position.set(b.position.x, b.position.y - 0.34, b.position.z);
    }
    const hv = Math.hypot(b.velocity.x - this.platformVel.x, b.velocity.z - this.platformVel.z);
    av.anim.speed = this.seat ? 0 : hv;
    av.anim.grounded = this.grounded || !!this.seat;
    av.anim.seated = !!this.seat;
    av.anim.carrying = this.held ? this.game.items.get(this.held)?.type : null;
    av.anim.action = this.action ? this.action.anim : this.lifting ? 'lift' : null;
    av.update(dt, time);
  }
}

export function damped(v, t, dt) {
  return damp(v, t, 12, dt);
}
