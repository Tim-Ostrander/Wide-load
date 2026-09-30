// Evaluate an expression in the running game and print the JSON result.
import { startServer, launch, openPage } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForFunction(() => window.__wl, null, { timeout: 60000 });
const out = await page.evaluate(process.env.EXPR);
console.log(JSON.stringify(out, null, 1));
if (process.env.LOGS) console.log(logs.join('\n'));
await browser.close(); srv.kill();
