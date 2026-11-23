// Topic dates are a deliberate step beyond the old page, which never scheduled by them.
// Projects without a date still match it exactly: see legacy-parity.test.ts.
import { describe, expect, test } from 'vitest';
import { createEngine, drawer, sum } from '../src';

const task = (module: string, hours: number, order: number, extra: Record<string, unknown> = {}) => ({ kind: 'task', title: `t${order}`, project: 'p', module, hours, est: hours, order, ...extra });
const store = (due: string, items: Record<string, any> = { a: task('m1', 6, 2), b: task('m2', 10, 1) }) => ({
  settings: { main: { cap: [4, 4, 4, 4, 4, 4, 4] } },
  projects: { p: { name: 'P', start: '2026-11-01', deadline: '2026-12-11', modules: [{ id: 'm1', name: '期中', due }, { id: 'm2', name: '期末' }] } },
  items,
});
const planned = (s: any, D: string) => createEngine(s, D).allocate(D).byProj.p;
const until = (m: Record<string, number>, last: string) => sum(Object.entries(m).filter(([d]) => d <= last).map(([, h]) => h));

describe('topic deadline', () => {
  test("all of a dated topic's hours land before its date", () => {
    const m = planned(store('2026-11-27'), '2026-11-23');
    expect(until(m, '2026-11-26')).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(sum(Object.values(m))).toBeCloseTo(16);
  });

  test('a date already past puts nothing on today: same plan as no date at all', () => {
    expect(planned(store('2026-10-17'), '2026-11-23')).toEqual(planned(store(''), '2026-11-23'));
  });

  test('a date after the project ends changes nothing', () => {
    expect(planned(store('2026-12-20'), '2026-11-23')).toEqual(planned(store(''), '2026-11-23'));
  });

  test('steps count under their top task, finishing one today does not shrink today', () => {
    const open = { top: task('m1', 0, 1), s: task('', 3, 2, { parent: 'top' }), r: task('', 3, 3, { parent: 'top' }), b: task('m2', 10, 4) };
    const done = { ...open, s: { ...open.s, done: true, doneOn: '2026-11-23' } };
    const a = planned(store('2026-11-27'), '2026-11-23');
    expect(planned(store('2026-11-27', open), '2026-11-23')['2026-11-23']).toBeCloseTo(a['2026-11-23']);
    expect(planned(store('2026-11-27', done), '2026-11-23')['2026-11-23']).toBeCloseTo(a['2026-11-23']);
  });

  test('the drawer lists tasks of a topic with a coming date first; a past date does not', () => {
    const ids = (due: string) => drawer(createEngine(store(due), '2026-11-23'))[0].items.map(i => i.id);
    expect(ids('2026-11-27')).toEqual(['a', 'b']);
    expect(ids('2026-10-17')).toEqual(['b', 'a']);
  });
});
