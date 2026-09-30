// Low-poly shading: every face lit as one flat plane, soft Lambert light, no
// outlines. Shared by models, terrain, road and clouds.
import { THREE } from '../lib.js';

export function lowPolyMaterial(opts = {}) {
  return new THREE.MeshLambertMaterial({ flatShading: true, ...opts });
}
