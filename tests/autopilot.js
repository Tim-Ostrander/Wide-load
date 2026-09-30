// Pure-pursuit autopilot used by tests (injected with page.evaluate).
window.__startAutopilot = function (opts = {}) {
  const g = window.__wl.game, r = g.world.road, rig = g.rig, C = window.__wl.CANNON;
  if (opts.fast) { g.simSpeed = opts.fast; g.maxSteps = 40; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let idx = r.nearest(rig.truck.position.x, rig.truck.position.z, 60).i;
  if (idx < 0) idx = 0;
  const log = (window.__apLog = []);
  let t0 = 0;
  g.autopilot = (h) => {
    t0 += h;
    const t = rig.truck, p = t.position;
    const q = r.nearest(p.x, p.z, 60);
    if (q.i >= 0 && Math.abs(q.i - idx) < 60) idx = q.i;
    const la = Math.min(r.count - 1, idx + (opts.lookahead || 14));
    const inv = t.quaternion.inverse();
    const v = inv.vmult(new C.Vec3(r.x[la] - p.x, 0, r.z[la] - p.z));
    const ang = Math.atan2(v.x, v.z);
    rig.controls.steer = clamp(-ang * 2.4, -1, 1);
    const kmh = rig.speed * 3.6;
    const target = window.__apSpeed ?? opts.speed ?? 25;
    const stopping = idx >= (opts.stopAt ?? r.count - 5);
    rig.controls.throttle = stopping ? (kmh > 2 ? -1 : 0) : clamp((target - kmh) * 0.2, -1, 1);
    rig.controls.handbrake = stopping && kmh <= 2;
    if (Math.round(t0 * 60) % 60 === 0) log.push({ t: Math.round(t0), i: idx, sp: (rig.stressParts||[]).map(v=>+v.toFixed(2)), roll: +(()=>{const u=new C.Vec3();rig.trailer.vectorToWorldFrame(new C.Vec3(1,0,0),u);return u.y})().toFixed(3), kmh: Math.round(kmh), y: +p.y.toFixed(1), art: +rig.articulation().toFixed(2), sl: [+rig.slosh.x.toFixed(2), +rig.slosh.z.toFixed(2)], st: { w: Math.round(rig.state.water), h: Math.round(rig.state.health), f: Math.round(rig.state.fuel), s: rig.state.straps.map(Math.round) } });
  };
};
