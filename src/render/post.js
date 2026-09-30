// Ink outlines: the scene renders into a multisampled target, then a full-
// screen pass draws dark lines wherever depth jumps (silhouettes and creases).
import { THREE } from '../lib.js';

export class InkPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = renderer.capabilities.isWebGL2;
    this.strength = 0.85;
    if (!this.enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        uNear: { value: 0.1 },
        uFar: { value: 3000 },
        uInk: { value: new THREE.Color(0x1d1a24) },
        uStrength: { value: this.strength },
        uThick: { value: Math.max(1.5, renderer.getPixelRatio() * 1.2) },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform vec3 uInk; uniform float uStrength; uniform float uThick;
        varying vec2 vUv;
        float lin(float d) {
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec4 col = texture2D(tColor, vUv);
          vec2 o = uTexel * uThick;
          float c = lin(texture2D(tDepth, vUv).r);
          float l = lin(texture2D(tDepth, vUv - vec2(o.x, 0.0)).r);
          float r = lin(texture2D(tDepth, vUv + vec2(o.x, 0.0)).r);
          float u = lin(texture2D(tDepth, vUv + vec2(0.0, o.y)).r);
          float d = lin(texture2D(tDepth, vUv - vec2(0.0, o.y)).r);
          // second difference ignores smooth slopes and catches creases and silhouettes
          float lap = abs(l + r + u + d - 4.0 * c) / c;
          float jump = max(max(abs(l - c), abs(r - c)), max(abs(u - c), abs(d - c))) / c;
          float edge = max(smoothstep(0.04, 0.12, lap), smoothstep(0.06, 0.2, jump));
          edge *= 1.0 - smoothstep(180.0, 420.0, c);
          gl_FragColor = vec4(mix(col.rgb, uInk, edge * uStrength), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.material.toneMapped = true;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize() {
    if (!this.target) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.material.uniforms.uThick.value = Math.max(1.5, this.renderer.getPixelRatio() * 1.2);
  }

  render(scene, camera) {
    if (!this.enabled || !this.target) {
      this.renderer.render(scene, camera);
      return;
    }
    const u = this.material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
