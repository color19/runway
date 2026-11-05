import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, sum, fmtH } from '../src';

const store = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/synthetic.json', import.meta.url)), 'utf8'));
const D = '2026-11-04';
const eng = createEngine(store, D);
const proj = (id: string) => eng.derive().projMap.get(id)!;

describe('每天可用时间', () => {
  test('按星期取默认值', () => { expect(eng.capOf('2026-11-04')).toBe(8); expect(eng.capOf('2026-11-07')).toBe(6); });
  test('单日覆盖', () => expect(eng.capOf('2026-11-08')).toBe(4));
  test('请假日为 0', () => expect(eng.capOf('2026-11-12')).toBe(0));
});

describe('倒推分配', () => {
  const a = eng.allocate(D);
  test('不往请假日分时间', () => expect(a.byDay['2026-11-12']).toBeUndefined());
  test('CFA 留了 1 天缓冲：考试前一天之后不再分', () => {
    expect(a.byProj['p-cfa']['2026-11-15']).toBeGreaterThan(0);
    expect(a.byProj['p-cfa']['2026-11-16']).toBeUndefined();
  });
  test('分出去的总量等于剩余量', () => {
    const p = proj('p-cfa');
    expect(sum(Object.values(a.byProj['p-cfa']))).toBeCloseTo(eng.remStart(p, D), 6);
  });
  test('求职投递按份数占时间：每天 3 份 × 15 分钟', () => expect(a.byProj['p-job'][D]).toBeCloseTo(0.75, 6));
  test('还没开始的项目从开始日才分', () => {
    const days = Object.keys(a.byProj['p-later']).sort();
    expect(days[0]).toBe('2026-12-01');
  });
});

describe('项目状态', () => {
  test('今天每个项目都有判断', () => {
    for (const p of eng.derive().projects) expect(eng.projStatus(p).k).toBeDefined();
  });
  test('空项目提示添加任务', () => expect(eng.projStatus(proj('p-empty')).label).toBe('待加任务'));
  test('还没开始的项目', () => expect(eng.projStatus(proj('p-later')).label).toBe('还没开始'));
  test('求职投递记欠账', () => {
    const s = eng.projStatus(proj('p-job'));
    expect(s.cnt!.debt).toBeGreaterThan(0);
    expect(s.label).toMatch(/^欠 \d+ 份$/);
  });
});

test('时长格式', () => {
  expect(fmtH(0.75)).toBe('45m');
  expect(fmtH(2)).toBe('2h');
  expect(fmtH(2.75)).toBe('2h45m');
});
