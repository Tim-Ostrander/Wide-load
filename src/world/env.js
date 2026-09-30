// Sky, sun, fog and the sea.
import { THREE } from '../lib.js';
import { N, HALF, SIZE } from './terrain.js';
import { lowPolyMaterial } from '../render/lowpoly.js';
import { mulberry32 } from '../util/rng.js';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.35).normalize();
export const HORIZON = new THREE.Color(0xcdeeff);
export const ZENITH = new THREE.Color(0x3f9be6);

export function createSky() {
  const geo = new THREE.SphereGeometry(2400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON.clone() },
      uZenith: { value: ZENITH.clone() },
      uSun: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // at far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, max(h, 0.0)));
        col = mix(col, uHorizon, smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        // a flat cartoon sun with a soft halo
        col = mix(col, vec3(1.0, 0.97, 0.82) * 1.6, smoothstep(0.9975, 0.9985, s));
        col += vec3(1.0, 0.9, 0.6) * pow(s, 24.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

/** Puffy cartoon clouds drifting over the map. */
export function createClouds() {
  const rnd = mulberry32(99);
  const group = new THREE.Group();
  const mat = lowPolyMaterial({ color: 0xffffff, emissive: 0x9fb8cc, emissiveIntensity: 0.35 });
  const puff = new THREE.IcosahedronGeometry(1, 2);
  for (let k = 0; k < 34; k++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(puff, mat);
      const r = 9 + rnd() * 10;
      m.scale.set(r * 1.25, r * 0.8, r);
      m.position.set((i - n / 2) * 11 + rnd() * 6, rnd() * 5, (rnd() - 0.5) * 12);
      c.add(m);
    }
    c.position.set(-700 + rnd() * 1400, 150 + rnd() * 90, -700 + rnd() * 1400);
    c.rotation.y = rnd() * Math.PI;
    c.userData.speed = 1.5 + rnd() * 2;
    group.add(c);
  }
  group.userData.update = (dt) => {
    for (const c of group.children) {
      c.position.x -= c.userData.speed * dt;
      if (c.position.x < -800) c.position.x += 1600;
    }
  };
  return group;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xe4f4ff, 0x8a7a5a, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 70;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  return { hemi, sun };
}

/** Keep the shadow camera centred on the action, snapped to texels to avoid shimmer. */
export function followSun(sun, target) {
  const size = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const x = Math.round(target.x / size) * size;
  const z = Math.round(target.z / size) * size;
  sun.target.position.set(x, target.y, z);
  sun.position.set(x, target.y, z).addScaledVector(SUN_DIR, 220);
}

export function createSea(terrain) {
  // depth texture from the terrain (0..255 maps -14..+4 m)
  const data = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const h = terrain.heights[k];
    data[k] = Math.max(0, Math.min(255, Math.round(((h + 14) / 18) * 255)));
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDepth: { value: null },
      uSun: { value: SUN_DIR.clone() },
      uShallow: { value: new THREE.Color(0x5fe3d6) },
      uDeep: { value: new THREE.Color(0x1f74c9) },
      uSky: { value: HORIZON.clone() },
    },
  ]);
  uniforms.uDepth.value = tex;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        w.y += sin(w.x * 0.08 + uTime * 0.9) * 0.08 + sin(w.z * 0.11 - uTime * 1.3) * 0.06;
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uDepth; uniform vec3 uSun;
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = (vWorld.xz + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)};
        float ground = texture2D(uDepth, uv).r * 18.0 - 14.0;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ground = -14.0;
        float depth = max(0.0, vWorld.y - ground);
        // stepped cartoon water: bands of colour by depth
        float band = depth < 0.9 ? 0.0 : depth < 3.0 ? 0.45 : depth < 7.0 ? 0.75 : 1.0;
        vec3 col = mix(uShallow, uDeep, band);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        // drifting sparkles
        float sp = sin(vWorld.x * 0.35 + uTime * 1.1) * sin(vWorld.z * 0.29 - uTime * 0.8);
        float camDist = length(cameraPosition - vWorld);
        col += vec3(0.9) * step(0.985, sp) * (1.0 - smoothstep(60.0, 200.0, camDist));
        // foam: a solid band at the shore plus a dashed line a little further out
        float wave = sin(uTime * 1.6 + vWorld.x * 0.15 + vWorld.z * 0.1) * 0.12;
        float foam = step(depth, 0.32 + wave);
        foam = max(foam, step(abs(depth - (0.85 + wave)), 0.06) * step(0.0, sin(vWorld.x * 0.8 + vWorld.z * 0.6 + uTime)));
        col = mix(col, vec3(1.0), foam);
        float alpha = mix(0.7, 0.96, smoothstep(0.0, 2.0, depth));
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(3200, 3200, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-600, 0, 0);
  mesh.renderOrder = 2;
  return mesh;
}

export function createCreekMaterial() {
  return lowPolyMaterial({ color: 0x4fd0dc, transparent: true, opacity: 0.88 });
}
