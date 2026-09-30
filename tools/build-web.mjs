// Build a self-contained static site in dist/ for hosting anywhere (GitHub
// Pages, Cloudflare Pages, Netlify, itch.io). index.html is authored as an
// Artifact fragment, so it gets the full document skeleton here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skeleton } from './skeleton.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), skeleton(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
for (const dir of ['src', 'vendor']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
let n = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : n++));
walk(out);
console.log(`built ${n} files into ${path.relative(root, out) || out}`);
