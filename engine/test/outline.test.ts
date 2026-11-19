import { describe, expect, test } from 'vitest';
import { applyOutline, parseHours, settleDepths, subtreeEnd, toOutline, type OutlineRow } from '../src';
import type { ModuleGroup } from '../src';

const items = (): Record<string, any> => ({
  a: { kind: 'task', title: '读论文', project: 'p', module: 'm1', parent: '', hours: 1.5, est: 1.5, order: 10, date: '2026-11-20', log: { '2026-11-18': 0.5 }, note: '第 3 节' },
  b: { kind: 'task', title: '清洗数据', project: 'p', module: 'm1', parent: '', hours: 1, est: 1, order: 11 },
  c: { kind: 'task', title: '写报告', project: 'p', module: 'm2', parent: '', hours: 2, est: 2, order: 12, done: true, doneOn: '2026-11-10' },
  z: { kind: 'task', title: '别的项目', project: 'q', hours: 1, order: 50 },
});
const mods = () => [{ id: 'm1', name: '复现' }, { id: 'm2', name: '报告', due: '2026-12-01' }];
const before: OutlineRow[] = [
  { id: 'm1', depth: 0, title: '复现', hours: 0, done: false },
  { id: 'a', depth: 1, title: '读论文', hours: 1.5, done: false },
  { id: 'b', depth: 1, title: '清洗数据', hours: 1, done: false },
  { id: 'm2', depth: 0, title: '报告', hours: 0, done: false },
  { id: 'c', depth: 1, title: '写报告', hours: 2, done: true },
];
const ids = () => { let n = 0; return (k: 'm' | 'i') => `${k}${++n}`; };
const run = (rows: OutlineRow[], its = items()) => applyOutline({ rows, before, pid: 'p', items: its, modules: mods(), newId: ids() });

describe('outline', () => {
  test('reads hours the way people type them', () => {
    expect(parseHours('1h30m')).toBe(1.5);
    expect(parseHours('90m')).toBe(1.5);
    expect(parseHours('1:30')).toBe(1.5);
    expect(parseHours('1.5h')).toBe(1.5);
    expect(parseHours('45')).toBe(0.75);
    expect(parseHours('2')).toBe(2);
    expect(parseHours('40分钟')).toBe(0.67);
    expect(parseHours('2小时')).toBe(2);
    expect(parseHours('')).toBe(0);
    expect(parseHours('abc')).toBe(0);
  });

  test('lays the project out as blocks, tasks and steps', () => {
    const it = (id: string, title: string, hours: number, done = false) => ({ id, title, hours, done } as any);
    const groups: ModuleGroup[] = [
      { id: 'm1', name: '复现', due: '', total: 0, open: 0, hours: 0, nodes: [{ item: it('a', '读论文', 0), depth: 1, total: 2, open: 2, hours: 1, children: [{ item: it('a1', '第一节', 1), depth: 2, total: 1, open: 1, hours: 1, children: [] }] }] },
      { id: '', name: '还没分块', due: '', total: 0, open: 0, hours: 0, nodes: [{ item: it('x', '散的', 0.5), depth: 1, total: 1, open: 1, hours: 0.5, children: [] }] },
    ];
    expect(toOutline(groups, mods()).map(r => [r.id, r.depth])).toEqual([['x', 1], ['m1', 0], ['a', 1], ['a1', 2], ['m2', 0]]);
  });

  test('a line cannot sit more than one level below the line above it', () => {
    const r = (depth: number) => ({ id: '', depth, title: 't', hours: 0, done: false });
    expect(settleDepths([r(0), r(3), r(2), r(0), r(2)]).map(x => x.depth)).toEqual([0, 1, 2, 0, 1]);
    expect(subtreeEnd([r(1), r(2), r(3), r(1)], 0)).toBe(3);
  });

  test('nothing changed, nothing written', () => {
    const p = run(before);
    expect(p.puts).toEqual([]);
    expect(p.drops).toEqual([]);
    expect(p.modules).toEqual(mods());
  });

  test('renaming and re-timing keep the task and everything the outline does not show', () => {
    const rows = before.map(r => r.id === 'a' ? { ...r, title: '精读论文', hours: 2 } : r.id === 'm1' ? { ...r, title: '复现模型' } : r);
    const p = run(rows);
    expect(p.modules[0]).toEqual({ id: 'm1', name: '复现模型' });
    expect(p.modules[1]).toEqual({ id: 'm2', name: '报告', due: '2026-12-01' });
    const [id, a] = p.puts[0];
    expect(id).toBe('a');
    expect(a).toMatchObject({ title: '精读论文', hours: 2, est: 1.5, date: '2026-11-20', note: '第 3 节', log: { '2026-11-18': 0.5 } });
  });

  test('indenting makes a step; the task above hands its hours to its steps', () => {
    const rows = before.map(r => r.id === 'b' ? { ...r, depth: 2 } : r);
    const p = run(rows);
    const got = Object.fromEntries(p.puts);
    expect(got.a).toMatchObject({ hours: 0, est: 0, split: { hours: 1.5, est: 1.5 } });
    expect(got.b).toMatchObject({ parent: 'a', module: 'm1' });
  });

  test('new lines become new blocks and tasks, and take orders after everything else', () => {
    const rows = [...before, { id: '', depth: 0, title: '复习', hours: 0, done: false }, { id: '', depth: 1, title: '过一遍', hours: 0.5, done: false }, { id: '', depth: 1, title: '   ', hours: 0, done: false }];
    const p = run(rows);
    expect(p.modules.map(m => m.name)).toEqual(['复现', '报告', '复习']);
    expect(p.puts).toHaveLength(1);
    const [, n] = p.puts[0];
    expect(n).toMatchObject({ title: '过一遍', project: 'p', module: p.modules[2].id, parent: '', hours: 0.5, est: 0.5, order: 51, done: false, date: null });
  });

  test('moving a task down swaps the orders it had, without touching other projects', () => {
    const rows = [before[0], before[2], before[1], before[3], before[4]];
    const got = Object.fromEntries(run(rows).puts);
    expect(got.b.order).toBe(10);
    expect(got.a.order).toBe(11);
    expect(got.z).toBeUndefined();
  });

  test('a removed line is put aside, not erased; a removed block leaves its tasks to the block above', () => {
    const rows = [before[0], before[1], before[4]];
    const p = run(rows);
    expect(p.drops).toEqual(['b']);
    expect(p.modules.map(m => m.id)).toEqual(['m1']);
    expect(Object.fromEntries(p.puts).c).toMatchObject({ module: 'm1', done: true });
  });

  test('a done task that gets an open step opens again', () => {
    const rows = [...before, { id: '', depth: 2, title: '补一张图', hours: 0.5, done: false }];
    const got = Object.fromEntries(run(rows).puts);
    expect(got.c).toMatchObject({ done: false, doneOn: null });
  });

  test('steps sharing a number and a step whose block field is empty are left alone', () => {
    const its = { ...items(), s1: { kind: 'task', title: 'alpha', project: 'p', module: '', parent: 'a', hours: 1, order: 1 }, s2: { kind: 'task', title: 'beta', project: 'p', module: '', parent: 'a', hours: 1, order: 1 } };
    const rows = [before[0], { ...before[1], hours: 0 }, { id: 's1', depth: 2, title: 'alpha', hours: 1, done: false }, { id: 's2', depth: 2, title: 'beta', hours: 1, done: false }, ...before.slice(2)];
    const p = applyOutline({ rows, before: rows, pid: 'p', items: its, modules: mods(), newId: ids() });
    expect(p.puts.map(([k]) => k)).toEqual(['a']);
  });
});
