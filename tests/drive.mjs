// Drive the rig with a scripted autopilot and take screenshots along the way.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.game, null, { timeout: 60000 });
const script = process.env.SCRIPT || '';
await page.evaluate(script);
const plan = JSON.parse(process.env.PLAN || '[]');
for (const p of plan) {
  await page.waitForTimeout(p.wait || 1000);
  if (p.eval) console.log(JSON.stringify(await page.evaluate(p.eval)));
  if (p.shot) console.log(await shot(page, p.shot));
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close(); srv.kill();
