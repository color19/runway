// Runs the planning functions straight out of legacy/runway.html in a Node sandbox,
// so the TypeScript engine can be checked against the exact behaviour of the page.
// Usage: node tools/legacy-oracle.mjs <fixture.json> <date> [<date> ...]  → JSON on stdout
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lines = readFileSync(root + 'legacy/runway.html', 'utf8').split('\n');

// Line ranges are pinned to legacy/runway.html as copied on 2026-11-04. The marker check below
// fails loudly if the file ever changes underneath them.
const RANGES = [[1165, 1182], [1186, 1186], [1204, 1207], [1312, 1314], [1395, 1604], [2922, 2922]];
const MARKERS = { 1165: 'const pad', 1395: 'function settings()', 1466: 'function allocate(D)', 1550: 'function projStatus(', 2922: 'const needsReest' };
for (const [n, m] of Object.entries(MARKERS)) {
  if (!lines[n - 1].startsWith(m)) throw new Error(`legacy/runway.html line ${n} no longer starts with "${m}"`);
}
const src = RANGES.map(([a, b]) => lines.slice(a - 1, b).join('\n')).join('\n') +
  '\nglobalThis.__api = { S, allocate, projStatus, derive, bump: () => { ver++; } };';

const [fixturePath, ...dates] = process.argv.slice(2);
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));

const out = {};
for (const D of dates) {
  const ctx = vm.createContext({ console });
  const noon = new Date(+D.slice(0, 4), +D.slice(5, 7) - 1, +D.slice(8, 10), 12).getTime();
  vm.runInContext(`Date.now = () => ${noon};`, ctx);
  vm.runInContext(src, ctx);
  const api = ctx.__api;
  api.S.items = structuredClone(fx.items || {});
  api.S.projects = structuredClone(fx.projects || {});
  api.S.settings = structuredClone(fx.settings || {});
  api.bump();
  const dv = api.derive();
  const alloc = api.allocate(D);
  out[D] = {
    alloc: JSON.parse(JSON.stringify(alloc)),
    status: Object.fromEntries(dv.projects.map(p => [p.id, JSON.parse(JSON.stringify(api.projStatus(p, D)))])),
  };
}
process.stdout.write(JSON.stringify(out));
