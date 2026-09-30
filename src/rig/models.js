// Low-poly models for the truck, the trailer, the tank and Dolores.
// Truck frame: origin at frame centre (0.97 m above ground), +Z forward, +X left.
// Trailer frame: origin at deck centre (0.85 m above ground when the bed is up).
import { THREE } from '../lib.js';
import { ModelBuilder, flatMaterial, textTexture } from '../util/geo.js';

export const PAINT = {
  cab: 0xb8322a,
  cabDark: 0x8e241e,
  chrome: 0xd4d2cb,
  black: 0x1d1d1d,
  steel: 0x3a3d40,
  deck: 0x2b2b2a,
  wood: 0x7b5a3b,
  glassTint: 0x2b3a44,
  yellow: 0xf2c21b,
  amber: 0xffa321,
  tankFrame: 0x4c6a7a,
  strap: 0xf2c21b,
  whale: 0xf1eee6,
  whaleShade: 0xd9dfe2,
};

export function bannerMesh(width, height) {
  const tex = textTexture('OVERSIZE LOAD', { w: 1024, h: 192, font: '900 150px "Big Shoulders Display", Impact, "Arial Black", sans-serif', bg: '#f5c518', fg: '#141414', border: 10 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  return m;
}

export function createWheelModel(radius, width) {
  const mb = new ModelBuilder();
  mb.cyl(radius, radius, width, 14, PAINT.black, [0, 0, 0], [0, 0, Math.PI / 2]);
  mb.cyl(radius * 0.62, radius * 0.62, width + 0.02, 10, 0x9a9890, [0, 0, 0], [0, 0, Math.PI / 2]);
  mb.cyl(radius * 0.22, radius * 0.22, width + 0.06, 6, PAINT.chrome, [0, 0, 0], [0, 0, Math.PI / 2]);
  // tread blocks so spin is visible
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mb.box(width + 0.01, 0.07, 0.16, 0x262626, [0, Math.cos(a) * (radius - 0.02), Math.sin(a) * (radius - 0.02)], [a, 0, 0]);
  }
  const mesh = mb.mesh(flatMaterial());
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.mesh = mesh;
  return g;
}

export function createTruckModel() {
  const g = new THREE.Group();
  const mb = new ModelBuilder();
  // frame rails
  mb.box(0.28, 0.32, 8.3, PAINT.black, [0.55, 0, 0.25]);
  mb.box(0.28, 0.32, 8.3, PAINT.black, [-0.55, 0, 0.25]);
  mb.box(1.4, 0.2, 0.3, PAINT.black, [0, 0, -3.8]);
  // bumper + grille
  mb.box(2.64, 0.34, 0.32, PAINT.chrome, [0, -0.08, 4.56]);
  mb.box(1.36, 0.95, 0.1, PAINT.chrome, [0, 0.82, 4.5]);
  for (let k = 0; k < 6; k++) mb.box(1.2, 0.05, 0.04, 0x333333, [0, 0.46 + k * 0.14, 4.56]);
  // hood and fenders
  mb.box(1.9, 1.02, 1.62, PAINT.cab, [0, 0.84, 3.74]);
  mb.box(1.6, 0.14, 1.5, PAINT.cabDark, [0, 1.38, 3.72]);
  mb.box(0.36, 0.3, 1.7, PAINT.cab, [1.12, 0.56, 3.62]);
  mb.box(0.36, 0.3, 1.7, PAINT.cab, [-1.12, 0.56, 3.62]);
  mb.box(0.42, 0.52, 0.2, PAINT.cab, [1.12, 0.35, 4.4]);
  mb.box(0.42, 0.52, 0.2, PAINT.cab, [-1.12, 0.35, 4.4]);
  // headlights
  mb.box(0.3, 0.2, 0.1, 0xfff4cf, [0.82, 0.62, 4.52]);
  mb.box(0.3, 0.2, 0.1, 0xfff4cf, [-0.82, 0.62, 4.52]);
  // cab
  mb.box(2.5, 2.3, 2.4, PAINT.cab, [0, 1.47, 1.8]);
  mb.box(2.54, 0.18, 2.44, PAINT.cabDark, [0, 0.4, 1.8]);
  mb.box(2.3, 0.95, 0.08, PAINT.glassTint, [0, 2.02, 3.02], [-0.12, 0, 0]);
  mb.box(0.06, 0.8, 1.25, PAINT.glassTint, [1.26, 2.05, 2.25]);
  mb.box(0.06, 0.8, 1.25, PAINT.glassTint, [-1.26, 2.05, 2.25]);
  mb.box(1.8, 0.7, 0.06, PAINT.glassTint, [0, 2.05, 0.59]);
  // door handles and steps
  mb.box(0.05, 0.05, 0.25, PAINT.chrome, [1.28, 1.35, 1.4]);
  mb.box(0.05, 0.05, 0.25, PAINT.chrome, [-1.28, 1.35, 1.4]);
  mb.box(0.4, 0.06, 0.6, PAINT.chrome, [1.2, -0.2, 2.1]);
  mb.box(0.4, 0.06, 0.6, PAINT.chrome, [-1.2, -0.2, 2.1]);
  // mirrors
  mb.box(0.08, 0.5, 0.22, PAINT.black, [1.5, 2.0, 2.9]);
  mb.box(0.08, 0.5, 0.22, PAINT.black, [-1.5, 2.0, 2.9]);
  // roof light bar
  mb.box(1.8, 0.1, 0.3, PAINT.black, [0, 2.67, 2.6]);
  // exhaust stacks
  mb.cyl(0.1, 0.1, 2.3, 8, PAINT.chrome, [1.2, 2.25, 0.5]);
  mb.cyl(0.1, 0.1, 2.3, 8, PAINT.chrome, [-1.2, 2.25, 0.5]);
  // fuel tanks (right side has the cap)
  mb.cyl(0.36, 0.36, 1.0, 12, PAINT.chrome, [1.18, -0.05, 0.25], [Math.PI / 2, 0, 0]);
  mb.cyl(0.36, 0.36, 1.0, 12, PAINT.chrome, [-1.18, -0.05, 0.25], [Math.PI / 2, 0, 0]);
  mb.cyl(0.09, 0.09, 0.1, 8, PAINT.black, [-1.18, 0.33, 0.25]);
  // toolbox (left)
  mb.box(0.62, 0.62, 0.9, PAINT.yellow, [1.14, 0.22, -0.72]);
  mb.box(0.64, 0.08, 0.92, PAINT.black, [1.14, 0.55, -0.72]);
  // fifth wheel
  mb.box(1.3, 0.16, 1.3, PAINT.black, [0, 0.38, -2.4]);
  // rear fenders + mudflaps
  mb.box(0.46, 0.08, 2.4, PAINT.black, [1.06, 0.34, -2.4]);
  mb.box(0.46, 0.08, 2.4, PAINT.black, [-1.06, 0.34, -2.4]);
  mb.box(0.6, 0.62, 0.04, PAINT.black, [1.05, -0.25, -3.75]);
  mb.box(0.6, 0.62, 0.04, PAINT.black, [-1.05, -0.25, -3.75]);
  const body = mb.mesh(flatMaterial());
  g.add(body);
  // beacons
  const beaconMat = new THREE.MeshStandardMaterial({ color: PAINT.amber, emissive: PAINT.amber, emissiveIntensity: 0.2, roughness: 0.4 });
  const beacons = [];
  for (const x of [0.75, -0.75]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 10), beaconMat);
    b.position.set(x, 2.8, 2.6);
    g.add(b);
    beacons.push(b);
  }
  const banner = bannerMesh(2.3, 0.42);
  banner.position.set(0, -0.08, 4.73);
  g.add(banner);
  // headlight glow (toggle)
  const lights = new THREE.Group();
  for (const x of [0.82, -0.82]) {
    const s = new THREE.SpotLight(0xfff0c8, 0, 60, 0.5, 0.5, 1.2);
    s.position.set(x, 0.62, 4.6);
    s.target.position.set(x * 1.2, -0.8, 20);
    lights.add(s, s.target);
  }
  g.add(lights);
  g.userData = { beacons, beaconMat, lights };
  return g;
}

export function createTrailerModel() {
  const g = new THREE.Group();
  const mb = new ModelBuilder();
  // deck
  mb.box(2.6, 0.4, 12.6, PAINT.deck, [0, 0, -1.0]);
  mb.box(2.46, 0.05, 12.4, PAINT.wood, [0, 0.22, -1.0]);
  for (let k = 0; k < 12; k++) {
    const z = -7.1 + k * 1.05 + 0.5;
    const c = k % 2 ? PAINT.black : PAINT.yellow;
    mb.box(0.04, 0.3, 1.05, c, [1.31, 0, z]);
    mb.box(0.04, 0.3, 1.05, c, [-1.31, 0, z]);
  }
  // gooseneck
  mb.box(2.3, 0.62, 3.3, PAINT.deck, [0, 0.9, 6.6]);
  mb.box(2.3, 0.6, 1.1, PAINT.deck, [0, 0.5, 5.2], [0.35, 0, 0]);
  mb.box(1.9, 0.06, 3.1, PAINT.yellow, [0, 1.23, 6.6]);
  // tank frame
  const fz = [-4.05, -1.35, 1.35, 3.65];
  for (const z of fz) {
    for (const x of [1.24, -1.24]) mb.box(0.14, 3.6, 0.14, PAINT.tankFrame, [x, 2.0, z]);
  }
  for (const x of [1.24, -1.24]) {
    mb.box(0.14, 0.16, 7.84, PAINT.tankFrame, [x, 0.28, -0.2]);
    mb.box(0.14, 0.14, 7.84, PAINT.tankFrame, [x, 3.78, -0.2]);
  }
  for (const z of [-4.05, 3.65]) {
    mb.box(2.62, 0.16, 0.14, PAINT.tankFrame, [0, 0.28, z]);
    mb.box(2.62, 0.14, 0.14, PAINT.tankFrame, [0, 3.78, z]);
  }
  // top grating ribs
  for (let k = 0; k < 9; k++) mb.box(2.4, 0.05, 0.08, 0x5b6b72, [0, 3.84, -3.9 + k * 0.94]);
  mb.box(0.08, 0.05, 7.7, 0x5b6b72, [0.6, 3.84, -0.2]);
  mb.box(0.08, 0.05, 7.7, 0x5b6b72, [-0.6, 3.84, -0.2]);
  // railings on top
  for (const x of [1.22, -1.22]) {
    mb.box(0.05, 0.05, 7.7, PAINT.yellow, [x, 4.8, -0.2]);
    for (const z of [-3.9, -1.3, 1.3, 3.5]) mb.box(0.05, 0.95, 0.05, PAINT.yellow, [x, 4.33, z]);
  }
  // ladder at the rear left
  for (const x of [1.0, 0.55]) mb.box(0.06, 3.9, 0.06, PAINT.chrome, [x, 2.05, -4.2]);
  for (let k = 0; k < 11; k++) mb.box(0.5, 0.04, 0.05, PAINT.chrome, [0.78, 0.5 + k * 0.33, -4.2]);
  // tiller cab
  mb.box(1.6, 1.45, 1.3, PAINT.cab, [0, 0.95, -6.45]);
  mb.box(1.62, 0.12, 1.32, PAINT.cabDark, [0, 1.7, -6.45]);
  mb.box(1.3, 0.55, 0.06, PAINT.glassTint, [0, 1.2, -5.79]);
  mb.box(1.3, 0.55, 0.06, PAINT.glassTint, [0, 1.2, -7.11]);
  mb.box(0.06, 0.55, 0.9, PAINT.glassTint, [0.81, 1.2, -6.45]);
  mb.box(0.06, 0.55, 0.9, PAINT.glassTint, [-0.81, 1.2, -6.45]);
  // rear bumper + lights
  mb.box(2.6, 0.26, 0.2, PAINT.black, [0, -0.2, -7.35]);
  for (const x of [1.0, -1.0]) mb.box(0.3, 0.16, 0.06, 0xd8251d, [x, -0.2, -7.46]);
  // wheel fenders
  mb.box(2.64, 0.08, 2.6, PAINT.black, [0, 0.24, -5.5]);
  // corner flags
  for (const [x, z] of [[1.3, 5.2], [-1.3, 5.2]]) {
    mb.box(0.03, 0.9, 0.03, PAINT.black, [x, 0.65, z]);
    mb.box(0.03, 0.4, 0.4, 0xe8572a, [x, 1.0, z - 0.2]);
  }
  const body = mb.mesh(flatMaterial());
  g.add(body);

  // glass panels
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe7f2, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const glass = new THREE.Group();
  const addPane = (w, h, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    m.position.set(...pos);
    m.rotation.y = rotY;
    m.renderOrder = 5;
    glass.add(m);
  };
  addPane(7.7, 3.4, [1.22, 2.03, -0.2], Math.PI / 2);
  addPane(7.7, 3.4, [-1.22, 2.03, -0.2], -Math.PI / 2);
  addPane(2.45, 3.4, [0, 2.03, 3.64], 0);
  addPane(2.45, 3.4, [0, 2.03, -4.04], Math.PI);
  g.add(glass);

  // water volume + surface (animated by slosh)
  const water = new THREE.Group();
  water.position.set(0, 0.36, -0.2);
  const waterBodyMat = new THREE.MeshStandardMaterial({ color: 0x3d9fb8, transparent: true, opacity: 0.2, roughness: 0.2, depthWrite: false });
  const waterBody = new THREE.Mesh(new THREE.BoxGeometry(2.36, 1, 7.6), waterBodyMat);
  waterBody.position.y = 0.5;
  waterBody.renderOrder = 4;
  water.add(waterBody);
  const surfGeo = new THREE.PlaneGeometry(2.36, 7.6, 6, 16);
  surfGeo.rotateX(-Math.PI / 2);
  const surfMat = new THREE.MeshStandardMaterial({ color: 0x6cc7d8, transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const surface = new THREE.Mesh(surfGeo, surfMat);
  surface.renderOrder = 6;
  water.add(surface);
  g.add(water);

  // straps
  const strapMat = new THREE.MeshStandardMaterial({ color: PAINT.strap, roughness: 0.7 });
  const straps = [];
  for (const z of STRAP_Z) {
    const s = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.04, 0.12), strapMat);
    top.position.set(0, 3.92, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.7, 0.12), strapMat);
    l.position.set(1.33, 2.07, 0);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.7, 0.12), strapMat);
    r.position.set(-1.33, 2.07, 0);
    const ratchet = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.2), new THREE.MeshStandardMaterial({ color: 0x9c1d1d, roughness: 0.5 }));
    ratchet.position.set(1.4 * STRAP_SIDE[straps.length], 0.45, 0);
    // loose end for when the strap snaps
    const loose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.0, 0.12), strapMat);
    loose.position.set(1.36 * STRAP_SIDE[straps.length], -0.6, 0);
    loose.visible = false;
    s.add(top, l, r, ratchet, loose);
    s.position.z = z;
    s.userData = { top, l, r, loose, ratchet };
    g.add(s);
    straps.push(s);
  }

  // beacons
  const beaconMat = new THREE.MeshStandardMaterial({ color: PAINT.amber, emissive: PAINT.amber, emissiveIntensity: 0.2, roughness: 0.4 });
  const beacons = [];
  for (const x of [0.55, -0.55]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 10), beaconMat);
    b.position.set(x, 1.85, -6.45);
    g.add(b);
    beacons.push(b);
  }
  const banner = bannerMesh(1.55, 0.3);
  banner.position.set(0, 0.62, -7.13);
  banner.rotation.y = Math.PI;
  g.add(banner);

  const whale = createWhale();
  g.add(whale);

  g.userData = { water, waterBody, surface, straps, beacons, beaconMat, whale, glass };
  return g;
}

export const STRAP_Z = [2.7, 0.9, -0.9, -2.7];
export const STRAP_SIDE = [1, -1, 1, -1]; // which side the ratchet is on (+X = left)

/** Dolores: a beluga. Origin at her centre, facing +Z. */
export function createWhale() {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const mb = new ModelBuilder();
  mb.sphere(1, PAINT.whale, [0, 0, 0.2], [0.78, 0.72, 1.75], 2);
  // melon (forehead)
  mb.sphere(0.62, PAINT.whale, [0, 0.14, 1.55], [1.0, 0.95, 1.0], 2);
  // beak / mouth
  mb.sphere(0.34, PAINT.whaleShade, [0, -0.2, 2.02], [1.0, 0.6, 0.9], 1);
  // belly shade
  mb.sphere(0.9, PAINT.whaleShade, [0, -0.22, 0.2], [0.72, 0.5, 1.6], 1);
  // pectoral fins
  mb.sphere(0.34, PAINT.whaleShade, [0.72, -0.32, 0.9], [0.9, 0.18, 1.3], 1);
  mb.sphere(0.34, PAINT.whaleShade, [-0.72, -0.32, 0.9], [0.9, 0.18, 1.3], 1);
  // dorsal ridge
  mb.sphere(0.2, PAINT.whaleShade, [0, 0.66, -0.3], [0.6, 0.35, 2.2], 1);
  // eyes + smile
  mb.sphere(0.075, 0x111111, [0.43, 0.08, 1.72], [1, 1, 1], 1);
  mb.sphere(0.075, 0x111111, [-0.43, 0.08, 1.72], [1, 1, 1], 1);
  mb.box(0.5, 0.03, 0.05, 0x5a4a4a, [0, -0.28, 2.18], [0, 0, 0]);
  const body = mb.mesh(flatMaterial());
  bodyPivot.add(body);
  // tail stock + fluke on a pivot so it can beat
  const tail = new THREE.Group();
  tail.position.set(0, 0, -1.3);
  const tb = new ModelBuilder();
  tb.sphere(0.5, PAINT.whale, [0, 0, -0.45], [0.8, 0.7, 1.4], 1);
  const fluke = new ModelBuilder();
  fluke.sphere(0.5, PAINT.whaleShade, [0.5, 0, -0.35], [1.1, 0.14, 0.55], 1);
  fluke.sphere(0.5, PAINT.whaleShade, [-0.5, 0, -0.35], [1.1, 0.14, 0.55], 1);
  const tailMesh = tb.mesh(flatMaterial());
  tail.add(tailMesh);
  const flukePivot = new THREE.Group();
  flukePivot.position.set(0, 0, -1.0);
  flukePivot.add(fluke.mesh(flatMaterial()));
  tail.add(flukePivot);
  bodyPivot.add(tail);
  root.scale.setScalar(1.0);
  root.position.set(0, 2.0, -0.2);
  root.userData = { bodyPivot, tail, flukePivot };
  return root;
}
