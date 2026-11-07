import { calSamples, calibrate, calibrationFor } from '../src';
import type { Store } from '../src';

const T = '2026-11-06';
const task = (project: string, est: number, logged: number, doneOn = '2026-11-01', extra: Record<string, any> = {}) =>
  ({ kind: 'task', title: 't', project, est, hours: est, done: true, doneOn, log: logged ? { [doneOn]: logged } : {}, ...extra });

function storeOf(list: Array<Record<string, any>>): Store {
  const items: Store['items'] = {};
  list.forEach((x, i) => { items['i' + i] = x; });
  return { items, projects: {}, settings: {} };
}

test('只算做完、有预计、计过时的事', () => {
  const s = storeOf([
    task('cfa', 1, 1.5),
    task('cfa', 0, 2),
    task('cfa', 1, 0),
    { ...task('cfa', 1, 2), done: false },
    { ...task('cfa', 1, 2), old: true },
    { ...task('cfa', 1, 2), kind: 'exam' },
    task('cfa', 2, 0, '2026-11-01', { actual: 3 }),
  ]);
  expect(calSamples(s, T).map(x => x.real).sort()).toEqual([1.5, 3]);
});

test('只看最近 30 天', () => {
  const s = storeOf([task('cfa', 1, 2, '2026-10-08'), task('cfa', 1, 2, '2026-10-07')]);
  expect(calSamples(s, T).map(x => x.doneOn)).toEqual(['2026-10-08']);
});

test('偏差超过 6 倍的不算', () => {
  const s = calSamples(storeOf([task('cfa', 1, 7), task('cfa', 1, 0.1), task('cfa', 1, 6)]), T);
  expect(s.filter(x => x.odd).length).toBe(2);
});

test('不到 5 件不下结论', () => {
  expect(calibrate(calSamples(storeOf([1, 2, 3, 4].map(() => task('cfa', 1, 2))), T)).factor).toBeNull();
});

test('取中间值，件数少时往 1 倍靠', () => {
  // ratios 1, 1.5, 2, 2, 5 → median 2; 5 samples pull it to 1 + 1 × 5/8 = 1.625 → 1.65 after rounding to 0.05
  const s = calSamples(storeOf([1, 1.5, 2, 2, 5].map(r => task('cfa', 1, r))), T);
  expect(calibrate(s).factor).toBe(1.65);
});

test('项目自己的样本不够就用所有项目的', () => {
  const s = storeOf([...[2, 2, 2, 2, 2].map(r => task('cfa', 1, r)), task('643', 1, 1)]);
  const own = calibrationFor(s, T, 'cfa'), other = calibrationFor(s, T, '643');
  expect(own.own).toBe(true);
  expect(other.own).toBe(false);
  expect(other.n).toBe(6);
});
