import { describe, expect, test } from 'vitest';
import { createEngine, descendants, orderPatch, projectTree } from '../src';

const store = () => ({
  projects: { p: { name: 'CFA', start: '2026-10-01', deadline: '2026-11-17', modules: [{ id: 'm-fi', name: '固定收益' }, { id: 'm-eq', name: '权益' }] } },
  items: {
    a: { title: 'FI 32 题', project: 'p', module: 'm-fi', hours: 0, order: 1 },
    a1: { title: '画四行表', project: 'p', module: '', hours: 0.25, order: 1, parent: 'a' },
    a2: { title: '计时做题', project: 'p', module: '', hours: 1, order: 2, parent: 'a', done: true, doneOn: '2026-11-04' },
    a21: { title: '利率风险 7 题', project: 'p', hours: 0.2, order: 1, parent: 'a2' },
    a211: { title: '太深的一层', project: 'p', hours: 0.1, order: 1, parent: 'a21' },
    b: { title: 'Equity 串讲', project: 'p', module: 'm-eq', hours: 2, order: 2 },
    c: { title: '没模块', project: 'p', hours: 1, order: 3 },
    o: { title: '父亲不在', project: 'p', module: 'm-eq', hours: 1, order: 4, parent: 'gone' },
    x: { title: '环 1', project: 'p', module: 'm-eq', hours: 1, order: 5, parent: 'y' },
    y: { title: '环 2', project: 'p', module: 'm-eq', hours: 1, order: 6, parent: 'x' },
    other: { title: '别的项目', project: 'q', hours: 1 },
  } as Record<string, any>,
  settings: {},
});

describe('项目里的任务树', () => {
  const s = store();
  const eng = createEngine(s as any, '2026-11-04');
  const p = eng.derive().projMap.get('p')!;
  const parentOf = (id: string) => s.items[id]?.parent;
  const groups = projectTree(p, eng.derive().items, parentOf);
  const fi = groups.find(g => g.id === 'm-fi')!;

  test('模块 › 任务 › 小任务 › 更小的', () => {
    expect(fi.nodes.map(n => n.item.title)).toEqual(['FI 32 题']);
    const a = fi.nodes[0];
    expect(a.children.map(n => n.item.title)).toEqual(['画四行表', '计时做题']);
    expect(a.children[1].children.map(n => n.item.title)).toEqual(['利率风险 7 题', '太深的一层']);
    expect(a.children[1].children[0].depth).toBe(3);
  });
  test('小任务跟着最上面那件事的模块走', () => expect(fi.total).toBe(5));
  test('还剩的时间只算没做完的', () => expect(fi.nodes[0].hours).toBeCloseTo(0.25 + 0.2 + 0.1));
  test('没做完的件数', () => expect(fi.open).toBe(4));
  test('父亲找不到就放回模块顶层', () => expect(groups.find(g => g.id === 'm-eq')!.nodes.map(n => n.item.title)).toContain('父亲不在'));
  test('互相指着的不会卡死，都留在树里', () => {
    const eq = groups.find(g => g.id === 'm-eq')!;
    expect(eq.total).toBe(4);
  });
  test('没模块的单独一组', () => expect(groups[groups.length - 1].nodes.map(n => n.item.title)).toEqual(['没模块']));
  test('别的项目的事不进来', () => expect(groups.flatMap(g => g.nodes).some(n => n.item.title === '别的项目')).toBe(false));
  test('找出一件事下面所有的小任务', () => expect(descendants('a', Object.entries(s.items).map(([id]) => ({ id })), parentOf).sort()).toEqual(['a1', 'a2', 'a21', 'a211']));
});

describe('把一件事挪到另一件前面', () => {
  const sibs = [{ id: 'a', order: 1, title: 'a' }, { id: 'b', order: 2, title: 'b' }, { id: 'c', order: 3, title: 'c' }];
  const after = (list: typeof sibs, moving: string, before: string | null) => {
    const p = orderPatch(list, moving, before), all = list.some(s => s.id === moving) ? list : [...list, { id: moving, order: 0, title: moving }];
    return all.map(s => ({ ...s, order: p[s.id] ?? s.order })).sort((x, y) => x.order - y.order || x.title.localeCompare(y.title)).map(s => s.id).join('');
  };
  test('挪到中间，只改它自己', () => {
    expect(Object.keys(orderPatch(sibs, 'c', 'b'))).toEqual(['c']);
    expect(after(sibs, 'c', 'b')).toBe('acb');
  });
  test('挪到最前和最后', () => {
    expect(after(sibs, 'c', 'a')).toBe('cab');
    expect(after(sibs, 'a', null)).toBe('bca');
  });
  test('从别处挪进来', () => expect(after(sibs, 'x', 'b')).toBe('axbc'));
  test('前后两件顺序号一样时，整排重新编号', () => {
    const tie = [{ id: 'a', order: 0, title: 'a' }, { id: 'b', order: 0, title: 'b' }, { id: 'c', order: 0, title: 'c' }];
    expect(after(tie, 'c', 'b')).toBe('acb');
    expect(after(tie, 'a', null)).toBe('bca');
  });
  test('只有它自己时不用改', () => expect(orderPatch([sibs[0]], 'a', null)).toEqual({}));
});
