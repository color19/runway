import { investedByProject, investedDays, investedOn, sessionsOf, sessionsOn } from '../src';
import type { Store } from '../src';

const store: Store = {
  items: {}, projects: {}, settings: {},
  sessions: {
    s1: { item: 'i1', project: 'cfa', date: '2026-11-04', start: '14:10', mins: 25 },
    s2: { item: 'i1', project: 'cfa', date: '2026-11-04', start: '09:00', mins: 45 },
    s3: { item: 'i9', project: '', date: '2026-11-04', start: '19:00', mins: 3 },
    s4: { item: 'i2', project: 'p643', date: '2026-11-02', start: '10:00', mins: 90 },
    bad: { item: 'x', project: 'cfa', date: 'not a day', mins: 30 },
    zero: { item: 'x', project: 'cfa', date: '2026-11-04', mins: 0 },
  },
};
const all = sessionsOf(store);

test('丢掉日期不对和时长为 0 的记录', () => expect(all.map(s => s.id).sort()).toEqual(['s1', 's2', 's3', 's4']));
test('同一天按开始时间排', () => expect(sessionsOn(all, '2026-11-04').map(s => s.id)).toEqual(['s2', 's1', 's3']));
test('三分钟也算数', () => expect(investedOn(all, '2026-11-04')).toBeCloseTo(73 / 60, 9));
test('按项目汇总', () => {
  const by = investedByProject(all);
  expect(by.cfa).toBeCloseTo(70 / 60, 9);
  expect(by.p643).toBe(1.5);
  expect(by['']).toBeCloseTo(3 / 60, 9);
});
test('最近 7 天，没投入的日子是 0', () => {
  const days = investedDays(all, '2026-11-04', 7);
  expect(days.map(d => d.date)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  expect(days[3].hours).toBe(0);
  expect(days[4].hours).toBe(1.5);
});
test('旧备份没有专注记录也能读', () => expect(sessionsOf({ items: {}, projects: {}, settings: {} })).toEqual([]));
