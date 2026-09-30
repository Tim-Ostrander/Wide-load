// Crew members: the avatar model (shared by local and remote players) and the
// local player's physics controller.
import { THREE, CANNON } from './lib.js';
import { ModelBuilder, flatMaterial } from './util/geo.js';
import { G } from './physics.js';
import { clamp, damp, angleDiff } from './util/rng.js';
import { SEATS } from './rig/rig.js';

export const HAT_COLORS = [0xf5c518, 0xe8572a, 0x3fb6c9, 0x8bc34a, 0xe86fa8, 0xf3efe2];
export const HAT_NAMES = ['Yellow', 'Orange', 'Teal', 'Lime', 'Pink', 'White'];
const SKIN = [0xf2c29a, 0xc98f67, 0x9a6444, 0xffd6b5];

function limb(len, w, color, bootColor) {
  const g = new THREE.Group();
  const mb = new ModelBuilder();
  mb.box(w, len, w, color, [0, -len / 2, 0]);
  if (bootColor !== undefined) mb.box(w * 1.1, 0.16, w * 1.6, bootColor, [0, -len + 0.06, 0.06]);
  const m = mb.mesh(flatMaterial());
  g.add(m);
  return g;
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

export class Avatar {
  constructor(scene, colorIdx = 0, name = 'Crew', { local = false } = {}) {
    this.scene = scene;
    this.colorIdx = colorIdx;
    this.name = name;
    const hat = HAT_COLORS[colorIdx % HAT_COLORS.length];
    const skin = SKIN[(colorIdx * 3 + name.length) % SKIN.length];
    const g = new THREE.Group();
    this.group = g;
    const body = new THREE.Group();
    body.position.y = 0.95;
    g.add(body);
    this.body = body;
    const tb = new ModelBuilder();
    tb.box(0.5, 0.62, 0.3, 0x2f4a73, [0, 0.3, 0]); // overalls
    tb.box(0.54, 0.46, 0.34, 0xff9a1f, [0, 0.46, 0]); // hi-vis vest
    tb.box(0.55, 0.05, 0.35, 0xe8e8e0, [0, 0.36, 0]);
    tb.box(0.55, 0.05, 0.35, 0xe8e8e0, [0, 0.54, 0]);
    tb.box(0.36, 0.16, 0.26, 0x2f4a73, [0, -0.02, 0]);
    const torso = tb.mesh(flatMaterial());
    body.add(torso);
    const head = new THREE.Group();
    head.position.y = 0.72;
    const hb = new ModelBuilder();
    hb.box(0.3, 0.32, 0.3, skin, [0, 0.16, 0]);
    hb.box(0.06, 0.05, 0.02, 0x222222, [0.07, 0.2, 0.155]);
    hb.box(0.06, 0.05, 0.02, 0x222222, [-0.07, 0.2, 0.155]);
    hb.cyl(0.21, 0.23, 0.14, 10, hat, [0, 0.37, 0]);
    hb.box(0.46, 0.03, 0.46, hat, [0, 0.31, 0.02]);
    head.add(hb.mesh(flatMaterial()));
    head.scale.setScalar(1.35); // big-headed cartoon crew
    body.add(head);
    this.head = head;
    this.armL = limb(0.62, 0.13, 0xf7a21b);
    this.armR = limb(0.62, 0.13, 0xf7a21b);
    this.armL.position.set(0.34, 0.62, 0);
    this.armR.position.set(-0.34, 0.62, 0);
    body.add(this.armL, this.armR);
    this.legL = limb(0.9, 0.17, 0x2f4a73, 0x3b2a1d);
    this.legR = limb(0.9, 0.17, 0x2f4a73, 0x3b2a1d);
    this.legL.position.set(0.13, 0.0, 0);
    this.legR.position.set(-0.13, 0.0, 0);
    body.add(this.legL, this.legR);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (!local) {
      this.tag = nameSprite(name, hat);
      this.tag.position.y = 2.55;
      g.add(this.tag);
    }
    scene.add(g);
    this.phase = 0;
    this.anim = { speed: 0, grounded: true, seated: false, carrying: null, action: null };
    this.yaw = 0;
    this.bubble = null;
  }

  dispose() {
    this.scene.remove(this.group);
  }

  setVisible(v) {
    this.group.visible = v;
  }

  update(dt, time) {
    const a = this.anim;
    const g = this.group;
    g.rotation.y = this.yaw;
    const moving = a.speed > 0.4 && a.grounded && !a.seated;
    this.phase += dt * (moving ? 2.2 + a.speed * 1.35 : 0);
    const sw = moving ? Math.sin(this.phase) * clamp(a.speed / 5, 0.3, 0.9) : 0;
    let armL = -sw * 0.8, armR = sw * 0.8, legL = sw, legR = -sw, bodyY = 0.95, lean = moving ? a.speed * 0.02 : 0;
    let armSpreadL = 0, armSpreadR = 0;
    if (!a.grounded && !a.seated) {
      legL = 0.5;
      legR = -0.2;
      armL = armR = -0.9;
    }
    if (a.seated) {
      legL = legR = -1.45;
      armL = armR = -1.1;
      bodyY = 0.62;
    }
    if (a.carrying) {
      const heavy = a.carrying === 'plank' || a.carrying === 'post';
      if (heavy) {
        armL = -2.8; // up to the shoulder
        armR = -0.4 + sw * 0.3;
      } else if (a.carrying === 'hotstick') {
        armL = -1.2;
        armR = -1.0;
      } else {
        armL = armR = -1.0;
        armSpreadL = 0.25;
        armSpreadR = -0.25;
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
        bodyY = 0.8;
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
        armR = -2.6 + Math.sin(time * 12) * 0.35;
        break;
    }
    const k = Math.min(1, dt * 14);
    this.armL.rotation.x += (armL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (armSpreadL - this.armL.rotation.z) * k;
    this.armR.rotation.z += (armSpreadR - this.armR.rotation.z) * k;
    this.legL.rotation.x += (legL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * k;
    this.body.position.y += (bodyY + (moving ? Math.abs(Math.cos(this.phase)) * 0.05 : 0) - this.body.position.y) * k;
    this.body.rotation.x += (lean - this.body.rotation.x) * k;
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
        local.set(0.3, 1.72, 0.9);
        rot.set(0, 0, 0.1);
        break;
      case 'post':
        local.set(0.3, 1.7, 0.3);
        rot.set(Math.PI / 2, 0, 0);
        break;
      case 'hotstick':
        local.set(-0.1, 1.5, 1.6);
        rot.set(this.anim.action === 'lift' ? -1.2 : -0.35, 0, 0);
        if (this.anim.action === 'lift') local.set(0, 2.9, 0.6);
        break;
      case 'tire':
        local.set(0, 1.05, 0.55);
        rot.set(0, Math.PI / 2, 0);
        break;
      case 'chainsaw':
        local.set(-0.1, 1.05, 0.55);
        break;
      default:
        local.set(0, 1.0, 0.45);
    }
    mesh.position.copy(local.applyMatrix4(g.matrixWorld));
    mesh.quaternion.setFromEuler(rot).premultiply(g.getWorldQuaternion(new THREE.Quaternion()));
  }

  say(text) {
    if (this.bubble) this.group.remove(this.bubble.sprite);
    const s = nameSprite(text, HAT_COLORS[this.colorIdx % HAT_COLORS.length]);
    s.scale.set(2.6, 0.65, 1);
    s.position.y = 2.95;
    this.group.add(s);
    this.bubble = { sprite: s, life: 4 };
  }
}

/** The local player's body and movement. */
export class LocalPlayer {
  constructor(game, colorIdx, name) {
    this.game = game;
    this.avatar = new Avatar(game.scene, colorIdx, name, { local: true });
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
  }

  get position() {
    return this.body.position;
  }

  setLook(colorIdx, name) {
    const old = this.avatar;
    this.avatar = new Avatar(this.game.scene, colorIdx, name, { local: true });
    this.avatar.yaw = old.yaw;
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
