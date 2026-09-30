// Sky, sun, fog and the sea.
import { THREE } from '../lib.js';
import { N, HALF, SIZE } from './terrain.js';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.35).normalize();
export const HORIZON = new THREE.Color(0xe9d6b8);
export const ZENITH = new THREE.Color(0x5d8fc4);

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
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
        col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 900.0) * 3.0;
        col += vec3(1.0, 0.75, 0.45) * pow(s, 12.0) * 0.28;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5a3e, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
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
      uShallow: { value: new THREE.Color(0x4fb3b5) },
      uDeep: { value: new THREE.Color(0x1d5a78) },
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
        // ripples
        float r1 = sin(vWorld.x * 0.9 + uTime * 1.7 + sin(vWorld.z * 0.4)) * 0.5 + 0.5;
        float r2 = sin(vWorld.z * 1.1 - uTime * 1.2 + sin(vWorld.x * 0.3)) * 0.5 + 0.5;
        float camDist = length(cameraPosition - vWorld);
        float rip = 0.12 * (1.0 - smoothstep(30.0, 160.0, camDist));
        vec3 n = normalize(vec3((r1 - 0.5) * rip, 1.0, (r2 - 0.5) * rip));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.2, 7.0, depth));
        col = mix(col, uSky, fres * 0.55);
        vec3 h = normalize(viewDir + uSun);
        col += vec3(1.0, 0.9, 0.7) * pow(max(dot(n, h), 0.0), 220.0) * 1.6;
        float foam = smoothstep(0.55, 0.0, depth) * (0.6 + 0.4 * sin(uTime * 2.0 + vWorld.x * 0.7 + vWorld.z * 0.5));
        col = mix(col, vec3(0.95, 0.97, 0.95), clamp(foam, 0.0, 1.0));
        float alpha = mix(0.55, 0.95, smoothstep(0.0, 2.5, depth));
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
  return new THREE.MeshStandardMaterial({ color: 0x4f9fa8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 });
}
