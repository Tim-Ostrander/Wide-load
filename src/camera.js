// Third-person orbit camera that follows the local player or the rig.
import { THREE } from './lib.js';
import { clamp, damp, angleDiff } from './util/rng.js';

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 6;
    this.targetDist = 6;
    this.focus = new THREE.Vector3();
    this.mode = 'foot';
    this.lastManual = -10;
    this.time = 0;
    this.shake = 0;
  }

  setMode(mode, distance) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.targetDist = distance;
    }
  }

  update(dt, input, focus, heading) {
    this.time += dt;
    const sens = 0.0028;
    if (input.mouseDX || input.mouseDY) {
      this.yaw -= input.mouseDX * sens;
      this.pitch = clamp(this.pitch + input.mouseDY * sens, -0.25, 1.35);
      this.lastManual = this.time;
    }
    if (input.wheel) {
      const lim = this.mode === 'foot' ? [2.5, 14] : [10, 46];
      this.targetDist = clamp(this.targetDist * (1 + input.wheel * 0.1), lim[0], lim[1]);
    }
    // drift behind the vehicle when the mouse is idle
    if (heading !== undefined && this.time - this.lastManual > 2.2) {
      this.yaw += angleDiff(this.yaw, heading + Math.PI) * (1 - Math.exp(-1.2 * dt));
    }
    this.dist = damp(this.dist, this.targetDist, 4, dt);
    this.focus.x = damp(this.focus.x, focus.x, 14, dt);
    this.focus.y = damp(this.focus.y, focus.y, 10, dt);
    this.focus.z = damp(this.focus.z, focus.z, 14, dt);
    if (this.focus.distanceToSquared(focus) > 400) this.focus.copy(focus);
    const cp = Math.cos(this.pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const pos = this.focus.clone().add(off);
    const ground = this.world.heightAt(pos.x, pos.z) + 0.6;
    if (pos.y < ground) pos.y = ground;
    if (pos.y < 0.8) pos.y = 0.8;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      pos.x += (Math.random() - 0.5) * this.shake;
      pos.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.focus);
  }

  /** Horizontal forward direction of the camera (for movement). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
