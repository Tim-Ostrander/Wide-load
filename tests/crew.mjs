// Crew lineup: a row of avatars with different looks at the depot, for
// reviewing character art. LOOKS=[{hat, glasses, color, action}] overrides.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.game, null, { timeout: 90000 });
if (process.env.DIST) await page.evaluate((d) => { window.__CREW_DIST = d; }, Number(process.env.DIST));
await page.evaluate(async (looks) => {
  const g = window.__wl.game;
  const { Avatar } = await import('/src/player.js');
  g.freeCam = true;
  g.cam.update = () => {};
  const r = g.world.road, i = r.places.depot + 30;
  const p = r.point(i), tx = r.tx[i], tz = r.tz[i];
  const at = (lat, y, al) => new window.__wl.THREE.Vector3(p.x + tz * lat + tx * al, p.y + y, p.z - tx * lat + tz * al);
  window.__crew = [];
  looks.forEach((lk, k) => {
    const a = new Avatar(g.scene, lk.color ?? k, 'Crew ' + k, { look: lk });
    const q = at(-6, 0, (k - (looks.length - 1) / 2) * 1.6);
    q.y = g.world.heightAt(q.x, q.z);
    a.group.position.copy(q);
    a.anim.speed = lk.speed || 0;
    a.anim.action = lk.action || null;
    if (lk.smoke) a.setSmoking(true);
    window.__crew.push(a);
  });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    for (const a of window.__crew) a.update(dt, now / 1000);
    requestAnimationFrame(tick);
  };
  tick();
  const dist = window.__CREW_DIST || 7.5;
  const c = at(-6 + dist, 1.5, 0), t = at(-6, 1.0, 0);
  g.camera.position.copy(c);
  g.camera.lookAt(t);
  for (const a of window.__crew) a.yaw = Math.atan2(c.x - a.group.position.x, c.z - a.group.position.z);
  document.querySelectorAll('#menu, #hud').forEach((e) => (e.hidden = true));
}, JSON.parse(process.env.LOOKS || JSON.stringify([
  { hat: 'cowboy', glasses: 'aviator', smoke: true },
  { hat: 'trucker', glasses: 'none', smoke: true },
  { hat: 'bucket', glasses: 'shades' },
  { hat: 'hardhat', glasses: 'none', speed: 5 },
  { hat: 'beanie', glasses: 'round', action: 'wave' },
  { hat: 'none', glasses: 'shades', smoke: true },
])));
await page.waitForTimeout(Number(process.env.WAIT || 2500));
console.log(await shot(page, process.env.NAME || 'crew'));
console.log(logs.filter((l) => !l.includes('toNonIndexed')).slice(0, 20).join('\n'));
await browser.close();
srv.kill();
