// The drivable road surface as a textured ribbon.
import { THREE } from '../lib.js';

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5b5750';
  g.fillRect(0, 0, 256, 512);
  // grain
  for (let k = 0; k < 9000; k++) {
    const v = 70 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.25 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // patches
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(40,38,35,${0.15 + Math.random() * 0.15})`;
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 512, 10 + Math.random() * 30, 10 + Math.random() * 50, Math.random(), 0, Math.PI * 2);
    g.fill();
  }
  // tyre tracks
  g.fillStyle = 'rgba(35,33,30,0.25)';
  for (const x of [52, 84, 172, 204]) g.fillRect(x, 0, 14, 512);
  // edge lines
  g.fillStyle = '#e8e2cf';
  g.fillRect(10, 0, 6, 512);
  g.fillRect(240, 0, 6, 512);
  // centre dashes
  g.fillStyle = '#e8b923';
  g.fillRect(124, 0, 8, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** skip(i) -> true to leave a hole in the ribbon at sample i. */
export function createRoadMesh(road, skip) {
  const pos = [], uv = [], nor = [], idx = [];
  let vi = 0;
  let prevOk = false;
  for (let i = 0; i < road.count; i++) {
    const ok = !skip(i);
    const hw = road.hw[i];
    const x = road.x[i], z = road.z[i], y = road.h[i] + 0.05;
    const lx = road.tz[i], lz = -road.tx[i];
    pos.push(x + lx * hw, y, z + lz * hw, x - lx * hw, y, z - lz * hw);
    nor.push(0, 1, 0, 0, 1, 0);
    const v = (i * road.ds) / 14;
    uv.push(0, v, 1, v);
    if (ok && prevOk) {
      const a = vi - 2, b = vi - 1, c = vi, d = vi + 1;
      // left-a, right-b (prev); left-c, right-d (curr)
      idx.push(a, b, c, b, d, c);
    }
    prevOk = ok;
    vi += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    map: roadTexture(),
    roughness: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}
