// The engine must give exactly what the old page gives. tools/legacy-oracle.mjs runs the original
// functions from legacy/runway.html; this test compares both on real and synthetic data.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src';

const root = fileURLToPath(new URL('../..', import.meta.url));

const CASES: Array<[string, string[]]> = [
  ['engine/test/fixtures/backup-2026-10-07.json', ['2026-10-01', '2026-10-07', '2026-10-20', '2026-11-04', '2026-11-16', '2026-11-17', '2026-12-25']],
  ['engine/test/fixtures/synthetic.json', ['2026-10-10', '2026-11-04', '2026-11-08', '2026-11-12', '2026-11-16', '2026-11-18', '2026-12-31']],
];

/** Round every number so float noise below 1e-9 doesn't count as a difference. */
const tidy = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_k, v) => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v));

describe.each(CASES)('与旧版一致：%s', (fixture, dates) => {
  const store = JSON.parse(readFileSync(root + fixture, 'utf8'));
  const oracle = JSON.parse(execFileSync('node', [root + 'tools/legacy-oracle.mjs', root + fixture, ...dates], { encoding: 'utf8' }));

  test.each(dates)('%s 的分配和项目状态', D => {
    const eng = createEngine(store, D);
    const status = Object.fromEntries(eng.derive().projects.map(p => [p.id, eng.projStatus(p, D)]));
    expect(tidy(eng.allocate(D))).toEqual(tidy(oracle[D].alloc));
    expect(tidy(status)).toEqual(tidy(oracle[D].status));
  });
});
