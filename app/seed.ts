// Example data for the visual demo: what the CFA run-up looks like, dated relative to today.
import type { Day, Store } from '../engine/src';
import { add } from '../engine/src';

export function seed(T: Day): Store {
  const d = (n: number) => add(T, n);
  const task = (title: string, project: string, module: string, hours: number, extra: Record<string, unknown> = {}) =>
    ({ kind: 'task', title, project, module, hours, est: hours, done: false, date: null, time: '', end: '', ...extra });
  let order = 0;
  const items: Store['items'] = {};
  const put = (x: Record<string, any>) => { order++; items['i' + order] = { order, ...x }; };

  // today
  put(task('Corp 一刷 · 资本结构', 'cfa', 'm-ci', 2, { date: d(0), done: true, doneOn: d(0) }));
  put(task('PM 一刷 · 第 3 章 风险与收益', 'cfa', 'm-pm', 1.5, { date: d(0) }));
  put(task('Deriv 一刷 · 期权基础', 'cfa', 'm-der', 2, { date: d(0) }));
  put(task('632 作业 3 · 跑回归', 'c632', '', 1.5, { date: d(0) }));
  put(task('晚饭 + 散步', '', '', 0.75, { date: d(0), time: '18:30', end: '19:15' }));
  // later days
  put(task('PM 一刷 · 第 4 章', 'cfa', 'm-pm', 2, { date: d(1) }));
  put(task('643 Project · 回归结果', 'p643', '', 2, { date: d(1) }));
  put({ kind: 'event', title: '643 课', date: d(1), time: '18:00', end: '20:30' });
  put(task('模考 1（整套）', 'cfa', 'm-mock', 4.5, { date: '2026-11-09' }));
  put(task('模考 2（整套）', 'cfa', 'm-mock', 4.5, { date: '2026-11-13' }));
  put(task('模考 3（整套）', 'cfa', 'm-mock', 4.5, { date: '2026-11-15' }));
  put({ kind: 'deadline', title: 'Akuna OA 截止', date: '2026-11-12' });
  put({ kind: 'exam', title: 'CFA 考试', date: '2026-11-17' });
  // left over from an earlier day: comes back to the drawer, no overdue mark
  put(task('Deriv 一刷 · 远期与期货', 'cfa', 'm-der', 2, { date: d(-2) }));
  // not on any day yet
  put(task('Econ 一刷 · 第 1–4 章', 'cfa', 'm-econ', 3));
  put(task('Econ 一刷 · 第 5–8 章', 'cfa', 'm-econ', 3));
  put(task('Ethics 一刷 · 标准 I–III', 'cfa', 'm-eth', 2));
  put(task('Ethics 一刷 · 标准 IV–VII', 'cfa', 'm-eth', 2));
  put(task('Alt 一刷', 'cfa', 'm-alt', 3));
  put(task('错题二刷 · FSA', 'cfa', 'm-mock', 2));
  put(task('632 作业 3 · 写结论', 'c632', '', 1));
  put(task('643 Project · 写报告', 'p643', '', 3));
  put(task('643 Project · 做 slides', 'p643', '', 2));
  put(task('Akuna OA', 'job', '', 1.5));
  put(task('交房租', '', '', 0.25));
  put(task('洗衣服', '', '', 0.5));
  put(task('买菜', '', '', 0.75));

  // focus sessions: today so far, plus the last six days
  const sessions: Store['sessions'] = {};
  let sn = 0;
  const sess = (n: number, project: string, item: string, start: string, mins: number) => { sessions['s' + (++sn)] = { date: d(n), project, item, start, mins }; };
  sess(0, 'cfa', 'i1', '08:50', 45); sess(0, 'cfa', 'i1', '09:45', 50); sess(0, 'cfa', 'i1', '10:45', 25);
  sess(0, 'cfa', 'i2', '14:10', 10); sess(0, 'cfa', 'i2', '14:25', 20); sess(0, 'c632', 'i4', '16:00', 35);
  const past: Array<[number, string, number[]]> = [
    [-1, 'cfa', [50, 45, 30]], [-1, 'p643', [40]], [-1, 'job', [20]],
    [-2, 'cfa', [25, 45, 60]], [-2, 'c632', [35]],
    [-3, 'p643', [95]], [-3, 'cfa', [30]], [-3, 'job', [20]],
    [-4, 'cfa', [10, 20, 30, 45]],
    [-5, 'cfa', [60]], [-5, 'c632', [50]], [-5, 'p643', [25]], [-5, '', [8]],
    [-6, 'cfa', [45, 45]],
  ];
  for (const [n, p, ms] of past) ms.forEach((m, i) => sess(n, p, '', `${String(9 + i * 2).padStart(2, '0')}:00`, m));

  return {
    sessions,
    settings: { main: { cap: [8, 8, 8, 8, 8, 8, 8], balance: true } },
    projects: {
      cfa: { name: 'CFA Level 1', start: '2026-10-02', deadline: '2026-11-17', buffer: 1, color: '#5B7FB8',
        modules: [
          { id: 'm-ci', name: '公司发行人' }, { id: 'm-pm', name: '组合管理' }, { id: 'm-der', name: '衍生品' },
          { id: 'm-econ', name: '经济学' }, { id: 'm-eth', name: '道德' }, { id: 'm-alt', name: '另类投资' }, { id: 'm-mock', name: '模考与错题' },
        ] },
      c632: { name: '632 作业 3', start: d(-4), deadline: d(3), color: '#3E8A5E' },
      p643: { name: '643 Project', start: '2026-10-20', deadline: '2026-11-14', color: '#8E6CC4' },
      job: { name: '求职', start: '2026-10-15', deadline: '2026-12-31', color: '#D08A1E',
        count: { unit: '份', mins: 20, plan: [{ from: '2026-10-15', n: 2 }], log: { [d(-3)]: 2, [d(-2)]: 1, [d(-1)]: 2, [d(0)]: 1 } } },
    },
    items,
  };
}
