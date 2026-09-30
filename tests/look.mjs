// Screenshot structures: VIEWS=[{name, place, lat, up, along, tlat, tup, talong}]
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.game, null, { timeout: 90000 });
await page.evaluate(() => { const g = window.__wl.game; g.freeCam = true; g.cam.update = () => {}; });
const views = JSON.parse(process.env.VIEWS || '[]');
for (const v of views) {
  await page.evaluate((v) => {
    const g = window.__wl.game, r = g.world.road;
    const i = (v.place ? r.places[v.place] : 0) + (v.di || 0);
    const p = r.point(i), tx = r.tx[i], tz = r.tz[i];
    const at = (lat, y, al) => [p.x + tz * lat + tx * al, p.y + y, p.z - tx * lat + tz * al];
    const c = at(v.lat ?? 12, v.up ?? 8, v.along ?? -25), t = at(v.tlat ?? 0, v.tup ?? 1, v.talong ?? 0);
    g.camera.position.set(...c); g.camera.lookAt(...t);
  }, v);
  await page.waitForTimeout(v.wait || 1200);
  console.log(await shot(page, v.name));
}
const info = await page.evaluate(() => window.__wl.game.structures.counts);
console.log(JSON.stringify(info));
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); srv.kill();
