import type { Item, Project } from './model';
import { sum } from './dates';

/** How deep a task can be split: task › step › smaller step. */
export const MAX_DEPTH = 3;

export interface TreeNode {
  item: Item;
  depth: number;
  children: TreeNode[];
  /** Tasks in this subtree, the node itself included. */
  total: number;
  open: number;
  /** Hours still to do in this subtree. */
  hours: number;
}
export interface ModuleGroup {
  id: string;
  name: string;
  due: string;
  nodes: TreeNode[];
  total: number;
  open: number;
  hours: number;
}

/**
 * Lays a project's tasks out as module › task › step › smaller step.
 * `parentOf` maps an item id to the id of the task it sits under (raw `parent` field, unknown to the old Runway).
 * A parent that is missing, in another project, or would make a loop is ignored; anything deeper than MAX_DEPTH hangs at the deepest level.
 * A step always shows under its top task's module.
 */
export function projectTree(project: Project, items: Item[], parentOf: (id: string) => string | undefined): ModuleGroup[] {
  const mine = items.filter(i => i.project === project.id && i.kind === 'task');
  const byId = new Map(mine.map(i => [i.id, i]));
  const up = (id: string) => { const p = parentOf(id); return p && p !== id && byId.has(p) ? p : ''; };
  // walk to the root, refusing loops
  const chain = (id: string) => { const seen = [id]; let p = up(id); while (p && !seen.includes(p)) { seen.push(p); p = up(p); } return { root: seen[seen.length - 1], loop: !!p }; };
  const effParent = new Map<string, string>();
  for (const i of mine) { const p = up(i.id); effParent.set(i.id, p && !chain(i.id).loop ? p : ''); }
  // cap depth: a too-deep item hangs under its ancestor at MAX_DEPTH - 1
  const depthOf = (id: string): number => { const p = effParent.get(id); return p ? depthOf(p) + 1 : 1; };
  for (const i of mine) {
    let p = effParent.get(i.id) || '';
    while (p && depthOf(p) >= MAX_DEPTH) p = effParent.get(p) || '';
    effParent.set(i.id, p);
  }
  const kids = new Map<string, Item[]>();
  for (const i of mine) { const p = effParent.get(i.id) || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p)!.push(i); }
  const order = (a: Item, b: Item) => a.order - b.order || a.title.localeCompare(b.title);
  const build = (it: Item, depth: number): TreeNode => {
    const children = (kids.get(it.id) || []).sort(order).map(c => build(c, depth + 1));
    const self = { total: 1, open: it.done ? 0 : 1, hours: it.done ? 0 : it.hours };
    return {
      item: it, depth, children,
      total: self.total + sum(children.map(c => c.total)),
      open: self.open + sum(children.map(c => c.open)),
      hours: self.hours + sum(children.map(c => c.hours)),
    };
  };
  const roots = (kids.get('') || []).sort(order).map(i => build(i, 1));
  const groups: ModuleGroup[] = project.modules.map(m => ({ id: m.id, name: m.name, due: String(m.due || ''), nodes: [], total: 0, open: 0, hours: 0 }));
  const loose: ModuleGroup = { id: '', name: '还没分块', due: '', nodes: [], total: 0, open: 0, hours: 0 };
  for (const n of roots) (groups.find(g => g.id === n.item.module) || loose).nodes.push(n);
  for (const g of [...groups, loose]) { g.total = sum(g.nodes.map(n => n.total)); g.open = sum(g.nodes.map(n => n.open)); g.hours = sum(g.nodes.map(n => n.hours)); }
  return loose.nodes.length ? [...groups, loose] : groups;
}

/** Every task under `id`, at any depth. */
/**
 * New `order` values that put `moving` right before `before` (last when null) among `sibs`.
 * Usually only the moved one changes; when its two new neighbours share an order, the whole row is renumbered.
 */
export function orderPatch(sibs: Array<{ id: string; order: number; title: string }>, moving: string, before: string | null): Record<string, number> {
  const rest = sibs.filter(s => s.id !== moving).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const k = before ? rest.findIndex(s => s.id === before) : -1, at = k < 0 ? rest.length : k;
  if (!rest.length) return {};
  if (at === rest.length) return { [moving]: rest[at - 1].order + 1 };
  if (at === 0) return { [moving]: rest[0].order - 1 };
  const lo = rest[at - 1].order, hi = rest[at].order;
  if (hi - lo > 1e-6) return { [moving]: (lo + hi) / 2 };
  const out: Record<string, number> = {};
  [...rest.slice(0, at).map(s => s.id), moving, ...rest.slice(at).map(s => s.id)].forEach((id, i) => { out[id] = rest[0].order + i; });
  return out;
}

export function descendants(id: string, items: Array<{ id: string }>, parentOf: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  const walk = (p: string) => { for (const i of items) if (parentOf(i.id) === p && !out.includes(i.id) && i.id !== id) { out.push(i.id); walk(i.id); } };
  walk(id);
  return out;
}
