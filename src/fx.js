// Particles (sparks, splashes, dust) and ping markers.
import { THREE } from './lib.js';
import { HAT_COLORS } from './player.js';

const MAX = 600;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
    this.next = 0;
    this.pings = [];
  }

  _emit(p, v, color, life, grav) {
    const k = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([p.x, p.y, p.z], k * 3);
    this.vel.set([v.x, v.y, v.z], k * 3);
    const c = new THREE.Color(color);
    this.col.set([c.r, c.g, c.b], k * 3);
    this.life[k] = life;
    this.grav[k] = grav;
  }

  sparks(p, n = 30) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8);
      this._emit(p, v, Math.random() < 0.5 ? 0xfff2a0 : 0x9fd8ff, 0.4 + Math.random() * 0.6, 12);
    }
  }

  splash(p, n = 10) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
      this._emit(p, v, Math.random() < 0.5 ? 0xd8f4ff : 0x7cc7dd, 0.6 + Math.random() * 0.5, 9.8);
    }
  }

  dust(p, n = 4) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.5 + Math.random(), (Math.random() - 0.5) * 1.5);
      this._emit(p, v, 0xb8a58a, 0.8 + Math.random() * 0.6, -0.3);
    }
  }

  ping(p, colorIdx) {
    const color = HAT_COLORS[colorIdx % HAT_COLORS.length];
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    beam.position.y = 3;
    g.add(ring, beam);
    g.position.copy(p).setY(p.y + 0.1);
    g.renderOrder = 30;
    this.scene.add(g);
    this.pings.push({ g, ring, beam, t: 0 });
  }

  update(dt) {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -1000;
        continue;
      }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    for (const p of this.pings) {
      p.t += dt;
      const s = 1 + (p.t % 1) * 2;
      p.ring.scale.set(s, s, s);
      p.ring.material.opacity = Math.max(0, 1 - (p.t % 1));
      p.beam.material.opacity = Math.max(0, 0.7 * (1 - p.t / 5));
      if (p.t > 5) {
        this.scene.remove(p.g);
      }
    }
    this.pings = this.pings.filter((p) => p.t <= 5);
  }
}
