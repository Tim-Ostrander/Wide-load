// Start a solo job, light a smoke and screenshot the crew member on foot and
// in the cab.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.startSolo, null, { timeout: 90000 });
await page.evaluate(() => {
  window.__wl.startSolo();
  const g = window.__wl.game;
  const p = g.rig.toWorld('truck', [7, 0, 4]);
  p.y = g.world.heightAt(p.x, p.z) + 0.3;
  g.player.teleport(p);
  g.player.yaw = g.cam.yaw + Math.PI * 0.75; // face half toward the camera
  g.cam.targetDist = 4;
  g.cam.pitch = 0.15;
  g._smoke();
});
await page.waitForTimeout(Number(process.env.WAIT || 9000));
const info = await page.evaluate(() => {
  const g = window.__wl.game;
  return { cigs: g.player.cigs, smoking: g.player.smoking, chip: document.querySelector('#chip-smokes').textContent, pres: { lk: g.session.local?.lk, sm: g.session.local?.sm } };
});
console.log(JSON.stringify(info));
console.log(await shot(page, 'onfoot'));
await page.evaluate(() => {
  const g = window.__wl.game;
  const a = g.rig.anchors().find((x) => x.kind === 'seat' && x.seat === 'driver');
  g.player.teleport(a.pos);
  g._enterSeat('driver');
  g.cam.targetDist = 12;
});
await page.waitForTimeout(4000);
console.log(await shot(page, 'incab'));
console.log(logs.filter((l) => !l.includes('toNonIndexed') && !l.includes('verbose')).slice(0, 20).join('\n'));
await browser.close();
srv.kill();
