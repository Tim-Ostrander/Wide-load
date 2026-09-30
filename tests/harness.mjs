// Playwright harness: serves the game locally, maps CDN module URLs to the
// local node_modules copies, and exposes helpers for scenario scripts.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..');
const deps = process.env.WL_DEPS || '/tmp/claude-0/-home-user-parley/7d7bc31d-40c7-5af3-9f3e-ab88e03c6783/scratchpad/devdeps/node_modules';
export const outDir = process.env.WL_OUT || '/tmp/claude-0/-home-user-parley/7d7bc31d-40c7-5af3-9f3e-ab88e03c6783/scratchpad/shots';
fs.mkdirSync(outDir, { recursive: true });

const CDN = [
  [/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (m) => path.join(deps, 'three', m[1])],
  [/cdn\.jsdelivr\.net\/npm\/cannon-es@[^/]+\/(.*)$/, (m) => path.join(deps, 'cannon-es', m[1])],
];

export async function startServer(port = 8765) {
  try { await fetch(`http://localhost:${port}/`); return { kill() {} }; } catch {}
  const srv = spawn(process.execPath, [path.join(repo, 'tools/devserver.mjs'), repo, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.once('data', r));
  return srv;
}

export async function launch({ width = Number(process.env.W || 1280), height = Number(process.env.H || 720) } = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route(/https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, async (route) => {
    const url = route.request().url();
    for (const [re, fn] of CDN) {
      const m = url.match(re);
      if (m) return route.fulfill({ path: fn(m), contentType: 'text/javascript' });
    }
    if (url.includes('fonts.googleapis.com')) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.fulfill({ status: 404, body: '' });
  });
  return { browser, context };
}

export async function openPage(context, { port = 8765, init, fakeRoom } = {}) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.addInitScript(() => { window.__WL_DEBUG = true; });
  if (fakeRoom) await page.addInitScript({ path: path.join(here, 'fake-room.js') });
  await page.addInitScript({ path: path.join(here, 'autopilot.js') });
  if (init) await page.addInitScript(init);
  await page.goto(`http://localhost:${port}/`);
  return { page, logs };
}

export async function shot(page, name) {
  const f = path.join(outDir, name + '.png');
  await page.screenshot({ path: f });
  return f;
}
