import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch();
const { page, logs } = await openPage(context);
await page.waitForTimeout(Number(process.env.WAIT || 4000));
console.log(await shot(page, process.env.NAME || 'smoke'));
console.log(logs.join('\n'));
await browser.close(); srv.kill();
