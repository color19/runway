import { investedByProject, investedDays, investedOn, sessionsOf, sessionsOn, sessionsWithLogs } from '../src';
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

describe('旧版计时记录换算成灯', () => {
  const s2: Store = {
    projects: {}, settings: {},
    items: {
      i1: { title: 'Corp', project: 'cfa', log: { '2026-11-04': 1.5, '2026-11-03': 0.5 } },
      i2: { title: '旧任务', project: 'cfa', old: true, log: { '2026-10-10': 2 } },
      i3: { title: '没记时间', project: 'cfa' },
    },
    sessions: { s1: { item: 'i1', project: 'cfa', date: '2026-11-04', start: '09:00', mins: 60 } },
  };
  const all = sessionsWithLogs(s2);
  test('已有计时的部分不重复算', () => expect(investedOn(all, '2026-11-04')).toBe(1.5));
  test('只有旧版记录的日子也有灯', () => expect(investedOn(all, '2026-11-03')).toBe(0.5));
  test('隐藏的旧任务不算', () => expect(investedOn(all, '2026-10-10')).toBe(0));
});

describe('做完但没计时的事', () => {
  const s3: Store = {
    projects: {}, settings: {},
    items: {
      a: { title: '勾掉的', kind: 'task', project: 'cfa', done: true, doneOn: '2026-11-04', est: 2 },
      b: { title: '浮窗计时的', kind: 'task', project: 'cfa', done: true, doneOn: '2026-11-04', est: 2, actual: 1.5 },
      c: { title: '有记录的', kind: 'task', project: 'cfa', done: true, doneOn: '2026-11-04', est: 2, log: { '2026-11-04': 1 } },
      d: { title: '没做完', kind: 'task', project: 'cfa', done: false, date: '2026-11-04', est: 2 },
      e: { title: '日程', kind: 'event', done: true, doneOn: '2026-11-04', est: 1 },
    },
  };
  const all = sessionsOn(sessionsWithLogs(s3), '2026-11-04');
  const of = (item: string) => all.filter(x => x.item === item);
  test('没计时的按预计时长算，标成估计', () => { expect(of('a')[0].mins).toBe(120); expect(of('a')[0].estimated).toBe(true); });
  test('有实际用时的按实际算，不算估计', () => { expect(of('b')[0].mins).toBe(90); expect(of('b')[0].estimated).toBe(false); });
  test('有计时记录的只算记录，不重复', () => expect(of('c').map(x => x.mins)).toEqual([60]));
  test('没做完的和日程不算', () => { expect(of('d')).toEqual([]); expect(of('e')).toEqual([]); });
});
