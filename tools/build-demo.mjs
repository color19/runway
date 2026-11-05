// Bundles app/demo into one HTML file.
//   dist/runway-demo.html   page body only, the shape claude.ai artifacts expect
//   dist/preview/index.html the same page wrapped in a full document, for a local browser
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = await build({ entryPoints: [root + 'app/demo/main.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(root + 'app/demo/template.html', 'utf8').replace('/*BUNDLE*/', () => js);

mkdirSync(root + 'dist/preview', { recursive: true });
writeFileSync(root + 'dist/runway-demo.html', page);
writeFileSync(root + 'dist/preview/index.html',
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + page + '\n</body></html>');
console.log(`built dist/runway-demo.html (${(page.length / 1024).toFixed(1)} KB)`);
