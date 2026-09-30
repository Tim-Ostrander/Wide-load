// Drive a stretch of road with the autopilot and report every static body the
// rig touches (trees, rocks, walls). FROM/TO are place names with offsets.
import { startServer, launch, openPage } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch({ width: 480, height: 270 });
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.startSolo, null, { timeout: 90000 });
const from = process.env.FROM || 'washout:30', to = process.env.TO || 'town:0', speed = Number(process.env.SPEED || 14);
await page.evaluate(([from, to, speed]) => {
  window.__wl.startSolo();
  const g = window.__wl.game, r = g.world.road, P = r.places;
  const at = (s) => { const [n, o] = s.split(':'); return P[n] + Number(o || 0); };
  g.W.ob.tree = 1; g.W.ob.lines[1] = 1; g.W.ob.br[0] = 7; g.W.ob.wo = 63;
  g.rig.placeOnRoad(at(from));
  const a = g.rig.anchors().find((x) => x.kind === 'seat' && x.seat === 'driver');
  g.player.teleport(a.pos);
  g._enterSeat('driver');
  window.__hits = [];
  const seen = new Set();
  for (const [name, b] of [['truck', g.rig.truck], ['trailer', g.rig.trailer]]) {
    b.addEventListener('collide', (e) => {
      const o = e.body;
      if (o === g.world.terrainBody || o.type !== window.__wl.CANNON.Body.STATIC) return;
      const q = r.nearest(o.position.x, o.position.z, 60);
      const key = name + o.id;
      if (seen.has(key)) return;
      seen.add(key);
      window.__hits.push({ name, kind: o.userData?.kind || 'static', at: [Math.round(o.position.x), Math.round(o.position.z)], roadI: q.i, off: +q.d.toFixed(1), rigI: r.nearest(g.rig.truck.position.x, g.rig.truck.position.z, 60).i, straps: g.rig.state.straps.map(Math.round) });
    });
  }
  window.__startAutopilot({ speed, stopAt: at(to), fast: 6 });
  g.renderEvery = 8;
}, [from, to, speed]);
const target = await page.evaluate((to) => { const P = window.__wl.game.world.road.places; const [n, o] = to.split(':'); return P[n] + Number(o || 0); }, to);
await page.waitForFunction((t) => { const g = window.__wl.game, r = g.world.road; return r.nearest(g.rig.truck.position.x, g.rig.truck.position.z, 60).i >= t - 3 || !g.rig.state.tank; }, target, { timeout: 600000, polling: 500 }).catch((e) => console.log('timeout', e.message));
const out = await page.evaluate(() => ({ hits: window.__hits, straps: window.__wl.game.rig.state.straps.map(Math.round), tank: window.__wl.game.rig.state.tank, counts: window.__wl.game.structures.counts }));
console.log(JSON.stringify(out, null, 1));
console.log(logs.filter((l) => l.includes('error')).slice(0, 10).join('\n'));
await browser.close();
srv.kill();
