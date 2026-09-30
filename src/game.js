// Game: owns the renderer and simulation, runs host rules, rig ownership,
// interactions and state sync.
import { THREE, CANNON } from './lib.js';
import { createPhysics } from './physics.js';
import { World } from './world/world.js';
import { followSun } from './world/env.js';
import { Structures } from './world/structures.js';
import { Rig, SEATS, TRAILER, defaultRigState } from './rig/rig.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Items, INITIAL_ITEMS } from './items.js';
import { LocalPlayer, Avatar } from './player.js';
import { Fx } from './fx.js';
import { clamp } from './util/rng.js';

export const STEP = 1 / 60;
const SEAT_CODES = { driver: 'd', passenger: 'p', tiller: 't' };
const SEAT_BY_CODE = { d: 'driver', p: 'passenger', t: 'tiller' };
export const FINES = { power: 1500, overpass: 800, mailbox: 150, car: 600, tow: 1500, bridge: 2500 };
export const PAY = 12000;
export const QUICK_CHAT = ['Stop!', 'Go, go, go!', 'Slow down!', 'Turn left!', 'Turn right!', 'Need a hand here!'];

const yawOf = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

export class Game {
  constructor(view, opts) {
    this.view = view;
    this.opts = opts;
    this.session = opts.session;
    this.hud = opts.hud;
    this.audio = opts.audio;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, opts.lowGfx ? 1 : 2));
    renderer.setSize(view.clientWidth, view.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    view.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, view.clientWidth / view.clientHeight, 0.1, 3000);
    this.physics = createPhysics();
    this.world = new World(this.scene, this.physics);
    this.structures = new Structures(this, this.world);
    this.rig = new Rig(this);
    this.items = new Items(this);
    this.fx = new Fx(this.scene);
    this.input = new Input(renderer.domElement);
    this.cam = new CameraRig(this.camera, this.world);
    const r = this.world.road;
    this.startIndex = r.places.depot + 22;
    this.checkpoints = this._checkpoints();
    this.itemDefs = INITIAL_ITEMS(this.structures, r);
    this.player = new LocalPlayer(this, opts.color ?? 0, opts.name || 'You');
    this.remotes = new Map();
    this.time = 0;
    this.acc = 0;
    this.last = performance.now();
    this.simSpeed = 1;
    this.maxSteps = 6;
    this.autopilot = null;
    this.mode = opts.mode || 'intro'; // intro (title backdrop) | play
    this.paused = false;
    this.prev = {};
    this.hold = null;
    this.cand = { e: null, f: null };
    this.ping = null;
    this.say = null;
    this.W = null;
    this.releaseAnim = null;
    this.lifting = false;
    this.waving = 0;
    this._zapCool = 0;
    this._ovCool = 0;
    this.creak = 0;
    this.lastRo = null;
    this.ready = this.session.isHost;
    this.session.onAction((peer, dom, type, args) => this._onAction(peer, dom, type, args));
    this.session.onPeerLeave = (peer) => this._peerLeft(peer);
    this.session.onHostLost = () => this.hud?.hostLost();
    this.resetJob(true);
    addEventListener('resize', () => this.resize());
    this._frame = this._frame.bind(this);
  }

  /** Swap between solo and a co-op room without rebuilding the world. */
  setSession(session, profile) {
    this.session = session;
    session.onAction((peer, dom, type, args) => this._onAction(peer, dom, type, args));
    session.onPeerLeave = (peer) => this._peerLeft(peer);
    session.onHostLost = () => this.hud?.hostLost();
    for (const rem of this.remotes.values()) rem.avatar.dispose();
    this.remotes.clear();
    this.W = null;
    this.ready = session.isHost;
    this.lastRo = null;
    this.sessionAt = performance.now();
    this._hostLostShown = false;
    if (profile) this.player.setLook(profile.color, profile.name);
    this.resetJob(true);
  }

  _checkpoints() {
    const p = this.world.road.places;
    return [
      { i: this.startIndex, name: 'Depot' },
      { i: p.tree + 24, name: 'Past the fallen tree' },
      { i: p.lines + 26, name: 'Past the power lines' },
      { i: p.overpass + 30, name: 'Past the rail bridge' },
      { i: p.station + 12, name: 'Gas station' },
      { i: p.bridge + 30, name: 'Across the creek' },
      { i: p.washout + 30, name: 'Across the washout' },
      { i: p.hairpins + 4, name: 'Top of the switchbacks' },
      { i: p.town, name: 'Gull Harbor' },
    ];
  }

  freshWorldState(resetCount = 0) {
    return {
      ph: 'play',
      why: '',
      jt: 0,
      ro: this.session.me,
      re: 1,
      seats: { d: null, p: null, t: null },
      ob: { tree: 0, lines: [0, 0, 0], br: [0, 0], wo: 0 },
      fines: {},
      prog: this.startIndex,
      tow: 0,
      towTo: this.startIndex,
      rel: 0,
      reset: resetCount,
    };
  }

  /** Host: reset everything. Everyone: local reset when the reset counter moves. */
  resetJob(initial = false) {
    if (this.session.isHost) {
      const n = this.W ? this.W.reset + 1 : 0;
      this.W = this.freshWorldState(n);
    }
    this.items.reset(this.itemDefs);
    this.structures.setTreeCut(false);
    this.structures.setLines({ lifted: 0, hooked: false, broken: false });
    this.structures.setBridge(0, false);
    this.structures.setWashout(0);
    for (const p of this.structures.props) {
      p.body.position.copy(p.home);
      p.body.quaternion.copy(p.homeQ || p.body.quaternion);
      p.body.velocity.setZero();
      p.body.angularVelocity.setZero();
      p.knocked = false;
    }
    this._resetRig();
    this.spawnPlayer();
    this.player.held = null;
    this.player.action = null;
    this.hold = null;
    this.releaseAnim = null;
    this.prev = {};
    this.creak = 0;
    this._lastReset = this.ws()?.reset ?? 0;
    if (!initial) this.hud?.toast('New job: get Dolores to Gull Harbor.');
  }

  spawnPlayer() {
    const n = this.session.solo ? 0 : [...this.session.peers.keys()].length;
    const door = this.rig.toWorld('truck', [3.4 + (n % 3) * 1.2, 0, 0.5 - Math.floor(n / 3) * 1.5]);
    door.y = this.world.heightAt(door.x, door.z) + 0.5;
    if (this.player.seat) this.player.stand(door);
    else this.player.teleport(door, this.world.road.heading(this.startIndex));
  }

  _resetRig() {
    const rig = this.rig;
    const ud = rig.trailerModel.userData;
    if (rig.looseTank) {
      this.physics.world.removeBody(rig.looseTank);
      rig.looseTank = null;
    }
    if (rig.looseTankModel) {
      this.scene.remove(rig.looseTankModel);
      rig.looseTankModel = null;
    }
    if (ud.whale.parent !== rig.trailerModel) {
      ud.whale.parent?.remove(ud.whale);
      rig.trailerModel.add(ud.whale);
    }
    ud.whale.position.set(0, 2.0, -0.2);
    ud.whale.rotation.set(0, 0, 0);
    ud.whale.visible = true;
    if (!rig.trailer.shapes.includes(rig.tankShape)) rig.trailer.addShape(rig.tankShape, new CANNON.Vec3(...TRAILER.tank.center));
    rig.state = defaultRigState();
    rig.allWheels().forEach((w, k) => rig.repairTire(k));
    rig.placeOnRoad(this.startIndex);
  }

  resize() {
    const w = this.view.clientWidth, h = this.view.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    requestAnimationFrame(this._frame);
  }

  _frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    try {
      if (!(this.paused && this.session.solo)) {
        this.acc += dt * this.simSpeed;
        let steps = 0;
        while (this.acc >= STEP && steps < this.maxSteps) {
          this.fixedUpdate(STEP);
          this.acc -= STEP;
          steps++;
          this.time += STEP;
        }
        if (steps === this.maxSteps) this.acc = 0;
      }
      this.update(dt, now);
    } catch (err) {
      console.error(err);
      if (!this._errShown) {
        this._errShown = true;
        this.hud?.toast('Something went wrong in the simulation. Check the console.');
      }
    }
    this.input.endFrame();
    requestAnimationFrame(this._frame);
  }

  // ------------------------------------------------------------------ state

  /** The world state as this peer currently knows it. */
  ws() {
    if (this.session.isHost) return this.W;
    return this.session.hostPresence()?.W || null;
  }

  rigOwner() {
    const W = this.ws();
    return W ? W.ro : this.session.host;
  }

  seatOf(peer) {
    const W = this.ws();
    if (!W) return null;
    for (const [c, p] of Object.entries(W.seats)) if (p === peer) return SEAT_BY_CODE[c];
    return null;
  }

  // ------------------------------------------------------------------ simulation

  fixedUpdate(h) {
    const rig = this.rig;
    const s = this.session;
    const W = this.ws();
    if (!this.ready && W) {
      this.ready = true;
      this._lastReset = W.reset;
    }
    // rig ownership follows the driver's seat
    const ro = this.rigOwner();
    const mine = ro === s.me;
    if (mine !== rig.owner) {
      if (mine) {
        const snap = this.lastRo && this.lastRo !== s.me ? s.latestRig?.(this.lastRo) : null;
        if (snap) {
          const setB = (b, A) => {
            b.position.set(A[0], A[1], A[2]);
            b.quaternion.set(A[3], A[4], A[5], A[6]);
          };
          setB(rig.truck, snap.a);
          setB(rig.trailer, snap.b);
          rig.adoptState(snap);
        }
        rig.setOwner(true);
        if (snap) {
          rig.truck.velocity.set(snap.a[7], snap.a[8], snap.a[9]);
          rig.trailer.velocity.set(snap.b[7], snap.b[8], snap.b[9]);
          rig.truck.angularVelocity.set(snap.a[10], snap.a[11], snap.a[12]);
          rig.trailer.angularVelocity.set(snap.b[10], snap.b[11], snap.b[12]);
        }
      } else rig.setOwner(false);
    }
    this.lastRo = ro;

    // local player movement
    const inp = this.input;
    const typing = this.hud?.typing;
    const onFoot = !this.player.seat && this.mode === 'play' && !typing && !this.paused;
    const ctl = {
      x: onFoot ? inp.axis('KeyA', 'KeyD') : 0,
      z: onFoot ? inp.axis('KeyS', 'KeyW') : 0,
      jump: onFoot && inp.down('Space'),
      sprint: inp.down('ShiftLeft') || inp.down('ShiftRight'),
    };
    this.player.fixedUpdate(h, ctl, this.cam.yaw);

    // rig controls
    if (rig.owner) {
      const c = rig.controls;
      const driver = W ? W.seats.d : null;
      if (this.autopilot) this.autopilot(h);
      else if (driver === s.me && !typing && !this.paused) {
        c.throttle = inp.axis('KeyS', 'KeyW');
        c.steer = inp.axis('KeyA', 'KeyD');
        c.handbrake = inp.down('Space');
      } else if (!driver) {
        c.throttle = 0;
        c.steer = 0;
        c.handbrake = true;
      } else if (driver !== s.me) {
        const pr = s.presenceOf(driver);
        c.throttle = pr?.in?.[0] ?? 0;
        c.steer = pr?.in?.[1] ?? 0;
        c.handbrake = !!pr?.in?.[2];
      } else {
        c.throttle = 0;
        c.steer = 0;
      }
      const tillerPeer = W ? W.seats.t : null;
      if (tillerPeer === s.me) c.tiller = typing || this.paused ? 0 : inp.axis('KeyA', 'KeyD');
      else if (tillerPeer) c.tiller = s.presenceOf(tillerPeer)?.in?.[3] ?? 0;
      else c.tiller = 0;
      if (W && W.ph !== 'play') {
        c.throttle = 0;
        c.handbrake = true;
      }
      rig.prePhysics(h);
    } else {
      const sm = s.rigSample?.(ro);
      if (sm) rig.followSnapshot(sm.a, sm.b, sm.u, h);
      else {
        rig.truck.velocity.setZero();
        rig.trailer.velocity.setZero();
        rig.truck.angularVelocity.setZero();
        rig.trailer.angularVelocity.setZero();
      }
    }

    this.physics.world.step(h);

    if (rig.owner) {
      rig.postPhysics(h);
      this._ownerChecks(h);
    }
    if (s.isHost) this._hostRules(h);
  }

  /** Rig-owner checks: the wires and the rail bridge. */
  _ownerChecks(h) {
    const rig = this.rig;
    const st = rig.state;
    const W = this.ws();
    if (!W || !st.tank) return;
    this._zapCool -= h;
    this._ovCool -= h;
    const [, hooked, broken] = W.ob.lines;
    const S = this.structures;
    if (!broken && !hooked && this._zapCool <= 0) {
      const f = S.spots.lines;
      const fwd = S.wireEnds.fwd;
      const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
      for (const p of rig.tankTopPoints()) {
        const rel = p.clone().sub(f.p);
        const along = rel.dot(fwd);
        if (Math.abs(along) > 0.45) continue;
        const lat = rel.dot(left);
        if (Math.abs(lat) > 7) continue;
        if (p.y > S.wireHeightAt(lat) - 0.05) {
          st.zaps++;
          st.health = Math.max(0, st.health - 20);
          this._zapCool = 3;
          rig.events.push({ type: 'zap', pos: p });
          break;
        }
      }
    }
    for (const e of rig.events) {
      if (e.type === 'hit' && e.kind === 'overpass' && e.isTank && this._ovCool <= 0) {
        this._ovCool = 1.5;
        st.ov = (st.ov || 0) + 1;
      }
    }
  }

  /** Host-only rules: obstacles, fines, progress, win/lose. */
  _hostRules(h) {
    const W = this.W;
    const rig = this.rig;
    const S = this.structures;
    const r = this.world.road;
    if (W.ph === 'play') W.jt += h;
    const ro = W.seats.d || this.session.me;
    if (ro !== W.ro) {
      W.ro = ro;
      W.re++;
    }
    // rig state as the host sees it (own sim, or the owner's latest snapshot)
    const rs = rig.owner ? rig.state : this.session.latestRig?.(W.ro)?.st;
    // lifting the wires by hand from the top of the rig
    const f = S.spots.lines;
    let lifting = false;
    const checkLift = (pr) => {
      if (!pr || !pr.lift || !pr.p) return;
      const pos = this._presencePos(pr);
      if (!pos) return;
      const d = Math.hypot(pos.x - f.p.x, pos.z - f.p.z);
      if (d < 10 && pos.y > f.p.y + 2.4) lifting = true;
    };
    checkLift(this.session.local);
    for (const [, info] of this.session.others()) checkLift(info.presence);
    const lines = W.ob.lines;
    lines[0] = Math.round(clamp(lines[0] + (lifting ? h * 1.6 : -h * 0.8), 0, 1) * 100) / 100;
    if (rs) {
      if ((rs.zaps || 0) > (this.prev.hostZaps ?? 0)) {
        lines[2] = 1;
        this._fine('power');
      }
      this.prev.hostZaps = rs.zaps || 0;
      if ((rs.ov || 0) > (this.prev.hostOv ?? 0)) this._fine('overpass');
      this.prev.hostOv = rs.ov || 0;
    }
    // knocked props
    for (const p of S.props) {
      if (p.knocked) continue;
      const moved = p.body.position.distanceTo(p.home) > 0.7;
      const up = new CANNON.Vec3();
      p.body.vectorToWorldFrame(new CANNON.Vec3(0, 1, 0), up);
      if (moved || up.y < 0.7) {
        p.knocked = true;
        this._fine(p.kind);
      }
    }
    // the weak bridge
    const [supports, collapsed] = W.ob.br;
    if (!collapsed) {
      const bf = S.spots.bridge;
      let on = false;
      for (const b of [rig.truck, rig.trailer]) {
        const rx = b.position.x - bf.p.x, rz = b.position.z - bf.p.z;
        const along = rx * r.tx[bf.i] + rz * r.tz[bf.i];
        const lat = rx * r.tz[bf.i] - rz * r.tx[bf.i];
        if (Math.abs(along) < 13 && Math.abs(lat) < 6 && Math.abs(b.position.y - bf.p.y) < 4) on = true;
      }
      const count = [0, 1, 2, 3].filter((k) => supports & (1 << k)).length;
      if (on && count < 3) {
        this.creak += h;
        if (this.creak > 1.3) {
          W.ob.br[1] = 1;
          this._fine('bridge');
        }
      } else this.creak = Math.max(0, this.creak - h);
    }
    // progress
    const q = r.nearest(rig.truck.position.x, rig.truck.position.z, 20);
    if (q.i >= 0 && q.i > W.prog && q.i < W.prog + 60) W.prog = q.i;
    // lose / win
    if (W.ph === 'play' && rs) {
      if (rs.health <= 0) this._end('lost', 'health');
      else if (rs.tank === false || rs.tank === 0) {
        this.prev.tankGoneAt ??= W.jt;
        if (W.jt - this.prev.tankGoneAt > 3) this._end('lost', 'tank');
      }
    }
    if (W.ph === 'play' && W.rel && W.jt - W.rel > 8) this._end('won', '');
  }

  _end(ph, why) {
    this.W.ph = ph;
    this.W.why = why;
  }

  _fine(kind) {
    this.W.fines[kind] = (this.W.fines[kind] || 0) + 1;
  }

  _peerLeft(peer) {
    const info = this.remotes.get(peer);
    if (info) {
      info.avatar.dispose();
      this.remotes.delete(peer);
    }
    if (this.session.isHost) {
      for (const k of Object.keys(this.W.seats)) if (this.W.seats[k] === peer) this.W.seats[k] = null;
      const pos = info ? info.avatar.group.position : this.rig.toWorld('truck', [3, 1, 0]);
      this.items.releaseHolder(peer, pos);
      this.items.ensureBodies();
    }
  }

  // ------------------------------------------------------------------ actions

  _onAction(peer, dom, type, args) {
    if (dom === 'W' && this.session.isHost) this._hostAction(peer, type, args);
    if (dom === 'R' && this.rig.owner) this._rigAction(peer, type, args);
  }

  _hostAction(peer, type, args) {
    const W = this.W;
    const it = this.items;
    switch (type) {
      case 'sit': {
        const code = SEAT_CODES[args[0]];
        if (!code) return;
        if (W.seats[code] && W.seats[code] !== peer) return;
        for (const k of Object.keys(W.seats)) if (W.seats[k] === peer) W.seats[k] = null;
        W.seats[code] = peer;
        break;
      }
      case 'unsit':
        for (const k of Object.keys(W.seats)) if (W.seats[k] === peer) W.seats[k] = null;
        break;
      case 'pick':
        it.pickup(args[0], peer);
        break;
      case 'tbTake':
        it.takeFromToolbox(peer);
        break;
      case 'stow':
        it.stow(args[0], peer);
        break;
      case 'drop':
        it.drop(args[0], peer, [args[1], args[2], args[3]], args[4], [args[5], args[6], args[7]]);
        break;
      case 'plank': {
        const [id, slot] = args;
        const item = it.get(id);
        if (!item || item.holder !== peer || item.type !== 'plank' || W.ob.wo & (1 << slot)) return;
        it.consume(id);
        W.ob.wo |= 1 << slot;
        break;
      }
      case 'post': {
        const [id, slot] = args;
        const item = it.get(id);
        if (!item || item.holder !== peer || item.type !== 'post' || W.ob.br[1] || W.ob.br[0] & (1 << slot)) return;
        it.consume(id);
        W.ob.br[0] |= 1 << slot;
        break;
      }
      case 'cut':
        W.ob.tree = 1;
        break;
      case 'hook':
        if (!W.ob.lines[2]) W.ob.lines[1] = 1;
        break;
      case 'use':
        it.consume(args[0]);
        break;
      case 'release':
        if (!W.rel && W.ph === 'play') W.rel = Math.max(0.01, W.jt);
        break;
      case 'tow': {
        if (W.ph !== 'play') return;
        const cp = [...this.checkpoints].reverse().find((c) => c.i <= W.prog) || this.checkpoints[0];
        W.tow++;
        W.towTo = cp.i;
        this._fine('tow');
        if (W.ob.br[1] && cp.i < this.world.road.places.bridge + 20) W.ob.br = [0, 0];
        break;
      }
      case 'restart':
        this.resetJob();
        break;
    }
    it.ensureBodies();
  }

  _rigAction(peer, type, args) {
    const rig = this.rig;
    const st = rig.state;
    switch (type) {
      case 'tire':
        rig.repairTire(args[0]);
        break;
      case 'fuel':
        st.fuel = Math.min(100, st.fuel + args[0]);
        break;
      case 'strap':
        st.straps[args[0]] = 100;
        break;
      case 'water':
        st.water = 100;
        break;
      case 'bed':
        st.bedTarget = st.bedTarget > 0.5 ? 0 : 1;
        break;
      case 'tauto':
        st.tillerAuto = !st.tillerAuto;
        break;
      case 'horn':
        st.horn = !!args[0];
        break;
      case 'lights':
        st.lights = !st.lights;
        break;
      case 'beacons':
        st.beacons = !st.beacons;
        break;
    }
  }

  // ------------------------------------------------------------------ per-frame

  update(dt, now) {
    const s = this.session;
    const W = this.ws();
    const rig = this.rig;
    if (W && !s.isHost && this.ready && W.reset !== this._lastReset) this.resetJob(true);
    if (!this.ready && !s.isHost && this.mode === 'play' && performance.now() - (this.sessionAt || 0) > 15000 && !this._hostLostShown) {
      this._hostLostShown = true;
      this.hud?.hostLost();
    }
    // tows
    if (W && this.prev.tow !== undefined && W.tow !== this.prev.tow) {
      if (rig.owner) {
        rig.placeOnRoad(W.towTo);
        rig.state.bedTarget = 0;
      }
      this.hud?.toast('A tow truck hauls the rig back to the last checkpoint.');
    }
    if (W) this.prev.tow = W.tow;

    if (W) {
      this.structures.setTreeCut(!!W.ob.tree);
      this.structures.setLines({ lifted: W.ob.lines[0], hooked: !!W.ob.lines[1], broken: !!W.ob.lines[2] });
      this.structures.setBridge(W.ob.br[0], !!W.ob.br[1]);
      this.structures.setWashout(W.ob.wo);
      if (!s.isHost && W.items) this.items.applySnapshot(W.items);
      this._syncLocalSeat();
      this._diffEvents(W);
    }
    if (s.isHost) this.items.ensureBodies();
    // reconcile what we think we hold with what the host says
    const heldItem = this.player.held ? this.items.get(this.player.held) : null;
    if (this.player.held && (!heldItem || heldItem.gone || (heldItem.holder !== s.me && (s.isHost || (this._heldMismatch = (this._heldMismatch || 0) + dt) > 1.5)))) {
      this.player.held = null;
      this._heldMismatch = 0;
    } else if (heldItem && heldItem.holder === s.me) this._heldMismatch = 0;

    if (this.mode === 'play' && !this.paused) this._handleInput(dt);
    else this.lifting = false;

    rig.updateVisuals(dt, this.time);
    this._releaseAnimation(dt);
    this.player.lifting = this.lifting;
    this.player.avatar.setVisible(this.mode === 'play');
    this.player.updateVisual(dt, this.time);
    this._updateRemotes(dt);
    this.items.update(dt, (peer) => (peer === s.me ? this.player.avatar : this.remotes.get(peer)?.avatar));
    this.fx.update(dt);
    this._rigEvents();

    // camera
    const focus = new THREE.Vector3();
    let heading;
    if (this.mode !== 'play') {
      rig.center(focus);
      focus.y += 3;
      this.cam.yaw = yawOf(rig.truck.quaternion) - Math.PI / 2 + Math.sin(this.time * 0.07) * 0.9;
      this.cam.pitch = 0.2;
      this.cam.setMode('rig', 24);
    } else if (this.player.seat) {
      rig.center(focus);
      focus.y += 3.2;
      heading = yawOf(rig.truck.quaternion);
      if (this.player.seat === 'tiller') {
        // look forward from behind the trailer: D pushes the back end right on screen
        heading = yawOf(rig.trailer.quaternion);
        rig.toWorld('trailer', [0, 3, -5], focus);
      }
      this.cam.setMode('rig', 24);
    } else {
      this.player.feet(focus);
      focus.y += 1.6;
      this.cam.setMode('foot', 6.5);
    }
    if (!this.freeCam) this.cam.update(dt, this.mode === 'play' && !this.paused ? this.input : { mouseDX: 0, mouseDY: 0, wheel: 0 }, focus, heading);
    this.world.update(dt, this.time, this.camera.position);
    this.structures.update(dt, this.time);
    followSun(this.world.lights.sun, focus);

    if (this.mode === 'play') this._publish(now);
    s.tick(now);

    if (this.hud) this.hud.update(this._hudModel());
    if (this.audio) this.audio.update(dt, this._audioModel());
    if (window.__WL_DEBUG && this.onDebugFrame) this.onDebugFrame(dt);
    // tests can skip frames to run the simulation faster than the renderer
    this._frameNo = (this._frameNo || 0) + 1;
    if (!this.renderEvery || this._frameNo % this.renderEvery === 0) this.renderer.render(this.scene, this.camera);
  }

  _syncLocalSeat() {
    const p = this.player;
    const mySeat = this.seatOf(this.session.me);
    if (p.seat && mySeat !== p.seat && performance.now() - (this._seatClaimAt || 0) > 1500) this._leaveSeat(true);
  }

  _presencePos(pr) {
    if (!pr || !pr.p) return null;
    const v = new THREE.Vector3(pr.p[0], pr.p[1], pr.p[2]);
    if (pr.s && SEAT_BY_CODE[pr.s]) {
      const seat = SEATS[SEAT_BY_CODE[pr.s]];
      return this.rig.toWorld(seat.body, seat.sit, v);
    }
    if (pr.on === 'a' || pr.on === 'b') return this.rig.toWorld(pr.on === 'a' ? 'truck' : 'trailer', pr.p, v);
    return v;
  }

  _publish(now) {
    const s = this.session;
    const p = this.player;
    const b = p.body;
    const r2 = (v) => Math.round(v * 100) / 100;
    // stand on the rig -> publish rig-relative coordinates so riders stay put for everyone
    let pos = [r2(b.position.x), r2(b.position.y - 0.34), r2(b.position.z)];
    let on = null;
    const gb = p.groundBody;
    if (!p.seat && (gb === this.rig.truck || gb === this.rig.trailer)) {
      on = gb === this.rig.truck ? 'a' : 'b';
      const l = new CANNON.Vec3();
      gb.pointToLocalFrame(new CANNON.Vec3(b.position.x, b.position.y - 0.34, b.position.z), l);
      pos = [r2(l.x), r2(l.y), r2(l.z)];
    }
    const i = this.input;
    const seat = p.seat;
    const typing = this.hud?.typing || this.paused;
    s.set({
      n: this.opts.name || 'Crew',
      c: this.opts.color ?? 0,
      p: pos,
      on,
      r: Math.round(p.yaw * 100) / 100,
      a: p.action ? p.action.anim : this.lifting ? 'lift' : this.waving > 0 ? 'wave' : null,
      h: p.held ?? null,
      s: seat ? SEAT_CODES[seat] : null,
      lift: this.lifting ? 1 : 0,
      in: seat === 'driver' && !typing ? [i.axis('KeyS', 'KeyW'), i.axis('KeyA', 'KeyD'), i.down('Space') ? 1 : 0, 0] : seat === 'tiller' && !typing ? [0, 0, 0, i.axis('KeyA', 'KeyD')] : null,
      ping: this.ping,
      say: this.say,
    });
    if (s.isHost && !s.solo && now - (this._lastW || 0) > 50) {
      this._lastW = now;
      const W = this.W;
      s.set({ W: { ...W, items: this.items.snapshot(), seats: { ...W.seats }, ob: { tree: W.ob.tree, lines: [...W.ob.lines], br: [...W.ob.br], wo: W.ob.wo }, fines: { ...W.fines } } });
    }
    if (!s.solo) {
      if (this.rig.owner) s.set({ R: { ...this.rig.snapshot(), t: now / 1000 } });
      else if (s.local.R) s.set({ R: null });
    }
  }

  _updateRemotes(dt) {
    const s = this.session;
    if (s.solo) return;
    const seen = new Set();
    for (const [peer, info] of s.others()) {
      const pr = info.presence;
      if (!pr || !pr.p) continue;
      seen.add(peer);
      let rem = this.remotes.get(peer);
      if (!rem) {
        rem = { avatar: new Avatar(this.scene, pr.c ?? 1, String(pr.n || 'Crew').slice(0, 18)), pos: new THREE.Vector3(), init: false };
        this.remotes.set(peer, rem);
      }
      const target = this._presencePos(pr);
      const seated = !!(pr.s && SEAT_BY_CODE[pr.s]);
      if (seated) target.y -= 0.62;
      const prevPos = rem.avatar.group.position.clone();
      if (!rem.init || rem.pos.distanceToSquared(target) > 64 || seated || pr.on) {
        rem.pos.copy(target);
        rem.init = true;
      } else rem.pos.lerp(target, Math.min(1, dt * 12));
      const av = rem.avatar;
      av.group.position.copy(rem.pos);
      const moved = prevPos.distanceTo(rem.pos) / Math.max(dt, 1e-3);
      rem.speed = (rem.speed || 0) * 0.8 + moved * 0.2;
      let yaw = pr.r || 0;
      if (seated) {
        const seat = SEATS[SEAT_BY_CODE[pr.s]];
        yaw = yawOf(seat.body === 'truck' ? this.rig.truck.quaternion : this.rig.trailer.quaternion) + (pr.s === 't' ? Math.PI : 0);
      }
      av.yaw = yaw;
      av.anim.speed = seated ? 0 : pr.on ? Math.min(6, rem.speed * 0.3) : Math.min(8, rem.speed);
      av.anim.grounded = true;
      av.anim.seated = seated;
      av.anim.carrying = pr.h ? this.items.get(pr.h)?.type : null;
      av.anim.action = pr.a || null;
      av.update(dt, this.time);
      if (pr.say && pr.say[0] !== rem.lastSay) {
        const first = rem.lastSay === undefined;
        rem.lastSay = pr.say[0];
        if (!first) {
          av.say(String(pr.say[1]).slice(0, 40));
          this.hud?.chat(String(pr.n || 'Crew').slice(0, 18), pr.c ?? 1, String(pr.say[1]).slice(0, 80));
          this.audio?.play('radio');
        }
      }
      if (pr.ping && pr.ping[0] !== rem.lastPing) {
        const first = rem.lastPing === undefined;
        rem.lastPing = pr.ping[0];
        if (!first) {
          this.fx.ping(new THREE.Vector3(pr.ping[1], pr.ping[2], pr.ping[3]), pr.c ?? 1);
          this.audio?.play('ping');
        }
      }
    }
    for (const [peer, rem] of this.remotes) {
      if (!seen.has(peer)) {
        rem.avatar.dispose();
        this.remotes.delete(peer);
      }
    }
  }

  // ------------------------------------------------------------------ input and interactions

  _handleInput(dt) {
    const i = this.input;
    const s = this.session;
    const p = this.player;
    if (this.hud?.typing) return;
    if (p.seat === 'driver') {
      if (i.hit('KeyB')) s.act('R', 'bed');
      if (i.hit('KeyX')) s.act('R', 'tauto');
      if (i.hit('KeyL')) s.act('R', 'lights');
      if (i.hit('KeyH')) s.act('R', 'horn', 1);
      if (i.released.has('KeyH')) s.act('R', 'horn', 0);
    }
    if (i.hit('KeyF')) {
      if (p.seat) this._leaveSeat(false);
      else if (this.cand.f && !this.cand.f.disabled) this.cand.f.run();
    }
    if (i.hit('KeyG')) this._doPing();
    if (this.hud?.quickChatOpen) for (let k = 1; k <= 6; k++) if (i.hit('Digit' + k)) this._sayQuick(k - 1);
    if (i.hit('KeyT')) this.hud?.toggleQuickChat();
    if (i.hit('KeyV')) this.waving = 1.6;
    this.waving = Math.max(0, this.waving - dt);
    if (i.hit('KeyQ') && p.held && !p.seat) this._drop();
    if (i.hit('Backspace') && !p.seat) p.respawnAtRig();

    this.cand = this._candidates();
    const c = this.cand.e;
    const eDown = i.down('KeyE');
    this.lifting = !!(c && c.continuous && eDown);
    if (this.hold) {
      if (!eDown || !c || c.id !== this.hold.id) {
        this.hold = null;
        p.action = null;
      } else {
        this.hold.t += dt;
        if (this.hold.t >= this.hold.dur) {
          const done = this.hold;
          this.hold = null;
          p.action = null;
          done.run();
          this.audio?.play('done');
        }
      }
    } else if (c && !c.continuous && !c.disabled && i.hit('KeyE')) {
      if (c.hold) {
        this.hold = { id: c.id, t: 0, dur: c.hold, run: c.run, label: c.label };
        p.action = { anim: c.anim || 'place' };
      } else c.run();
    }
  }

  _candidates() {
    const out = { e: null, f: null };
    const p = this.player;
    const W = this.ws();
    if (!W || W.ph !== 'play' || p.seat) return out;
    const s = this.session;
    const rig = this.rig;
    const pos = p.feet(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0));
    const S = this.structures;
    const best = { e: [], f: [] };
    const add = (key, d, c) => best[key].push({ d, ...c });
    const anchors = rig.anchors();
    for (const a of anchors) {
      if (a.kind !== 'seat') continue;
      const d = a.pos.distanceTo(pos);
      if (d > 2.8) continue;
      const code = SEAT_CODES[a.seat];
      const taken = W.seats[code] && W.seats[code] !== s.me;
      const label = { driver: 'Drive the rig', passenger: 'Ride shotgun', tiller: 'Take the tiller seat (steers the trailer)' }[a.seat];
      add('f', d, { id: 'seat-' + a.seat, label: taken ? `${label} (taken)` : label, disabled: taken, run: () => !taken && this._enterSeat(a.seat) });
    }
    const held = p.held ? this.items.get(p.held) : null;
    const st = rig.state;
    if (held) {
      const t = held.type;
      if (t === 'plank') {
        for (const slot of S.plankSlots) {
          if (W.ob.wo & (1 << slot.n)) continue;
          const d = Math.hypot(pos.x - slot.pos.x, pos.z - slot.pos.z);
          if (d < 5.6 && Math.abs(pos.y - slot.pos.y) < 3) add('e', d, { id: 'plank-' + slot.n, label: 'Lay the plank across the gap', hold: 0.8, anim: 'place', run: () => this._useHeld('W', 'plank', slot.n) });
        }
      }
      if (t === 'post') {
        for (const slot of S.supportSlots) {
          if (W.ob.br[0] & (1 << slot.n) || W.ob.br[1]) continue;
          const d = Math.hypot(pos.x - slot.pos.x, pos.z - slot.pos.z);
          if (d < 2.6) add('e', d, { id: 'post-' + slot.n, label: 'Wedge the support post under the deck', hold: 1.5, anim: 'place', run: () => this._useHeld('W', 'post', slot.n) });
        }
      }
      if (t === 'chainsaw' && !W.ob.tree) {
        const d = pos.distanceTo(S.spots.log);
        if (d < 4.2) add('e', d, { id: 'cut', label: 'Cut through the log', hold: 3.5, anim: 'chop', run: () => this.session.act('W', 'cut') });
      }
      if (t === 'hotstick' && !W.ob.lines[1] && !W.ob.lines[2]) {
        for (const pole of [S.spots.poleL, S.spots.poleR]) {
          const d = Math.hypot(pos.x - pole.x, pos.z - pole.z);
          if (d < 2.8) add('e', d, { id: 'hook', label: 'Hook the wires up higher', hold: 3, anim: 'lift', run: () => this.session.act('W', 'hook') });
        }
        const onRig = p.groundBody === rig.trailer || p.groundBody === rig.truck;
        const f = S.spots.lines;
        const d = Math.hypot(pos.x - f.p.x, pos.z - f.p.z);
        if (onRig && d < 10 && pos.y > f.p.y + 2.4) add('e', 0.1, { id: 'lift', label: 'Hold E to lift the wires over the tank', continuous: true });
      }
      if (t === 'tire') {
        anchors.forEach((a) => {
          if (a.kind !== 'tire' || st.tires[a.k] > 0) return;
          const d = a.pos.distanceTo(pos);
          if (d < 2.4) add('e', d, { id: 'tire-' + a.k, label: 'Change the flat tire', hold: 4, anim: 'jack', run: () => { this._useHeld('W', 'use'); this.session.act('R', 'tire', a.k); } });
        });
      }
      if (t === 'jerrycan') {
        const a = anchors.find((x) => x.kind === 'fuelcap');
        const d = a.pos.distanceTo(pos);
        if (d < 2.2) add('e', d, { id: 'fuelcan', label: 'Pour in the jerry can (+30% fuel)', hold: 2.5, anim: 'pour', run: () => { this._useHeld('W', 'use'); this.session.act('R', 'fuel', 30); } });
      }
      const tb = anchors.find((x) => x.kind === 'toolbox');
      const dtb = tb.pos.distanceTo(pos);
      if (dtb < 2.2 && !held.def.heavy) add('e', dtb + 0.5, { id: 'stow', label: `Stow the ${held.def.label} in the toolbox`, run: () => { this.session.act('W', 'stow', held.id); p.held = null; this.audio?.play('drop'); } });
    } else {
      const it = this.items.nearest(pos, 2.4);
      if (it) add('e', it.mesh.position.distanceTo(pos), { id: 'pick-' + it.id, label: `Pick up the ${it.def.label}`, run: () => { this.session.act('W', 'pick', it.id); p.held = it.id; this.audio?.play('pick'); } });
      const tb = anchors.find((x) => x.kind === 'toolbox');
      const dtb = tb.pos.distanceTo(pos);
      if (dtb < 2.2) {
        const first = this.items.toolbox[0];
        if (first !== undefined) add('e', dtb, { id: 'tb', label: `Take the ${this.items.get(first).def.label} from the toolbox (${this.items.toolbox.length} inside)`, run: () => { this.session.act('W', 'tbTake'); p.held = first; this.audio?.play('pick'); } });
        else add('e', dtb, { id: 'tb-empty', label: 'The toolbox is empty', disabled: true, run() {} });
      }
      for (const a of anchors) {
        if (a.kind === 'strap' && st.tank) {
          const d = a.pos.distanceTo(pos);
          if (d < 2.0 && st.straps[a.k] < 95) add('e', d, { id: 'strap-' + a.k, label: st.straps[a.k] <= 0 ? 'Re-tie the snapped strap' : 'Tighten the strap', hold: st.straps[a.k] <= 0 ? 2.5 : 1.4, anim: 'ratchet', run: () => this.session.act('R', 'strap', a.k) });
        }
        if (a.kind === 'ladder') {
          const d = a.pos.distanceTo(pos);
          if (d < 2.0) add('e', d, { id: 'ladder-up', label: 'Climb up onto the tank', run: () => { p.teleport(a.top); this.audio?.play('step'); } });
        }
        if (a.kind === 'ladderTop') {
          const d = a.pos.distanceTo(pos);
          if (d < 1.8) add('e', d + 0.3, { id: 'ladder-down', label: 'Climb down the ladder', run: () => { p.teleport(a.bottom); this.audio?.play('step'); } });
        }
        if (a.kind === 'tankGate' && st.tank) {
          const d = a.pos.distanceTo(pos);
          const rz = S.spots.release.p;
          const tankC = rig.toWorld('trailer', TRAILER.tank.center);
          const inZone = Math.hypot(tankC.x - rz.x, tankC.z - rz.z) < 10;
          if (d < 3.2 && inZone && !W.rel) {
            const stopped = Math.abs(rig.speed) < 1;
            add('e', d, { id: 'release', label: stopped ? 'Release Dolores!' : 'Stop the rig to release Dolores', disabled: !stopped, hold: 2, anim: 'wave', run: () => this.session.act('W', 'release') });
          }
        }
      }
      const pump = S.spots.pump;
      const dp = pump.distanceTo(pos);
      if (dp < 2.8) {
        const cap = anchors.find((x) => x.kind === 'fuelcap').pos;
        const ok = cap.distanceTo(pump) < 12;
        add('e', dp, { id: 'pump', label: ok ? 'Fill up the truck' : 'Park the truck by the pump to fill up', disabled: !ok, hold: 3, anim: 'pour', run: () => this.session.act('R', 'fuel', 100) });
      }
      const valve = S.spots.valve;
      const dv = valve.distanceTo(pos);
      if (dv < 2.8) {
        const tankC = rig.toWorld('trailer', TRAILER.tank.center);
        const sp = S.spots.spout;
        const ok = Math.hypot(tankC.x - sp.x, tankC.z - sp.z) < 6 && st.tank;
        add('e', dv, { id: 'valve', label: ok ? "Refill Dolores's tank" : 'Park the tank under the spout first', disabled: !ok, hold: 4, anim: 'pour', run: () => this.session.act('R', 'water') });
      }
    }
    for (const k of ['e', 'f']) {
      best[k].sort((a, b) => a.d - b.d);
      out[k] = best[k][0] || null;
    }
    return out;
  }

  _useHeld(dom, type, arg) {
    const p = this.player;
    const id = p.held;
    if (!id) return;
    if (type === 'use') this.session.act('W', 'use', id);
    else this.session.act(dom, type, id, arg);
    p.held = null;
  }

  _drop() {
    const p = this.player;
    const id = p.held;
    const it = this.items.get(id);
    p.held = null;
    if (!it) return;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const pos = p.feet(new THREE.Vector3()).addScaledVector(fwd, it.def.long ? 1.2 : 0.9);
    pos.y += it.type === 'plank' ? 0.6 : 0.8;
    const v = p.body.velocity;
    this.session.act('W', 'drop', id, pos.x, pos.y, pos.z, p.yaw, v.x, v.y, v.z);
    this.audio?.play('drop');
  }

  _enterSeat(seat) {
    const p = this.player;
    if (p.held) this._drop();
    this.session.act('W', 'sit', seat);
    this._seatClaimAt = performance.now();
    p.sit(seat);
    this.audio?.play('door');
    this.hud?.seatHint(seat);
  }

  _leaveSeat(denied) {
    const p = this.player;
    const seat = p.seat;
    if (!seat) return;
    if (!denied) this.session.act('W', 'unsit');
    const door = this.rig.toWorld(SEATS[seat].body, SEATS[seat].door);
    door.y = Math.max(door.y, this.world.heightAt(door.x, door.z) + 0.2);
    p.stand(door);
    this.audio?.play('door');
    if (denied) this.hud?.toast('Someone else got that seat first.');
    this.hud?.seatHint(null);
  }

  requestTow() {
    this.session.act('W', 'tow');
  }

  requestRestart() {
    this.session.act('W', 'restart');
  }

  _doPing() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = ray.intersectObjects([this.world.terrainMesh, this.world.roadMesh, this.rig.trailerModel, this.rig.truckModel], true)[0];
    if (!hit) return;
    const id = ((this.ping?.[0] || 0) % 999) + 1;
    this.ping = [id, Math.round(hit.point.x * 10) / 10, Math.round(hit.point.y * 10) / 10, Math.round(hit.point.z * 10) / 10];
    this.fx.ping(hit.point, this.opts.color ?? 0);
    this.audio?.play('ping');
  }

  sayText(text) {
    const id = ((this.say?.[0] || 0) % 999) + 1;
    this.say = [id, text];
    this.player.avatar.say(text.slice(0, 40));
    this.hud?.chat(this.opts.name, this.opts.color ?? 0, text);
    this.audio?.play('radio');
  }

  _sayQuick(k) {
    const text = QUICK_CHAT[k];
    if (!text) return;
    const id = ((this.say?.[0] || 0) % 999) + 1;
    this.say = [id, text];
    this.player.avatar.say(text);
    this.hud?.chat(this.opts.name, this.opts.color ?? 0, text);
    this.hud?.toggleQuickChat(false);
    this.audio?.play('radio');
  }

  // ------------------------------------------------------------------ events, fx, release

  /** Turn state changes into toasts and sounds (the same on every peer). */
  _diffEvents(W) {
    const P = this.prev;
    const st = this.rig.state;
    const toast = (m) => this.hud?.toast(m);
    if (P.tree === 0 && W.ob.tree) {
      toast('The log is cut. The road is clear.');
      this.audio?.play('thud');
    }
    if (P.hooked === 0 && W.ob.lines[1]) toast('Wires hooked up high. The tank will clear them now.');
    if (P.broken === 0 && W.ob.lines[2]) {
      toast(`You tore down the power lines. Fine: $${FINES.power.toLocaleString()}`);
      this.cam.shake = 1.2;
      this.fx.sparks(this.structures.spots.lines.p.clone().setY(this.structures.spots.lines.p.y + 4), 60);
      this.audio?.play('zap');
    }
    if (P.ov !== undefined && (W.fines.overpass || 0) > P.ov) {
      toast(`The tank hit the rail bridge. Fine: $${FINES.overpass.toLocaleString()}. Lower the bed (B) to fit under.`);
      this.cam.shake = 0.8;
      this.audio?.play('crash');
    }
    if (P.wo !== undefined && W.ob.wo !== P.wo) {
      const n = [0, 1, 2, 3, 4, 5].filter((k) => W.ob.wo & (1 << k)).length;
      toast(`Plank laid (${n} across the gap). The wheels need planks under both tracks.`);
      this.audio?.play('thud');
    }
    if (P.sup !== undefined && W.ob.br[0] !== P.sup && W.ob.br[0]) {
      const n = [0, 1, 2, 3].filter((k) => W.ob.br[0] & (1 << k)).length;
      toast(n >= 3 ? `Support post in (${n}/4). The bridge should hold now.` : `Support post in (${n}/4). It needs at least 3.`);
      this.audio?.play('thud');
    }
    if (P.col === 0 && W.ob.br[1]) {
      toast(`The bridge gave way. Fine: $${FINES.bridge.toLocaleString()}. Call a tow from the pause menu (Esc).`);
      this.cam.shake = 1.5;
      this.audio?.play('crash');
    }
    for (const kind of ['mailbox', 'car']) {
      const n = W.fines[kind] || 0;
      if (P[kind] !== undefined && n > P[kind]) toast(`You flattened a ${kind === 'car' ? 'parked car' : 'mailbox'}. Fine: $${FINES[kind].toLocaleString()}`);
      P[kind] = n;
    }
    if (P.rel === 0 && W.rel) this._startRelease();
    if (P.ph && P.ph !== W.ph && W.ph !== 'play') this.hud?.showEnd(W, this._payout(W));
    if (P.straps) {
      st.straps.forEach((t, k) => {
        if (P.straps[k] > 0 && t <= 0) {
          toast('A strap snapped! Re-tie it at its ratchet before the tank shifts.');
          this.audio?.play('snap');
        }
      });
    }
    if (P.tires) {
      st.tires.forEach((t, k) => {
        if (P.tires[k] > 0 && t <= 0) {
          toast('Blowout! Grab a spare tire from the toolbox and change it.');
          this.audio?.play('blowout');
          this.cam.shake = 0.5;
        }
      });
    }
    if (P.tank === true && !st.tank) toast('The tank slid off the trailer!');
    if (P.fuel > 15 && st.fuel <= 15) toast('Fuel is low. Use the jerry can in the toolbox, or the pump at the gas station.');
    if (P.water > 35 && st.water <= 35) toast("Dolores's water is low. Refill it at the water tower by the gas station.");
    P.tree = W.ob.tree;
    P.hooked = W.ob.lines[1];
    P.broken = W.ob.lines[2];
    P.ov = W.fines.overpass || 0;
    P.wo = W.ob.wo;
    P.sup = W.ob.br[0];
    P.col = W.ob.br[1];
    P.rel = W.rel;
    P.ph = W.ph;
    P.straps = [...st.straps];
    P.tires = [...st.tires];
    P.tank = st.tank;
    P.fuel = st.fuel;
    P.water = st.water;
  }

  _rigEvents() {
    const rig = this.rig;
    for (const e of rig.events) {
      if (e.type === 'splash') {
        const p = rig.toWorld('trailer', [clamp(e.x, -1.2, 1.2) * 1.1, 3.9, clamp(e.z, -3.5, 3.5)]);
        this.fx.splash(p, 6);
        if (Math.random() < 0.2) this.audio?.play('splash');
      } else if (e.type === 'zap') {
        this.fx.sparks(e.pos, 40);
      } else if (e.type === 'impact' && e.impact > 2.5) {
        this.audio?.play('thud');
      }
    }
    rig.events.length = 0;
    if (!rig.owner && rig.state.tank && Math.hypot(rig.slosh.x, rig.slosh.z * 0.5) > 0.9 && Math.random() < 0.15) {
      this.fx.splash(rig.toWorld('trailer', [clamp(rig.slosh.x, -1.2, 1.2), 3.9, clamp(rig.slosh.z, -3.5, 3.5)]), 4);
    }
  }

  _startRelease() {
    const whale = this.rig.trailerModel.userData.whale;
    const start = new THREE.Vector3();
    whale.getWorldPosition(start);
    this.rig.trailerModel.remove(whale);
    this.scene.add(whale);
    whale.position.copy(start);
    const sea = this.structures.spots.release.at(0, 0, 60);
    this.releaseAnim = { whale, t: 0, start, sea, jumped: false };
    this.audio?.play('song');
    this.hud?.toast('Dolores is free!');
  }

  _releaseAnimation(dt) {
    const a = this.releaseAnim;
    if (!a) return;
    a.t += dt;
    const w = a.whale;
    const end = a.sea.clone().setY(-0.6);
    const t = a.t;
    const mid = a.start.clone().lerp(end, 0.15);
    if (t < 1.4) {
      const u = t / 1.4;
      w.position.lerpVectors(a.start, mid, u);
      w.position.y = a.start.y + Math.sin(u * Math.PI) * 2.5 - u * (a.start.y + 0.5);
      w.rotation.x = u * 0.6;
    } else if (t < 6) {
      const u = (t - 1.4) / 4.6;
      const from = mid.clone().setY(-0.5);
      w.position.lerpVectors(from, end, u);
      w.position.y = -0.4 + Math.sin(t * 2) * 0.15;
      w.rotation.x = 0;
      const dir = end.clone().sub(from);
      w.rotation.y = Math.atan2(dir.x, dir.z);
      if (Math.random() < 0.3) this.fx.splash(w.position.clone().setY(0.1), 2);
    } else if (t < 8) {
      const u = (t - 6) / 2;
      w.position.copy(end).setY(-0.5 + Math.sin(u * Math.PI) * 5);
      w.rotation.x = -Math.cos(u * Math.PI) * 1.1;
      if (!a.jumped && u > 0.9) {
        a.jumped = true;
        this.fx.splash(end.clone().setY(0.2), 60);
        this.audio?.play('splash');
      }
    } else {
      w.visible = t < 12;
      w.position.y = -0.6;
    }
    if (a.t < 8) w.userData.tail.rotation.x = Math.sin(a.t * 8) * 0.3;
  }

  _payout(W) {
    const st = this.rig.state;
    const lines = [];
    const won = W.ph === 'won';
    lines.push(['Contract: deliver Dolores to Gull Harbor', won ? PAY : 0]);
    if (won) {
      const healthCut = -Math.round(PAY * (1 - st.health / 100) * 0.8);
      if (healthCut) lines.push([`Dolores's condition (${Math.round(st.health)}%)`, healthCut]);
      if (st.water >= 60) lines.push(['Bonus: plenty of water in the tank', 800]);
      if (W.jt < 15 * 60) lines.push(['Bonus: delivered in under 15 minutes', 1500]);
    }
    const names = { power: 'Downed power lines', overpass: 'Rail bridge damage', mailbox: 'Flattened mailboxes', car: 'Crushed parked cars', tow: 'Tow truck call-outs', bridge: 'Collapsed bridge' };
    for (const [k, n] of Object.entries(W.fines)) lines.push([`${names[k] || k} ×${n}`, -FINES[k] * n]);
    const total = lines.reduce((a, [, v]) => a + v, 0);
    return { lines, total, won, time: W.jt, why: W.why, health: st.health, water: st.water };
  }

  // ------------------------------------------------------------------ hud and audio models

  _hudModel() {
    const W = this.ws();
    const rig = this.rig;
    const st = rig.state;
    const p = this.player;
    const players = [{ me: true, n: this.opts.name || 'You', c: this.opts.color ?? 0, seat: p.seat, held: p.held ? this.items.get(p.held)?.def.label : null, host: this.session.isHost && !this.session.solo }];
    for (const [peer, info] of this.session.others()) {
      const pr = info.presence;
      if (!pr || !pr.p) continue;
      players.push({ me: false, n: String(pr.n || 'Crew').slice(0, 18), c: pr.c ?? 1, seat: pr.s ? SEAT_BY_CODE[pr.s] : null, held: pr.h ? this.items.get(pr.h)?.def.label : null, host: peer === this.session.host, pos: this._presencePos(pr) });
    }
    return {
      mode: this.mode,
      ready: this.ready || this.session.isHost,
      phase: W?.ph || 'play',
      jobTime: W?.jt || 0,
      rig: {
        kmh: Math.abs(rig.speed * 3.6), fuel: st.fuel, water: st.water, health: st.health, straps: st.straps, tires: st.tires,
        bed: st.bed, bedTarget: st.bedTarget, tillerAuto: st.tillerAuto, tank: st.tank, rear: rig.rearAngle, lights: st.lights,
        slosh: Math.hypot(rig.slosh.x, rig.slosh.z * 0.5), rpm: rig.rpm,
      },
      seat: p.seat,
      held: p.held ? this.items.get(p.held)?.def.label : null,
      cand: this.cand,
      hold: this.hold ? { label: this.hold.label, t: this.hold.t / this.hold.dur } : null,
      lifting: this.lifting,
      objective: this._objective(W),
      players,
      map: { truck: rig.truck.position, trailer: rig.trailer.position, heading: yawOf(rig.truck.quaternion), me: p.body.position, myYaw: p.yaw, camYaw: this.cam.yaw, others: players.slice(1), road: this.world.road, prog: W?.prog || 0, structures: this.structures, items: this.items },
      fines: W ? Object.entries(W.fines).reduce((a, [k, n]) => a + FINES[k] * n, 0) : 0,
      solo: !!this.session.solo,
      code: this.session.code,
      connected: this.session.connected,
      isHost: this.session.isHost,
    };
  }

  _objective(W) {
    if (!W) return { title: 'Connecting to the host…', detail: 'Waiting for the job to load.' };
    const r = this.world.road;
    const q = r.nearest(this.rig.truck.position.x, this.rig.truck.position.z, 30);
    const at = q.i >= 0 ? q.i : W.prog;
    const P = r.places;
    const st = this.rig.state;
    if (W.rel) return { title: 'Dolores is home', detail: 'Watch her go.' };
    const hp1 = r.nearestIndex(-322, -62);
    const steps = [
      { i: this.startIndex - 10, done: at > this.startIndex + 8 || !!this.player.seat || this.rig.speed > 1, title: 'Get the rig moving', detail: 'Walk to the driver door on the left of the cab and press F. W/S drive, A/D steer.' },
      { i: P.tree, done: W.ob.tree, title: 'Tree down across the road', detail: 'Take the chainsaw from the yellow toolbox behind the cab, then hold E by the log.' },
      { i: P.lines, done: W.ob.lines[1] || W.ob.lines[2] || at > P.lines + 12, title: 'Low power lines', detail: 'The tank will snag the wires. Hook them up at a pole with the hot stick, or ride on top of the tank and hold E to lift them as the rig passes.' },
      { i: P.overpass, done: at > P.overpass + 14, title: "Low rail bridge: 14'-5\" clearance", detail: st.bedTarget > 0.5 ? 'Bed lowered. Creep under (12 km/h max), then press B to raise it again.' : 'Lower the trailer bed before the bridge: press B in the cab.' },
      { i: P.station, done: at > P.station + 30, title: 'Gas station and water tower', detail: 'Fill up at the pump. Park the tank under the tower spout and turn the red valve to refill Dolores.' },
      { i: P.bridge, done: W.ob.br[1] || at > P.bridge + 16, title: 'Weak bridge: 20 ton limit', detail: 'Carry support posts from the pile down into the creek and wedge at least 3 of the 4 under the deck.' },
      { i: P.washout, done: at > P.washout + 8, title: 'The road is washed out', detail: 'Carry planks from the pile and lay them across the gap under both wheel tracks.' },
      { i: P.hairpins, done: at > hp1, title: 'Switchbacks', detail: 'Take it slow. A crewmate in the tiller seat can steer the trailer wheels; the driver can toggle auto-steer with X.' },
      { i: P.town, done: at > P.town + 60, title: 'Gull Harbor', detail: 'Narrow streets. Every mailbox you hit is a fine.' },
      { i: r.count - 22, done: false, title: 'Release Dolores at the boat ramp', detail: 'Stop with the tank in the yellow ring, then hold E at the back of the tank.' },
    ];
    const next = steps.find((x) => !x.done && x.i >= at - 40) || steps[steps.length - 1];
    return { title: next.title, detail: next.detail, dist: Math.max(0, Math.round((next.i - at) * r.ds)) };
  }

  _audioModel() {
    const rig = this.rig;
    const cam = this.camera.position;
    const truck = rig.truck.position;
    const d = Math.hypot(cam.x - truck.x, cam.y - truck.y, cam.z - truck.z);
    return {
      rpm: rig.rpm,
      engine: clamp(1.4 - d / 70, 0, 1) * (rig.state.fuel > 0 ? 1 : 0),
      horn: rig.state.horn,
      chainsaw: this.hold?.id === 'cut',
      ratchet: !!this.hold?.id?.startsWith('strap'),
      pour: !!this.hold && ['fuelcan', 'pump', 'valve'].includes(this.hold.id),
      slosh: Math.hypot(rig.slosh.vx, rig.slosh.vz) * clamp(1.4 - d / 40, 0, 1),
      sea: clamp(1 - Math.abs(cam.x + 400) / 160, 0, 1),
      creak: this.creak,
      whale: rig.state.tank && !this.releaseAnim ? clamp(1.2 - d / 40, 0, 1) : 0,
      speed: Math.abs(rig.speed),
      mode: this.mode,
    };
  }
}
