// Scripted play-through steps. STEPS is a JSON list of {do, ...}.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl && window.__wl.startSolo, null, { timeout: 90000 });
const steps = JSON.parse(process.env.STEPS || '[]');
for (const st of steps) {
  if (st.do === 'solo') await page.evaluate(() => window.__wl.startSolo());
  if (st.do === 'eval') { const r = await page.evaluate(st.js); if (r !== undefined) console.log(JSON.stringify(r)); }
  if (st.do === 'wait') await page.waitForTimeout(st.ms);
  if (st.do === 'key') { await page.keyboard.down(st.key); await page.waitForTimeout(st.ms || 80); await page.keyboard.up(st.key); }
  if (st.do === 'down') await page.keyboard.down(st.key);
  if (st.do === 'up') await page.keyboard.up(st.key);
  if (st.do === 'shot') console.log(await shot(page, st.name));
}
console.log(logs.filter(l => !l.includes('toNonIndexed')).slice(0, 30).join('\n'));
await browser.close(); srv.kill();
