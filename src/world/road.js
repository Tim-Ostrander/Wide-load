// The route from the depot (east) to Gull Harbor (west): a spline sampled
// every metre, with a spatial hash for nearest-point queries.
import { THREE } from '../lib.js';

function hairpinPoints() {
  const pts = [];
  const arc = (cx, cz, r, a0, a1, steps) => {
    for (let i = 1; i < steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  };
  pts.push([-250, 8], [-250, -20], [-250, -50]);
  arc(-266, -50, 16, 0, -Math.PI, 6);
  pts.push([-282, -50], [-282, -20], [-282, 20]);
  arc(-298, 20, 16, 0, Math.PI, 6);
  pts.push([-314, 20], [-314, -10], [-314, -40]);
  return pts;
}

export const WAYPOINTS = [
  [424, 30], [400, 36], [370, 48], [335, 62], [295, 62], [258, 46],
  [222, 16], [186, -18], [150, -40], [110, -50], [70, -40], [36, -18],
  [4, 12], [-26, 40], [-54, 74], [-80, 104], [-106, 126], [-138, 134],
  [-170, 120], [-200, 90], [-226, 56], [-244, 28],
  ...hairpinPoints(),
  [-322, -62], [-338, -76], [-358, -74], [-372, -56], [-384, -38],
  [-398, -24], [-414, -16], [-440, -10],
];

/** Named places along the route, as world x/z; s (metres along road) is resolved at build time. */
export const PLACES = {
  depot: [400, 36],
  tree: [212, 7],
  lines: [150, -40],
  overpass: [36, -18],
  station: [-26, 40],
  bridge: [-80, 104],
  washout: [-172, 118],
  hairpins: [-244, 28],
  town: [-358, -74],
  harbor: [-418, -15],
};

export class Road {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
    const length = curve.getLength();
    const n = Math.round(length);
    const pts = curve.getSpacedPoints(n);
    this.count = pts.length;
    this.length = length;
    this.ds = length / (this.count - 1);
    this.x = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.tx = new Float32Array(this.count);
    this.tz = new Float32Array(this.count);
    this.h = new Float32Array(this.count);
    this.hw = new Float32Array(this.count); // half width
    for (let i = 0; i < this.count; i++) {
      this.x[i] = pts[i].x;
      this.z[i] = pts[i].z;
    }
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 2), b = Math.min(this.count - 1, i + 2);
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
      this.hw[i] = 4.6;
    }
    // spatial hash
    this.cell = 16;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = this._key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let arr = this.hash.get(k);
      if (!arr) this.hash.set(k, (arr = []));
      arr.push(i);
    }
    this.places = {};
    for (const [name, [x, z]] of Object.entries(PLACES)) {
      const q = this.nearest(x, z, 200);
      this.places[name] = q.i;
    }
    // widen through the switchbacks
    const hp0 = this.places.hairpins, hp1 = this.nearestIndex(-322, -62);
    for (let i = hp0; i <= hp1; i++) this.hw[i] = 6.2;
    this._smoothArray(this.hw, 12);
  }

  _key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  _smoothArray(arr, win) {
    const copy = Float32Array.from(arr);
    for (let i = 0; i < arr.length; i++) {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) {
        const j = i + k;
        if (j < 0 || j >= arr.length) continue;
        s += copy[j];
        c++;
      }
      arr[i] = s / c;
    }
  }

  nearestIndex(x, z) {
    return this.nearest(x, z, 400).i;
  }

  /** Nearest road sample within maxDist. Returns {i, d, lat, s} (lat is signed, + = left of travel). */
  nearest(x, z, maxDist = 40, out = {}) {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = maxDist * maxDist;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const arr = this.hash.get(this._key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.x[i] - x, dz = this.z[i] - z;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    out.i = best;
    if (best < 0) {
      out.d = Infinity;
      out.lat = 0;
      out.s = 0;
      return out;
    }
    out.d = Math.sqrt(bd);
    const dx = x - this.x[best], dz = z - this.z[best];
    // left of travel direction (tx,tz) with Y up is (tz, -tx)... in XZ with Y up, left = (tz, -tx)?
    // forward f=(tx,tz); up=(0,1,0); left = up x f = (tz, 0, -tx)
    out.lat = dx * this.tz[best] - dz * this.tx[best];
    out.s = best * this.ds;
    return out;
  }

  /** Point on road centre at sample i (with height). */
  point(i, lat = 0) {
    i = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    return new THREE.Vector3(this.x[i] + this.tz[i] * lat, this.h[i], this.z[i] - this.tx[i] * lat);
  }

  heading(i) {
    i = Math.max(0, Math.min(this.count - 1, Math.round(i)));
    return Math.atan2(this.tx[i], this.tz[i]); // yaw so that local +Z faces travel
  }
}
