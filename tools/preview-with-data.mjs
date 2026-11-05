// Builds a local preview of the app filled with a copy of real data, for checking a design change by eye.
//   node tools/preview-with-data.mjs <dir>
// <dir> holds items/, projects/, settings/, notes/ with one JSON file per document (as ArtifactData's out_dir writes them).
// Keep <dir> out of git (.seed/ is ignored): it is the user's own data.
// Output: dist/preview-data/index.html (serve that folder with any static server).
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = path.resolve(process.argv[2] || '.seed/db');
const data = {};
for (const col of ['items', 'projects', 'settings', 'notes']) {
  data[col] = {};
  const d = path.join(dir, col);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith('.json')) data[col][f.slice(0, -5)] = JSON.parse(readFileSync(path.join(d, f), 'utf8'));
}
const out = await build({
  entryPoints: [root + 'app/main.ts'], bundle: true, format: 'iife', target: 'es2020', write: false,
  plugins: [{ name: 'real-data', setup(b) {
    b.onResolve({ filter: /^\.\/seed$/ }, () => ({ path: 'seed', namespace: 'real' }));
    b.onLoad({ filter: /.*/, namespace: 'real' }, () => ({ contents: `export const seed = () => structuredClone(${JSON.stringify(data)});`, loader: 'js' }));
  } }],
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(root + 'app/template.html', 'utf8').replace('/*BUNDLE*/', () => js);
mkdirSync(root + 'dist/preview-data', { recursive: true });
writeFileSync(root + 'dist/preview-data/index.html', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + page + '</body></html>');
console.log(`preview with ${Object.keys(data.items).length} items → dist/preview-data/index.html`);
