import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, dayLoads, dayShares, drawer, hm, ifToday, lineage, pickOrder } from '../src';

const base = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/synthetic.json', import.meta.url)), 'utf8'));
const D = '2026-11-04';
const fresh = () => structuredClone(base);

describe('项目抽屉', () => {
  const eng = createEngine(base, D);
  const groups = drawer(eng);
  const titles = (pid: string) => groups.find(g => g.project?.id === pid)?.items.map(i => i.title) ?? [];

  test('列出没排日期的事', () => expect(titles('p-cfa')).toEqual(expect.arrayContaining(['Econ 一刷', 'Ethics 一刷', 'Alt 一刷'])));
  test('今天和以后已排好的不在抽屉里', () => {
    expect(titles('p-cfa')).not.toContain('Corp 一刷');
    expect(titles('p-cfa')).not.toContain('PM 一刷');
  });
  test('做完的不在抽屉里', () => expect(titles('p-cfa')).not.toContain('FSA 复习'));
  test('以前日期没做完的安静地回到抽屉，不另外标逾期', () => {
    const s = fresh(); s.items.t2.date = '2026-11-01';
    const g = drawer(createEngine(s, D)).find(x => x.project?.id === 'p-cfa')!;
    expect(g.items.map(i => i.title)).toContain('PM 一刷');
  });
  test('每组带项目状态和今天目标', () => {
    const g = groups.find(x => x.project?.id === 'p-cfa')!;
    expect(g.status?.label).toBeTruthy();
    expect(g.quotaToday).toBeGreaterThan(0);
  });
  test('还没开始但有工作量的项目也在', () => expect(groups.some(g => g.project?.id === 'p-later')).toBe(true));
  test('没有项目的事单独一组放最后', () => {
    const s = fresh(); s.items.x1.date = null;
    const gs = drawer(createEngine(s, D));
    expect(gs[gs.length - 1].project).toBeNull();
    expect(gs[gs.length - 1].items.map(i => i.title)).toEqual(['没有项目的杂事']);
  });
});

describe('现在做哪一件', () => {
  const s = fresh();
  s.items.a = { title: '上午整块', kind: 'task', date: D, time: '09:00', end: '11:00', hours: 2 };
  s.items.b = { title: '下午整块', kind: 'task', date: D, time: '14:00', end: '16:00', hours: 2 };
  const eng = createEngine(s, D);
  const order = (h: string) => pickOrder(eng, hm(h)!).map(i => i.title);

  // 2026-11-10 改过顺序：原来只要还没到点就排最前，下午 4 点打开会先给出晚上 7 点的事，
  // 眼前能做的反而排在后面。现在只有半小时内要开始的才抢在前面，离得远的排到最后。
  test('正在进行的时段排第一', () => expect(order('10:00')[0]).toBe('上午整块'));
  test('半小时内要开始的，排在随时能做的前面', () => expect(order('13:40')[0]).toBe('下午整块'));
  test('离开始还早的不抢在前面，排到最后', () => {
    const o = order('12:00');
    expect(['Corp 一刷', '没有项目的杂事']).toContain(o[0]);
    expect(o[o.length - 1]).toBe('下午整块');
  });
  test('过了开始时间的，排在没钟点的后面、还没到点的前面', () => {
    const o = order('12:00'), at = (t: string) => o.indexOf(t);
    expect(at('上午整块')).toBeGreaterThan(at('Corp 一刷'));
    expect(at('上午整块')).toBeGreaterThan(at('没有项目的杂事'));
    expect(at('上午整块')).toBeLessThan(at('下午整块'));
  });
  test('一天从 5 点算起时，凌晨的时段算当天夜里', () => {
    const n = fresh();
    n.settings.main.dayStart = 5;
    n.items.c = { title: '夜里整块', kind: 'task', date: D, time: '01:00', end: '02:00', hours: 1 };
    const e = createEngine(n, D), first = (h: string) => pickOrder(e, hm(h)!)[0].title;
    expect(first('01:30')).toBe('夜里整块');
    expect(first('15:00')).not.toBe('夜里整块');
  });
  test('不包含日程和做完的事', () => {
    const o = order('08:00');
    expect(o).not.toContain('643 课');
    expect(o.every(t => !['FSA 复习'].includes(t))).toBe(true);
  });
});

describe('每天的目标不超过那天能用的时间', () => {
  const total = (e: ReturnType<typeof createEngine>, d: string) => dayShares(e, d).list.reduce((a, [, h]) => a + h, 0);
  // every day has one hour: far less than the projects need, so each day is over full
  const tight = () => { const s = fresh(); s.settings.main.cap = [1, 1, 1, 1, 1, 1, 1]; s.settings.main.over = {}; return s; };
  test('接下来两周，每天分到的加起来都不超过能用的', () => {
    const eng = createEngine(base, D);
    for (const l of dayLoads(eng, D, 14)) expect(total(eng, l.date)).toBeLessThanOrEqual(l.cap + 1e-6);
  });
  test('排得下的日子，和引擎摊的一样', () => {
    const s = fresh(); s.settings.main.over[D] = 24;
    const eng = createEngine(s, D), sh = dayShares(eng, D);
    expect(sh.full).toBe(false);
    expect(total(eng, D)).toBeCloseTo(eng.dayNeed(D), 6);
  });
  test('排不下的日子，按数量算的目标先留够，其余按截止日先后给', () => {
    const eng = createEngine(tight(), D), sh = dayShares(eng, D), want = eng.allocate(D).byDay[D];
    expect(eng.dayNeed(D)).toBeGreaterThan(1);
    expect(sh.full).toBe(true);
    expect(total(eng, D)).toBeCloseTo(1, 6);
    expect(new Map(sh.list).get('p-job')).toBeCloseTo(Math.min(1, want['p-job']), 6);
  });
  test('抽屉里的今天目标跟着封顶，并标出排不下', () => {
    const gs = drawer(createEngine(tight(), D));
    expect(gs.reduce((a, g) => a + g.quotaToday, 0)).toBeLessThanOrEqual(1 + 1e-6);
    expect(gs.some(g => g.fullToday)).toBe(true);
  });
});

describe('安排到哪天', () => {
  const eng = createEngine(base, D);
  const loads = dayLoads(eng, D, 14);
  test('列出两周', () => { expect(loads).toHaveLength(14); expect(loads[0].date).toBe(D); });
  test('11 月 5 日已排 11 小时，可用 8 小时，超出 3 小时', () => {
    const d = loads.find(l => l.date === '2026-11-05')!;
    expect(d.placed).toBe(11); expect(d.cap).toBe(8); expect(d.room).toBe(-3);
  });
  test('请假日可用时间为 0', () => expect(loads.find(l => l.date === '2026-11-12')!.cap).toBe(0));
});

describe('来龙去脉', () => {
  const eng = createEngine(base, D);
  const item = (id: string) => eng.derive().items.find(i => i.id === id)!;
  test('带项目、模块和离考试几天', () => expect(lineage(eng, item('t1'))).toBe('CFA Level 1 › 公司发行人 · 离考试 13 天'));
  test('没有考试的项目说离截止', () => expect(lineage(eng, item('t13'))).toBe('643 Project · 离截止 10 天'));
  test('没有项目的事返回空', () => expect(lineage(eng, item('x1'))).toBe(''));
});

describe('今天只做一点，还来不来得及', () => {
  test('今天照常用满，判断不变', () => {
    const cap = createEngine(base, D).capOf(D);
    for (const r of ifToday(base, D, cap)) expect(r.after.label).toBe(r.before.label);
  });
  test('今天歇着，截止前的负荷只会更高', () => {
    const rs = ifToday(base, D, 0);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) if (r.before.press != null) expect(r.after.press!).toBeGreaterThanOrEqual(r.before.press - 1e-9);
    expect(rs.find(r => r.project.id === 'p-cfa')!.after.press!).toBeGreaterThan(rs.find(r => r.project.id === 'p-cfa')!.before.press!);
  });
  test('只是问一问，不改原来的数据', () => {
    const s = fresh(), before = JSON.stringify(s);
    ifToday(s, D, 0);
    expect(JSON.stringify(s)).toBe(before);
  });
  test('还没开始和没有工作量的项目不列出来', () => {
    const ids = ifToday(base, D, 0).map(r => r.project.id);
    expect(ids).not.toContain('p-later');
    expect(ids).not.toContain('p-empty');
  });
});
