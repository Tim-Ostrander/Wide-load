// The rig: a tractor (6 wheels) towing a steerable lowboy trailer carrying
// Dolores's tank. Physics are cannon-es raycast vehicles joined at the fifth
// wheel. The peer that owns the rig simulates it; everyone else follows
// snapshots with the bodies switched to kinematic.
import { THREE, CANNON } from '../lib.js';
import { G } from '../physics.js';
import { clamp, damp, lerp } from '../util/rng.js';
import { createTruckModel, createTrailerModel, createWheelModel, STRAP_Z, STRAP_SIDE } from './models.js';

export const TRUCK = {
  mass: 9000,
  groundY: 0.97,
  fifth: new CANNON.Vec3(0, 0.45, -2.4),
  wheels: [
    // [x, z, radius, steer, drive]
    [1.05, 3.6, 0.55, true, false], [-1.05, 3.6, 0.55, true, false],
    [1.05, -1.7, 0.55, false, true], [-1.05, -1.7, 0.55, false, true],
    [1.05, -3.1, 0.55, false, true], [-1.05, -3.1, 0.55, false, true],
  ],
  rest: 0.42,
};
export const TRAILER = {
  mass: 16000,
  groundY: 0.85,
  kingpinUp: new CANNON.Vec3(0, 0.57, 7.4),
  bedDrop: 0.55,
  wheels: [
    [1.05, -4.9, 0.5], [-1.05, -4.9, 0.5], [1.05, -6.1, 0.5], [-1.05, -6.1, 0.5],
  ],
  rest: 0.35,
  tank: { half: [1.3, 1.8, 3.9], center: [0, 2.0, -0.2] },
};

export const SEATS = {
  driver: { body: 'truck', door: [1.75, -0.6, 1.8], sit: [0.55, 1.35, 1.9] },
  passenger: { body: 'truck', door: [-1.75, -0.6, 1.8], sit: [-0.55, 1.35, 1.9] },
  tiller: { body: 'trailer', door: [1.35, -0.5, -6.45], sit: [0, 0.85, -6.45] },
};

const MAX_FWD_KMH = 46;
const MAX_LOW_KMH = 12;
const MAX_REV_KMH = 11;
const ENGINE_F = 17000; // per drive wheel
const BRAKE = 360;
const SLOSH_W = 2.35; // natural frequency rad/s
const SLOSH_Z = 0.09;
const SLOSH_L = 1.35; // metres of surface shift per 1 g
const SLOSH_MASS = 7000;

function wheelOpts(radius, rest, stiffness) {
  return {
    radius,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    axleLocal: new CANNON.Vec3(1, 0, 0),
    suspensionStiffness: stiffness,
    suspensionRestLength: rest,
    frictionSlip: 1.7,
    dampingRelaxation: 3.4,
    dampingCompression: 4.6,
    maxSuspensionForce: 1e7,
    rollInfluence: 0.03,
    maxSuspensionTravel: 0.32,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
    chassisConnectionPointLocal: new CANNON.Vec3(),
  };
}

export function defaultRigState() {
  return {
    fuel: 58,
    water: 100,
    health: 100,
    straps: [100, 100, 100, 100],
    tires: new Array(10).fill(100),
    bed: 0, // 0 = up, 1 = down
    bedTarget: 0,
    tillerAuto: true,
    horn: false,
    lights: false,
    beacons: true,
    tank: true, // still attached
    zaps: 0,
    hits: 0,
    spill: 0,
  };
}

export class Rig {
  constructor(game) {
    this.game = game;
    const { world, mats } = game.physics;
    this.world = world;
    this.state = defaultRigState();
    this.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false, tiller: 0 };
    this.steerAngle = 0;
    this.rearAngle = 0;
    this.slosh = { x: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0 };
    this.owner = true;
    this.speed = 0; // m/s signed (forward +)
    this.rpm = 0;
    this._prevTankVel = new CANNON.Vec3();
    this._prevTrailerVy = 0;
    this.events = []; // local effect events: {type, ...}

    const mask = G.GROUND | G.PROP | G.ITEM | G.PLAYER | G.DEBRIS;
    // truck body
    this.truck = new CANNON.Body({ mass: TRUCK.mass, material: mats.rig, collisionFilterGroup: G.RIG, collisionFilterMask: mask, allowSleep: false });
    this.truck.addShape(new CANNON.Box(new CANNON.Vec3(1.15, 0.3, 4.15)), new CANNON.Vec3(0, 0, 0.25));
    this.truck.addShape(new CANNON.Box(new CANNON.Vec3(1.25, 1.15, 1.2)), new CANNON.Vec3(0, 1.45, 1.8));
    this.truck.addShape(new CANNON.Box(new CANNON.Vec3(1.0, 0.52, 0.8)), new CANNON.Vec3(0, 0.84, 3.75));
    this.truck.linearDamping = 0.02;
    this.truck.angularDamping = 0.2;
    // trailer body
    this.trailer = new CANNON.Body({ mass: TRAILER.mass, material: mats.rig, collisionFilterGroup: G.RIG, collisionFilterMask: mask, allowSleep: false });
    // thinner than the visual deck so a lowered bed doesn't scrape on bumps
    this.trailer.addShape(new CANNON.Box(new CANNON.Vec3(1.3, 0.12, 6.3)), new CANNON.Vec3(0, 0.08, -1.0));
    this.trailer.addShape(new CANNON.Box(new CANNON.Vec3(1.15, 0.31, 1.65)), new CANNON.Vec3(0, 0.9, 6.6));
    const th = TRAILER.tank.half;
    this.tankShape = new CANNON.Box(new CANNON.Vec3(th[0], th[1], th[2]));
    this.trailer.addShape(this.tankShape, new CANNON.Vec3(...TRAILER.tank.center));
    this.trailer.addShape(new CANNON.Box(new CANNON.Vec3(0.8, 0.72, 0.65)), new CANNON.Vec3(0, 0.95, -6.45));
    this.trailer.linearDamping = 0.02;
    this.trailer.angularDamping = 0.25;

    // vehicles
    this.truckVeh = new CANNON.RaycastVehicle({ chassisBody: this.truck, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const [x, z, r] of TRUCK.wheels) {
      const o = wheelOpts(r, TRUCK.rest, 42);
      o.chassisConnectionPointLocal.set(x, 0, z);
      this.truckVeh.addWheel(o);
    }
    this.trailerVeh = new CANNON.RaycastVehicle({ chassisBody: this.trailer, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const [x, z, r] of TRAILER.wheels) {
      const o = wheelOpts(r, TRAILER.rest, 44);
      o.chassisConnectionPointLocal.set(x, 0, z);
      this.trailerVeh.addWheel(o);
    }
    for (const w of this.allWheels()) w.baseRadius = w.radius;

    this.hitch = new CANNON.PointToPointConstraint(this.truck, TRUCK.fifth, this.trailer, TRAILER.kingpinUp.clone(), 1e8);

    // wheel rays ignore the rig, players and debris
    const rayMask = G.GROUND | G.ITEM | G.PROP;
    const rayOpts = { skipBackfaces: true, collisionFilterMask: rayMask, checkCollisionResponse: true };
    this._rayProxy = { rayTest: (from, to, result) => world.raycastClosest(from, to, rayOpts, result) };

    this.truck.addEventListener('collide', (e) => this._onCollide(e, 'truck'));
    this.trailer.addEventListener('collide', (e) => this._onCollide(e, 'trailer'));

    this._buildVisuals(game.scene);
    this.addToWorld();
  }

  allWheels() {
    return [...this.truckVeh.wheelInfos, ...this.trailerVeh.wheelInfos];
  }

  addToWorld() {
    this.truckVeh.addToWorld(this.world);
    this.trailerVeh.addToWorld(this.world);
    this.truckVeh.world = this._rayProxy;
    this.trailerVeh.world = this._rayProxy;
    this.world.addConstraint(this.hitch);
    this.owner = true;
  }

  /** Switch between simulating (owner) and following snapshots. */
  setOwner(owner) {
    if (owner === this.owner) return;
    this.owner = owner;
    for (const b of [this.truck, this.trailer]) {
      if (owner) {
        b.type = CANNON.Body.DYNAMIC;
        b.mass = b === this.truck ? TRUCK.mass : TRAILER.mass;
      } else {
        b.type = CANNON.Body.KINEMATIC;
        b.mass = 0;
      }
      b.updateMassProperties();
      b.wakeUp();
    }
    if (owner) {
      this.world.addEventListener('preStep', this.truckVeh.preStepCallback);
      this.world.addEventListener('preStep', this.trailerVeh.preStepCallback);
      if (!this.world.constraints.includes(this.hitch)) this.world.addConstraint(this.hitch);
    } else {
      this.world.removeEventListener('preStep', this.truckVeh.preStepCallback);
      this.world.removeEventListener('preStep', this.trailerVeh.preStepCallback);
      this.world.removeConstraint(this.hitch);
    }
  }

  /** Place the rig on the road at sample i, facing along the road. */
  placeOnRoad(i) {
    const r = this.game.world.road;
    const yaw = r.heading(i);
    const p = r.point(i);
    const q = new CANNON.Quaternion();
    q.setFromEuler(0, yaw, 0);
    this.truck.position.set(p.x, p.y + TRUCK.groundY + 0.15, p.z);
    this.truck.quaternion.copy(q);
    // trailer centre is 9.8 m behind the truck origin along the road
    const back = Math.round(9.8 / r.ds);
    const ti = Math.max(0, i - back);
    const pt = r.point(ti);
    const tyaw = Math.atan2(p.x - pt.x, p.z - pt.z);
    const tq = new CANNON.Quaternion();
    tq.setFromEuler(0, tyaw, 0);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const tp = new THREE.Vector3(p.x, 0, p.z).addScaledVector(fwd, -2.4);
    const tf = new THREE.Vector3(Math.sin(tyaw), 0, Math.cos(tyaw));
    tp.addScaledVector(tf, -7.4);
    const th = this.game.world.heightAt(tp.x, tp.z);
    this.trailer.position.set(tp.x, Math.max(th, pt.y) + TRAILER.groundY + 0.15, tp.z);
    this.trailer.quaternion.copy(tq);
    for (const b of [this.truck, this.trailer]) {
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.force.setZero();
      b.torque.setZero();
    }
    this.slosh.x = this.slosh.z = this.slosh.vx = this.slosh.vz = 0;
    this._prevTankVel.setZero();
  }

  // ---------------------------------------------------------------- simulation

  /** Apply controls before the physics step (owner only). */
  prePhysics(dt) {
    const c = this.controls;
    const st = this.state;
    const tv = this.truckVeh;
    const fwd = new CANNON.Vec3();
    this.truck.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), fwd);
    const v = this.truck.velocity.dot(fwd);
    this.speed = v;
    const kmh = v * 3.6;

    // steering, slower at speed
    const maxSteer = 0.58 / (1 + Math.abs(v) / 14);
    const target = -c.steer * maxSteer;
    const rate = 1.4 * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    tv.setSteeringValue(this.steerAngle, 0);
    tv.setSteeringValue(this.steerAngle, 1);

    // rear steer: manual tiller input, or command steer from articulation
    let rearTarget;
    if (!st.tillerAuto || Math.abs(c.tiller) > 0.01) rearTarget = -c.tiller * 0.62;
    else rearTarget = clamp(-this.articulation() * 1.1, -0.42, 0.42) * clamp(1.4 - Math.abs(v) / 12, 0, 1);
    this.rearAngle += clamp(rearTarget - this.rearAngle, -1.0 * dt, 1.0 * dt);
    for (let k = 0; k < 4; k++) this.trailerVeh.setSteeringValue(this.rearAngle, k);

    // engine / brakes
    const low = st.bed > 0.05;
    const vmax = low ? MAX_LOW_KMH : MAX_FWD_KMH;
    let force = 0, brake = 0;
    const hasFuel = st.fuel > 0;
    if (c.throttle > 0.01) {
      if (kmh < -1.5) brake = BRAKE * c.throttle;
      else if (hasFuel) force = ENGINE_F * c.throttle * clamp((vmax - kmh) / 6, 0, 1) * (1 + clamp((12 - kmh) / 12, 0, 1) * 0.35);
    } else if (c.throttle < -0.01) {
      if (kmh > 1.5) brake = BRAKE * -c.throttle;
      else if (hasFuel) force = -ENGINE_F * 0.7 * -c.throttle * clamp((MAX_REV_KMH + kmh) / 4, 0, 1);
    } else {
      brake = Math.abs(kmh) < 2 ? 60 : 12; // engine braking / hold on slopes
    }
    if (c.handbrake) brake = BRAKE * 2.2;
    if (c.brake > 0) brake = Math.max(brake, BRAKE * c.brake);
    for (let k = 0; k < 6; k++) {
      const drive = TRUCK.wheels[k][4];
      tv.applyEngineForce(drive ? -force : 0, k);
      tv.setBrake(brake + this._flatDrag(tv.wheelInfos[k]), k);
    }
    for (let k = 0; k < 4; k++) {
      const w = this.trailerVeh.wheelInfos[k];
      this.trailerVeh.setBrake((c.handbrake ? brake : brake * 0.8) + this._flatDrag(w), k);
    }
    if (hasFuel && Math.abs(c.throttle) > 0.01) st.fuel = Math.max(0, st.fuel - Math.abs(c.throttle) * dt * 0.085);
    else if (hasFuel) st.fuel = Math.max(0, st.fuel - dt * 0.004);
    this.rpm = damp(this.rpm, hasFuel ? 0.18 + Math.abs(c.throttle) * 0.6 + Math.min(1, Math.abs(kmh) / 40) * 0.25 : 0, 4, dt);

    // bed height: move wheel mounts and the kingpin
    st.bed += clamp(st.bedTarget - st.bed, -dt * 0.35, dt * 0.35);
    const drop = st.bed * TRAILER.bedDrop;
    for (const w of this.trailerVeh.wheelInfos) w.chassisConnectionPointLocal.y = drop;
    this.hitch.pivotB.y = TRAILER.kingpinUp.y + drop;

    // jackknife limiter: resist articulation beyond ~75 degrees
    const art = this.articulation();
    const lim = 1.3;
    if (Math.abs(art) > lim) {
      const t = new CANNON.Vec3(0, (art - Math.sign(art) * lim) * 2.5e5, 0);
      this.truck.torque.vsub(t, this.truck.torque);
      this.trailer.torque.vadd(t, this.trailer.torque);
    }
    this._applySlosh(dt);
  }

  _flatDrag(w) {
    return w.flat ? 40 : 0;
  }

  articulation() {
    const a = new CANNON.Vec3(), b = new CANNON.Vec3();
    this.truck.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), a);
    this.trailer.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), b);
    const ya = Math.atan2(a.x, a.z), yb = Math.atan2(b.x, b.z);
    let d = ya - yb;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d; // + = truck turned left of trailer
  }

  _applySlosh(dt) {
    const st = this.state;
    const s = this.slosh;
    if (!st.tank) return;
    // acceleration of the tank centre, in trailer frame, including gravity
    const c = new CANNON.Vec3(...TRAILER.tank.center);
    const cw = new CANNON.Vec3();
    this.trailer.pointToWorldFrame(c, cw);
    const vel = new CANNON.Vec3();
    this.trailer.getVelocityAtWorldPoint(cw, vel);
    const acc = vel.vsub(this._prevTankVel).scale(1 / dt);
    this._prevTankVel.copy(vel);
    // effective gravity = g - a
    const geff = new CANNON.Vec3(-acc.x, -9.82 - acc.y, -acc.z);
    const gl = new CANNON.Vec3();
    this.trailer.vectorToLocalFrame(geff, gl);
    this._latAcc = damp(this._latAcc || 0, gl.x, 8, dt);
    const mag = Math.max(2, gl.length());
    const eqX = clamp((gl.x / mag) * SLOSH_L * 9.82 / 9.82, -1.4, 1.4);
    const eqZ = clamp((gl.z / mag) * SLOSH_L * 1.6, -2.2, 2.2);
    const weak = this.strapWeakness();
    const zeta = SLOSH_Z * (1 - weak * 0.6);
    const w2 = SLOSH_W * SLOSH_W;
    const ax = -w2 * (s.x - eqX) - 2 * zeta * SLOSH_W * s.vx;
    const az = -w2 * (s.z - eqZ) * 0.6 - 2 * zeta * SLOSH_W * s.vz;
    s.vx += ax * dt;
    s.vz += az * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.ax = ax;
    s.az = az;
    // reaction on the trailer: water accelerating relative to the tank pushes it back
    const m = SLOSH_MASS * (st.water / 100) * (1 + weak * 0.8);
    const fLocal = new CANNON.Vec3(-m * ax, 0, -m * az * 0.5);
    const fWorld = new CANNON.Vec3();
    this.trailer.vectorToWorldFrame(fLocal, fWorld);
    const at = new CANNON.Vec3(0, 3.0, -0.2);
    const atW = new CANNON.Vec3();
    this.trailer.vectorToWorldFrame(at, atW);
    this.trailer.applyForce(fWorld, atW);
    // weight shift: torque from displaced water mass
    const off = new CANNON.Vec3(s.x, 0, s.z);
    const offW = new CANNON.Vec3();
    this.trailer.vectorToWorldFrame(off, offW);
    const wF = new CANNON.Vec3(0, -m * 9.82, 0);
    const tq = offW.cross(wF);
    this.trailer.torque.vadd(tq, this.trailer.torque);

    // spilling over the rim
    const amp = Math.hypot(s.x, s.z * 0.5);
    const spillAt = 0.55 + (100 - st.water) / 100 * 0.9;
    if (amp > spillAt && st.water > 0) {
      const lost = (amp - spillAt) * 9 * dt;
      st.water = Math.max(0, st.water - lost);
      st.spill += lost;
      if (Math.random() < 0.3) this.events.push({ type: 'splash', x: s.x, z: s.z });
    }
  }

  strapWeakness() {
    const st = this.state;
    let missing = 0;
    for (const t of st.straps) missing += 100 - t;
    return missing / 400;
  }

  /** After the physics step (owner only): wear, damage and state. */
  postPhysics(dt) {
    const st = this.state;
    if (!st.tank) return;
    // tyres: hard hits on the suspension
    const wheels = this.allWheels();
    wheels.forEach((w, k) => {
      if (!w.isInContact || w.flat) return;
      const hit = -w.suspensionRelativeVelocity;
      if (hit > 3.6) {
        const dmg = (hit - 3.6) * 22;
        st.tires[k] = Math.max(0, st.tires[k] - dmg);
        if (st.tires[k] <= 0) this._blowTire(k);
      }
    });
    // straps: stressed by violent slosh, jolts and hard cornering
    const s = this.slosh;
    const rawJolt = Math.abs(this.trailer.velocity.y - this._prevTrailerVy) / dt;
    this._prevTrailerVy = this.trailer.velocity.y;
    this._jolt = damp(this._jolt || 0, rawJolt, 10, dt);
    const jolt = this._jolt;
    const amp = Math.hypot(s.x, s.z * 0.6);
    const latAcc = Math.abs(this._latAcc || 0);
    const stress = Math.max(0, amp - 0.75) * 7 + Math.max(0, jolt - 9) * 0.18 + Math.max(0, latAcc - 4.6) * 0.7;
    this.stress = stress;
    this.stressParts = [amp, jolt, latAcc];
    if (stress > 0) {
      for (let k = 0; k < 4; k++) {
        if (st.straps[k] <= 0) continue;
        const bias = 0.7 + ((k * 7919) % 10) / 20;
        st.straps[k] = Math.max(0, st.straps[k] - stress * 4.5 * bias * dt);
        if (st.straps[k] < 6) {
          st.straps[k] = 0;
          this.events.push({ type: 'strapSnap', k });
        }
      }
    }
    // Dolores: water level and rough ride
    if (st.water < 30) st.health = Math.max(0, st.health - (30 - st.water) * 0.012 * dt);
    if (stress > 1.5) st.health = Math.max(0, st.health - (stress - 1.5) * 0.5 * dt);
    st.water = Math.max(0, st.water - dt * 0.012); // evaporation
    // tank falls off when most straps are gone
    const snapped = st.straps.filter((t) => t <= 0).length;
    if (snapped >= 4 || (snapped >= 3 && Math.abs(s.x) > 0.7)) this.detachTank();
  }

  _blowTire(k) {
    const w = this.allWheels()[k];
    if (w.flat) return;
    w.flat = true;
    w.radius = w.baseRadius - 0.13;
    w.frictionSlip = 0.9;
    this.events.push({ type: 'blowout', k });
  }

  repairTire(k) {
    const w = this.allWheels()[k];
    w.flat = false;
    w.radius = w.baseRadius;
    w.frictionSlip = 1.7;
    this.state.tires[k] = 100;
  }

  syncTireFlags() {
    this.allWheels().forEach((w, k) => {
      const flat = this.state.tires[k] <= 0;
      if (flat !== !!w.flat) {
        w.flat = flat;
        w.radius = flat ? w.baseRadius - 0.13 : w.baseRadius;
        w.frictionSlip = flat ? 0.9 : 1.7;
      }
    });
  }

  detachTank() {
    const st = this.state;
    if (!st.tank) return;
    st.tank = false;
    const idx = this.trailer.shapes.indexOf(this.tankShape);
    if (idx >= 0) this.trailer.removeShape(this.tankShape);
    this.events.push({ type: 'tankFell' });
    this.spawnLooseTank();
  }

  /** A free tank body (visual + physics) where the tank was. */
  spawnLooseTank() {
    if (this.looseTank) return;
    const { world, mats } = this.game.physics;
    const th = TRAILER.tank.half;
    const body = new CANNON.Body({ mass: this.owner ? 9000 : 0, material: mats.rig, collisionFilterGroup: G.DEBRIS, collisionFilterMask: G.GROUND | G.PROP | G.RIG | G.PLAYER });
    body.addShape(new CANNON.Box(new CANNON.Vec3(th[0], th[1], th[2])));
    const c = new CANNON.Vec3(...TRAILER.tank.center);
    this.trailer.pointToWorldFrame(c, body.position);
    body.quaternion.copy(this.trailer.quaternion);
    this.trailer.getVelocityAtWorldPoint(body.position, body.velocity);
    const side = new CANNON.Vec3();
    this.trailer.vectorToWorldFrame(new CANNON.Vec3(Math.sign(this.slosh.x || 1) * 2.5, 0.5, 0), side);
    body.velocity.vadd(side, body.velocity);
    world.addBody(body);
    this.looseTank = body;
  }

  _onCollide(e, which) {
    if (!this.owner) return;
    const other = e.body;
    if (!other || other.collisionFilterGroup === G.PLAYER) return;
    const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const isTank = which === 'trailer' && (e.contact.si === this.tankShape || e.contact.sj === this.tankShape);
    if (other.userData?.kind) this.events.push({ type: 'hit', kind: other.userData.kind, body: other, impact, isTank });
    if (impact > 1.2) {
      const now = performance.now();
      if (!this._lastHit || now - this._lastHit > 400) {
        this._lastHit = now;
        this.events.push({ type: 'impact', impact, isTank, x: e.contact.bj.position.x });
        if (isTank) {
          this.state.health = Math.max(0, this.state.health - impact * 3);
          this.state.hits++;
        }
      }
    }
  }

  // ---------------------------------------------------------------- snapshots

  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const body = (b) => [r2(b.position.x), r2(b.position.y), r2(b.position.z), r3(b.quaternion.x), r3(b.quaternion.y), r3(b.quaternion.z), r3(b.quaternion.w), r2(b.velocity.x), r2(b.velocity.y), r2(b.velocity.z), r2(b.angularVelocity.x), r2(b.angularVelocity.y), r2(b.angularVelocity.z)];
    const st = this.state;
    const wheels = this.allWheels();
    return {
      a: body(this.truck),
      b: body(this.trailer),
      w: wheels.map((w) => r2(w.suspensionLength)),
      sa: r3(this.steerAngle),
      ra: r3(this.rearAngle),
      sp: r2(this.speed),
      rpm: r2(this.rpm),
      sl: [r2(this.slosh.x), r2(this.slosh.z)],
      st: {
        fuel: r2(st.fuel), water: r2(st.water), health: r2(st.health),
        straps: st.straps.map((t) => Math.round(t)), tires: st.tires.map((t) => Math.round(t)),
        bed: r2(st.bed), bedTarget: st.bedTarget, tillerAuto: st.tillerAuto ? 1 : 0,
        horn: st.horn ? 1 : 0, lights: st.lights ? 1 : 0, beacons: st.beacons ? 1 : 0, tank: st.tank ? 1 : 0,
        zaps: st.zaps, hits: st.hits, ov: st.ov || 0,
      },
      lt: this.looseTank ? [r2(this.looseTank.position.x), r2(this.looseTank.position.y), r2(this.looseTank.position.z), r3(this.looseTank.quaternion.x), r3(this.looseTank.quaternion.y), r3(this.looseTank.quaternion.z), r3(this.looseTank.quaternion.w)] : null,
    };
  }

  /** Adopt a full snapshot (used when taking over ownership or joining). */
  adoptState(snap) {
    const st = snap.st;
    Object.assign(this.state, {
      fuel: st.fuel, water: st.water, health: st.health, straps: [...st.straps], tires: [...st.tires],
      bed: st.bed, bedTarget: st.bedTarget, tillerAuto: !!st.tillerAuto, horn: !!st.horn, lights: !!st.lights,
      beacons: !!st.beacons, zaps: st.zaps, hits: st.hits, ov: st.ov || 0,
    });
    if (!st.tank && this.state.tank) this.detachTank();
    this.syncTireFlags();
    this.slosh.x = snap.sl[0];
    this.slosh.z = snap.sl[1];
  }

  /** Non-owner: set kinematic target from an interpolated snapshot. */
  followSnapshot(a, b, t, dt) {
    const lerpBody = (body, A, B) => {
      const px = lerp(A[0], B[0], t), py = lerp(A[1], B[1], t), pz = lerp(A[2], B[2], t);
      const qa = new THREE.Quaternion(A[3], A[4], A[5], A[6]);
      const qb = new THREE.Quaternion(B[3], B[4], B[5], B[6]);
      qa.slerp(qb, t);
      // drive kinematic body with velocity so riders are carried
      const inv = 1 / Math.max(dt, 1e-3);
      body.velocity.set((px - body.position.x) * inv, (py - body.position.y) * inv, (pz - body.position.z) * inv);
      if (body.velocity.lengthSquared() > 900) {
        body.position.set(px, py, pz);
        body.velocity.set(lerp(A[7], B[7], t), lerp(A[8], B[8], t), lerp(A[9], B[9], t));
      }
      const cur = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      const dq = qa.clone().multiply(cur.clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const ang = 2 * Math.acos(clamp(dq.w, -1, 1));
      const s = Math.sqrt(1 - dq.w * dq.w);
      if (ang > 0.8) {
        body.quaternion.set(qa.x, qa.y, qa.z, qa.w);
        body.angularVelocity.setZero();
      } else if (s > 1e-5) {
        body.angularVelocity.set((dq.x / s) * ang * inv, (dq.y / s) * ang * inv, (dq.z / s) * ang * inv);
      } else body.angularVelocity.setZero();
    };
    lerpBody(this.truck, a.a, b.a);
    lerpBody(this.trailer, a.b, b.b);
    const wheels = this.allWheels();
    wheels.forEach((w, k) => (w.suspensionLength = lerp(a.w[k], b.w[k], t)));
    this.steerAngle = lerp(a.sa, b.sa, t);
    this.rearAngle = lerp(a.ra, b.ra, t);
    this.speed = lerp(a.sp, b.sp, t);
    this.rpm = lerp(a.rpm, b.rpm, t);
    this.slosh.x = lerp(a.sl[0], b.sl[0], t);
    this.slosh.z = lerp(a.sl[1], b.sl[1], t);
    const st = b.st;
    Object.assign(this.state, {
      fuel: st.fuel, water: st.water, health: st.health, straps: st.straps, tires: st.tires, bed: st.bed,
      bedTarget: st.bedTarget, tillerAuto: !!st.tillerAuto, horn: !!st.horn, lights: !!st.lights, beacons: !!st.beacons,
      zaps: st.zaps, hits: st.hits, ov: st.ov || 0,
    });
    if (!st.tank && this.state.tank) {
      this.state.tank = false;
      const idx = this.trailer.shapes.indexOf(this.tankShape);
      if (idx >= 0) this.trailer.removeShape(this.tankShape);
      this.spawnLooseTank();
    }
    if (b.lt && this.looseTank) {
      this.looseTank.position.set(b.lt[0], b.lt[1], b.lt[2]);
      this.looseTank.quaternion.set(b.lt[3], b.lt[4], b.lt[5], b.lt[6]);
    }
    this.syncTireFlags();
    for (let k = 0; k < 6; k++) this.truckVeh.wheelInfos[k].steering = k < 2 ? this.steerAngle : 0;
    for (let k = 0; k < 4; k++) this.trailerVeh.wheelInfos[k].steering = this.rearAngle;
    const drop = this.state.bed * TRAILER.bedDrop;
    for (const w of this.trailerVeh.wheelInfos) w.chassisConnectionPointLocal.y = drop;
  }

  // ---------------------------------------------------------------- visuals

  _buildVisuals(scene) {
    this.truckModel = createTruckModel();
    this.trailerModel = createTrailerModel();
    scene.add(this.truckModel, this.trailerModel);
    this.wheelModels = [];
    for (const [, , r] of TRUCK.wheels) {
      const m = createWheelModel(r, 0.5);
      scene.add(m);
      this.wheelModels.push(m);
    }
    for (const [, , r] of TRAILER.wheels) {
      const m = createWheelModel(r, 0.5);
      scene.add(m);
      this.wheelModels.push(m);
    }
    this.looseTankModel = null;
  }

  updateVisuals(dt, time) {
    const copy = (obj, b) => {
      obj.position.set(b.position.x, b.position.y, b.position.z);
      obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    };
    copy(this.truckModel, this.truck);
    copy(this.trailerModel, this.trailer);
    // wheels
    const wheels = this.allWheels();
    const spin = (this.speed * dt) ;
    for (let k = 0; k < wheels.length; k++) {
      const w = wheels[k];
      if (!this.owner) w.rotation = (w.rotation || 0) - spin / w.radius;
      const veh = k < 6 ? this.truckVeh : this.trailerVeh;
      veh.updateWheelTransform(k < 6 ? k : k - 6);
      const t = w.worldTransform;
      const m = this.wheelModels[k];
      m.position.set(t.position.x, t.position.y, t.position.z);
      m.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
      const flat = !!w.flat;
      m.userData.mesh.scale.set(1, flat ? 0.8 : 1, flat ? 1.08 : 1);
      m.userData.mesh.position.y = flat ? -0.08 : 0;
    }
    const st = this.state;
    // beacons
    const on = st.beacons;
    const pulse = on ? 0.4 + 0.6 * Math.max(0, Math.sin(time * 9)) : 0.05;
    this.truckModel.userData.beaconMat.emissiveIntensity = pulse * 2.2;
    this.trailerModel.userData.beaconMat.emissiveIntensity = (on ? 0.4 + 0.6 * Math.max(0, Math.sin(time * 9 + 1.6)) : 0.05) * 2.2;
    for (const s of this.truckModel.userData.lights.children) if (s.isSpotLight) s.intensity = st.lights ? 60 : 0;
    // water and Dolores
    const ud = this.trailerModel.userData;
    const lvl = Math.max(0.02, st.water / 100) * 3.1;
    ud.waterBody.scale.y = lvl;
    ud.waterBody.position.y = lvl / 2;
    ud.water.visible = st.tank;
    ud.glass.visible = st.tank;
    const sx = this.slosh.x, sz = this.slosh.z;
    ud.surface.position.y = lvl;
    ud.surface.rotation.z = Math.atan2(sx, 1.4) * 0.9;
    ud.surface.rotation.x = -Math.atan2(sz, 5) * 0.9;
    const pos = ud.surface.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      pos.setY(k, Math.sin(x * 3 + time * 3.1) * 0.03 + Math.sin(z * 1.7 - time * 2.3) * 0.04);
    }
    pos.needsUpdate = true;
    const wh = ud.whale;
    wh.visible = st.tank;
    const bob = Math.sin(time * 1.3) * 0.06;
    wh.position.y = 0.36 + Math.min(lvl - 0.85, 1.75) + bob;
    wh.position.x = sx * 0.5;
    wh.rotation.z = Math.atan2(sx, 1.4) * 0.6;
    wh.rotation.x = -Math.atan2(sz, 5) * 0.8;
    const wd = wh.userData;
    const beat = Math.sin(time * (2.2 + Math.abs(this.speed) * 0.08));
    wd.tail.rotation.x = beat * 0.18;
    wd.flukePivot.rotation.x = beat * 0.35;
    wd.bodyPivot.rotation.y = Math.sin(time * 0.37) * 0.08;
    // straps
    ud.straps.forEach((s, k) => {
      const t = st.straps[k];
      const snapped = t <= 0;
      const u = s.userData;
      u.top.visible = u.l.visible = u.r.visible = !snapped && st.tank;
      u.loose.visible = snapped && st.tank;
      u.ratchet.visible = st.tank;
      u.loose.rotation.z = Math.sin(time * 7 + k) * 0.25;
      u.top.material.color.setHex(t > 45 ? 0xf2c21b : t > 20 ? 0xf08a1c : 0xd8352a);
    });
    // loose tank
    if (this.looseTank) {
      if (!this.looseTankModel) {
        this.looseTankModel = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 7.8), new THREE.MeshStandardMaterial({ color: 0x4c6a7a, transparent: true, opacity: 0.6 }));
        this.looseTankModel.add(box);
        this.game.scene.add(this.looseTankModel);
        // Dolores leaves with the tank
        const whale = ud.whale;
        this.trailerModel.remove(whale);
        whale.position.set(0, 0, 0);
        whale.rotation.set(0, 0, 0);
        this.looseTankModel.add(whale);
        whale.visible = true;
      }
      copy(this.looseTankModel, this.looseTank);
    }
  }

  /** World position of a point in truck/trailer local space. */
  toWorld(which, local, out = new THREE.Vector3()) {
    const b = which === 'truck' ? this.truck : this.trailer;
    const v = new CANNON.Vec3(local[0], local[1], local[2]);
    const w = new CANNON.Vec3();
    b.pointToWorldFrame(v, w);
    return out.set(w.x, w.y, w.z);
  }

  /** Interaction anchors on the rig (world space). */
  anchors() {
    const out = [];
    const wheels = this.allWheels();
    wheels.forEach((w, k) => {
      const t = w.worldTransform.position;
      out.push({ kind: 'tire', k, pos: new THREE.Vector3(t.x, t.y, t.z) });
    });
    STRAP_Z.forEach((z, k) => {
      out.push({ kind: 'strap', k, pos: this.toWorld('trailer', [1.45 * STRAP_SIDE[k], 0.45, z]) });
    });
    out.push({ kind: 'toolbox', pos: this.toWorld('truck', [1.5, 0.2, -0.72]) });
    out.push({ kind: 'fuelcap', pos: this.toWorld('truck', [-1.6, 0.3, 0.25]) });
    out.push({ kind: 'ladder', pos: this.toWorld('trailer', [1.3, 0.4, -4.3]), top: this.toWorld('trailer', [0.78, 4.0, -3.6]) });
    out.push({ kind: 'ladderTop', pos: this.toWorld('trailer', [0.78, 4.1, -3.7]), bottom: this.toWorld('trailer', [1.6, -0.3, -4.5]) });
    out.push({ kind: 'tankGate', pos: this.toWorld('trailer', [0, 1.2, -4.3]) });
    for (const [name, s] of Object.entries(SEATS)) out.push({ kind: 'seat', seat: name, pos: this.toWorld(s.body, s.door) });
    return out;
  }

  tankTopY() {
    return this.toWorld('trailer', [0, 3.85, 0]).y;
  }

  /** Points along the top of the tank (for wire/overpass checks). */
  tankTopPoints() {
    const pts = [];
    for (const z of [3.6, 1.2, -1.2, -3.9]) for (const x of [1.2, -1.2]) pts.push(this.toWorld('trailer', [x, 3.85, z]));
    return pts;
  }

  center(out = new THREE.Vector3()) {
    return out.set((this.truck.position.x + this.trailer.position.x) / 2, (this.truck.position.y + this.trailer.position.y) / 2, (this.truck.position.z + this.trailer.position.z) / 2);
  }
}
