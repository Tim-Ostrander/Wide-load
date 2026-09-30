// Serve the built dist/ as a plain static site and check the page boots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, repo, shot } from './harness.mjs';
const dist = path.join(repo, 'dist');
const types = { '.js': 'text/javascript', '.html': 'text/html' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8766);
const { browser, context } = await launch();
const page = await context.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await page.goto('http://localhost:8766/');
await page.waitForSelector('#menu:not([hidden])', { timeout: 90000 });
console.log('doctype', await page.evaluate(() => document.compatMode), 'pwform visible', await page.evaluate(() => !document.querySelector('#pwform').hidden));
console.log(await shot(page, 'dist_menu'));
console.log(logs.join('\n'));
await browser.close();
srv.close();
