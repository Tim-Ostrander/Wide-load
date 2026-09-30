// Cel shading: a stepped light ramp shared by every toon material.
import { THREE } from '../lib.js';

let _ramp;
/** Three bands of light: shadow side, mid, lit. */
export function toonRamp() {
  if (!_ramp) {
    const data = new Uint8Array([118, 118, 118, 255, 188, 188, 188, 255, 255, 255, 255, 255]);
    _ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    _ramp.minFilter = THREE.NearestFilter;
    _ramp.magFilter = THREE.NearestFilter;
    _ramp.generateMipmaps = false;
    _ramp.needsUpdate = true;
  }
  return _ramp;
}

export function toonMaterial(opts = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...opts });
}
