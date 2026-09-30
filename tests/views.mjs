// Render the world from a list of viewpoints.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl, null, { timeout: 60000 });
const views = JSON.parse(process.env.VIEWS || '[]');
for (const v of views) {
  await page.evaluate((v) => {
    const w = window.__wl;
    if (v.road !== undefined) w.lookRoad(v.road, v.back, v.up, v.side);
    else if (v.place) { const i = w.world.road.places[v.place]; w.lookRoad(i + (v.off || 0), v.back, v.up, v.side); }
    else w.look(...v.cam);
  }, v);
  await page.waitForTimeout(v.wait || 1500);
  console.log(await shot(page, v.name));
}
console.log(logs.join('\n'));
await browser.close(); srv.kill();
