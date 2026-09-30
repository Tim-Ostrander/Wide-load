// Full automated playthrough: the bot solves every obstacle through the real
// interaction system while the autopilot drives. Prints a log of each stage.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch({ width: 480, height: 270 });
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.startSolo, null, { timeout: 90000 });
await page.evaluate(() => {
  window.__wl.startSolo();
  const g = window.__wl.game;
  g.simSpeed = Number(window.__FAST || 6);
  g.maxSteps = 60;
  g.renderEvery = 8;
});
const H = {
  async ev(fn, arg) { return page.evaluate(fn, arg); },
  async until(fnSrc, timeout = 120000) {
    await page.waitForFunction(fnSrc, null, { timeout, polling: 250 });
  },
};
const log = (...a) => console.log('[bot]', ...a);
const snap = async (name) => {
  await page.evaluate(() => { window.__wl.game.renderEvery = 1; });
  await page.waitForTimeout(400);
  const f = await shot(page, name);
  await page.evaluate(() => { window.__wl.game.renderEvery = 8; });
  return f;
};
// helpers inside the page
await page.evaluate(() => {
  const g = window.__wl.game, r = g.world.road;
  window.__bot = {
    anchor(kind, extra = {}) { return g.rig.anchors().find((a) => a.kind === kind && Object.entries(extra).every(([k, v]) => a[k] === v)); },
    to(v) { if (g.player.seat) g._leaveSeat(false); g.player.teleport(v); g.player.body.velocity.setZero(); },
    cands() { g.cand = g._candidates(); return { e: g.cand.e && { id: g.cand.e.id, label: g.cand.e.label, dis: !!g.cand.e.disabled }, f: g.cand.f && g.cand.f.label }; },
    use(prefix) { g.cand = g._candidates(); const c = g.cand.e; if (!c || (prefix && !c.id.startsWith(prefix)) || c.disabled) return { ok: false, c: c && c.id }; c.run(); return { ok: true, id: c.id }; },
    drive(stopAt, speed = 22) {
      if (!g.player.seat) { const a = this.anchor('seat', { seat: 'driver' }); g.player.teleport(a.pos); g._enterSeat('driver'); }
      window.__startAutopilot({ speed, stopAt, fast: g.simSpeed });
      g.simSpeed = window.__FAST || 6; g.maxSteps = 60;
    },
    // ratchet every strap back to full, the way a crew does at a stop
    tighten() {
      const out = [];
      for (let k = 0; k < 4; k++) {
        const a = this.anchor('strap', { k });
        if (!a) continue;
        this.to(a.pos.clone().setY(a.pos.y - 0.4));
        out.push(this.use('strap-' + k).ok);
      }
      return { ok: out, straps: g.rig.state.straps.map(Math.round) };
    },
    stop() { g.autopilot = null; g.rig.controls.throttle = 0; g.rig.controls.steer = 0; g.rig.controls.handbrake = true; },
    at() { const q = r.nearest(g.rig.truck.position.x, g.rig.truck.position.z, 40); return q.i; },
    st() { const s = g.rig.state; return { i: this.at(), kmh: Math.round(g.rig.speed * 3.6), h: Math.round(s.health), w: Math.round(s.water), f: Math.round(s.fuel), straps: s.straps.map(Math.round), tires: s.tires.filter((t) => t <= 0).length, fines: g.W.fines, ph: g.W.ph, tank: s.tank }; },
    P: r.places,
  };
});
const st = async () => JSON.stringify(await H.ev(() => window.__bot.st()));
const driveTo = async (idx, speed) => {
  await H.ev(([i, s]) => window.__bot.drive(i, s), [idx, speed]);
  await H.until(`window.__bot.at() >= ${idx - 2} && Math.abs(window.__wl.game.rig.speed) < 0.6`, 240000).catch(async () => log('drive timeout', await st()));
  await H.ev(() => window.__bot.stop());
  await page.waitForTimeout(300);
};
const STAGES = ['tree', 'lines', 'overpass', 'station', 'bridge', 'washout', 'town', 'ramp'];
const START = process.env.START || 'tree';
const from = STAGES.indexOf(START);
const on = (name) => STAGES.indexOf(name) >= from;
try {
  const P = await H.ev(() => window.__bot.P);
  if (from > 0) {
    // jump ahead: clear earlier obstacles and put the rig just before this stage
    const where = { lines: P.lines - 40, overpass: P.overpass - 45, station: P.station - 30, bridge: P.bridge - 45, washout: P.washout - 40, town: P.town - 30, ramp: P.town + 40 }[START];
    await H.ev(([where, from]) => {
      const g = window.__wl.game;
      if (from > 0) g.W.ob.tree = 1;
      if (from > 1) g.W.ob.lines[1] = 1;
      if (from > 4) g.W.ob.br[0] = 7;
      if (from > 5) g.W.ob.wo = 15;
      g.rig.placeOnRoad(where);
      window.__bot.to(window.__bot.anchor('toolbox').pos);
    }, [where, from]);
    await page.waitForTimeout(500);
    log('jumped to', START, await st());
  }
  if (on('tree')) {
  // 1. drive to the tree, then take the chainsaw from the toolbox
  await driveTo(P.tree - 16, 22);
  log('at tree', await st());
  await H.ev(() => window.__bot.to(window.__bot.anchor('toolbox').pos));
  log('toolbox cands', JSON.stringify(await H.ev(() => window.__bot.cands())));
  log('take', JSON.stringify(await H.ev(() => window.__bot.use('tb'))));
  log('held', await H.ev(() => window.__wl.game.player.held));
  await H.ev(() => window.__bot.to(window.__wl.game.structures.spots.log.clone().add(new window.__wl.THREE.Vector3(0, 0, 0)).setY(window.__wl.game.structures.spots.log.y + 0.6)));
  await page.waitForTimeout(300);
  log('log cands', JSON.stringify(await H.ev(() => window.__bot.cands())));
  log('cut', JSON.stringify(await H.ev(() => window.__bot.use('cut'))));
  await page.waitForTimeout(400);
  log('tree', await H.ev(() => window.__wl.game.W.ob.tree));
  console.log(await snap('b_tree'));
  await H.ev(() => window.__bot.to(window.__bot.anchor('toolbox').pos));
  log('stow saw', JSON.stringify(await H.ev(() => window.__bot.use('stow'))));
  }
  if (on('lines')) {
  // 3. power lines: stow chainsaw, take hot stick, hook at pole
  await driveTo(P.lines - 22, 22);
  log('at lines', await st());
  await H.ev(() => window.__bot.to(window.__bot.anchor('toolbox').pos));
  await page.waitForTimeout(300);
  log('take2', JSON.stringify(await H.ev(() => window.__bot.use('tb'))), await H.ev(() => window.__wl.game.items.get(window.__wl.game.player.held)?.type));
  await H.ev(() => window.__bot.to(window.__wl.game.structures.spots.poleL.clone().setY(window.__wl.game.structures.spots.poleL.y + 1)));
  await page.waitForTimeout(300);
  log('pole cands', JSON.stringify(await H.ev(() => window.__bot.cands())));
  log('hook', JSON.stringify(await H.ev(() => window.__bot.use('hook'))));
  await page.waitForTimeout(300);
  log('lines', JSON.stringify(await H.ev(() => window.__wl.game.W.ob.lines)));
  await H.ev(() => window.__bot.to(window.__bot.anchor('toolbox').pos));
  log('stow stick', JSON.stringify(await H.ev(() => window.__bot.use('stow'))));
  }
  if (on('overpass')) {
  // 4. overpass: lower bed, creep under
  await driveTo(P.overpass - 30, 22);
  await H.ev(() => window.__wl.game.session.act('R', 'bed'));
  await page.waitForTimeout(2500);
  await driveTo(P.overpass + 28, 11);
  log('after overpass', await st());
  console.log(await snap('b_overpass'));
  await H.ev(() => window.__wl.game.session.act('R', 'bed'));
  }
  if (on('station')) {
  // 5. station: fuel at pump
  await driveTo(P.station + 2, 18);
  log('at station', await st());
  await H.ev(() => window.__bot.to(window.__wl.game.structures.spots.pump.clone()));
  await page.waitForTimeout(300);
  log('pump cands', JSON.stringify(await H.ev(() => window.__bot.cands())));
  log('pump', JSON.stringify(await H.ev(() => window.__bot.use('pump'))));
  // smoke break: empty the pack, restock at the machine, light one for the road
  log('smokes', JSON.stringify(await H.ev(() => {
    const g = window.__wl.game, p = g.player, b = window.__bot;
    const out = { start: p.cigs };
    while (p.cigs > 0) {
      g._smoke();
      if (p.smoking) g._smoke();
    }
    g._smoke();
    out.emptyLit = p.smoking;
    b.to(g.structures.spots.station.at(-23.2, 1.0, -3.2));
    out.cand = b.cands().e;
    out.buy = b.use('smokes');
    out.after = p.cigs;
    g._smoke();
    out.lit = p.smoking;
    return out;
  })));
  }
  if (on('bridge')) {
  // 6. bridge supports: 3 posts
  await driveTo(P.bridge - 30, 20);
  log('at bridge', await st());
  for (let k = 0; k < 3; k++) {
    const r = await H.ev((k) => {
      const g = window.__wl.game, b = window.__bot;
      const it = [...g.items.map.values()].find((x) => x.type === 'post' && !x.gone && !x.holder);
      b.to(it.mesh.position.clone().setY(it.mesh.position.y + 0.5));
      const pick = b.use('pick');
      const slot = g.structures.supportSlots[k];
      b.to(slot.pos.clone().setY(slot.pos.y));
      const c = b.cands();
      const place = b.use('post');
      return { pick, c, place };
    }, k);
    log('post', k, JSON.stringify(r));
    await page.waitForTimeout(300);
  }
  log('bridge state', JSON.stringify(await H.ev(() => window.__wl.game.W.ob.br)));
  await driveTo(P.bridge + 30, 16);
  log('after bridge', await st(), JSON.stringify(await H.ev(() => window.__wl.game.W.ob.br)));
  console.log(await snap('b_bridge'));
  }
  if (on('washout')) {
  // 7. washout planks
  await driveTo(P.washout - 24, 18);
  log('at washout', await st());
  for (let k = 0; k < 4; k++) {
    const r = await H.ev((k) => {
      const g = window.__wl.game, b = window.__bot;
      const it = [...g.items.map.values()].find((x) => x.type === 'plank' && !x.gone && !x.holder);
      b.to(it.mesh.position.clone().setY(it.mesh.position.y + 0.5));
      const pick = b.use('pick');
      const slot = g.structures.plankSlots[k];
      b.to(slot.pos.clone().setY(slot.pos.y + 0.3).add(new window.__wl.THREE.Vector3(0, 0, 0)));
      const c = b.cands();
      const place = b.use('plank-' + k);
      return { pick, c, place };
    }, k);
    log('plank', k, JSON.stringify(r));
    await page.waitForTimeout(300);
  }
  await H.ev(() => { window.__apLog.length = 0; });
  await driveTo(P.washout + 30, 12);
  log('after washout', await st());
  log('tighten', JSON.stringify(await H.ev(() => window.__bot.tighten())));
  if (process.env.TRACE) log('trace', JSON.stringify(await H.ev(() => window.__apLog.map((x) => [x.t, x.i, x.kmh, x.sp, x.st.s]))));
  console.log(await snap('b_washout'));
  }
  if (on('town')) {
  // 8. switchbacks and town
  await driveTo(P.town, 14);
  log('at town', await st());
  if (process.env.TRACE) log('trace', JSON.stringify(await H.ev(() => window.__apLog.map((x) => [x.t, x.i, x.kmh, x.y, x.roll, x.sp, x.st.s, x.st.h]))));
  console.log(await snap('b_town'));
  }
  const end = await H.ev(() => window.__wl.game.world.road.count - 22);
  await driveTo(end, 12);
  log('at ramp', await st());
  const rel = await H.ev(() => {
    const g = window.__wl.game, b = window.__bot;
    b.to(b.anchor('tankGate').pos);
    const tc = g.rig.toWorld('trailer', [0, 2, -0.2]);
    const rz = g.structures.spots.release.p;
    return { c: b.cands(), use: b.use('release'), dist: Math.hypot(tc.x - rz.x, tc.z - rz.z) };
  });
  log('release', JSON.stringify(rel));
  await page.waitForTimeout(6000);
  log('final', await st());
  console.log(await snap('b_end'));
} catch (e) {
  console.log('ERROR', e.message);
}
console.log(logs.filter((l) => !l.includes('toNonIndexed')).slice(0, 30).join('\n'));
await browser.close();
srv.kill();
