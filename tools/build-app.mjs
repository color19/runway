// Bundles app into one HTML file.
//   dist/runway.html   page body only, the shape claude.ai artifacts expect
//   dist/preview/index.html the same page wrapped in a full document, for a local browser
//   dist/runway-share.html  the share build: everyone gets their own empty copy, no example data
//   dist/preview-share/index.html its local preview
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(root + 'app/template.html', 'utf8');

for (const [share, name, preview] of [[false, 'runway.html', 'preview'], [true, 'runway-share.html', 'preview-share']]) {
  const out = await build({ entryPoints: [root + 'app/main.ts'], bundle: true, loader: { '.mp3': 'dataurl' }, format: 'iife', target: 'es2020', minify: true, write: false, define: { __SHARE__: String(share) } });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const page = template.replace('/*BUNDLE*/', () => js);
  mkdirSync(root + 'dist/' + preview, { recursive: true });
  writeFileSync(root + 'dist/' + name, page);
  writeFileSync(root + 'dist/' + preview + '/index.html',
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + page + '\n</body></html>');
  console.log(`built dist/${name} (${(page.length / 1024).toFixed(1)} KB)`);
}
