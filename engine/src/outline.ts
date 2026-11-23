import { MAX_DEPTH, type ModuleGroup, type TreeNode } from './tree';
import { r2 } from './dates';

/**
 * A project written out as an outline: depth 0 is a block, 1 a task, 2 a step, 3 a smaller step.
 * `id` is the block's or task's id, '' for a line not saved yet.
 */
export interface OutlineRow { id: string; depth: number; title: string; hours: number; done: boolean; /** A topic's own deadline; '' clears it, absent leaves it. */ due?: string }

/** The project as it stands: tasks outside any block first, then each block with its tasks. */
export function toOutline(groups: ModuleGroup[], modules: Array<{ id: string; name: string; due?: unknown }>): OutlineRow[] {
  const out: OutlineRow[] = [];
  const walk = (n: TreeNode) => {
    out.push({ id: n.item.id, depth: Math.min(n.depth, MAX_DEPTH), title: n.item.title, hours: n.children.length ? 0 : n.item.hours, done: n.item.done });
    n.children.forEach(walk);
  };
  groups.find(g => g.id === '')?.nodes.forEach(walk);
  for (const m of modules) {
    out.push({ id: m.id, depth: 0, title: m.name, hours: 0, done: false, due: String(m.due || '') });
    groups.find(g => g.id === m.id)?.nodes.forEach(walk);
  }
  return out;
}

/** "1h30m", "1.5h", "90m", "1:30", "45" (minutes), "2" (hours) → hours; nonsense → 0. */
export function parseHours(s: string): number {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '').replace('小时', 'h').replace(/分钟?|min/, 'm');
  if (!t) return 0;
  let m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return r2(Number(m[1]) + Number(m[2]) / 60);
  m = t.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/);
  if (m && (m[1] || m[2])) return r2((Number(m[1]) || 0) + (Number(m[2]) || 0) / 60);
  m = t.match(/^\d+(?:\.\d+)?$/);
  if (m) { const n = Number(t); return r2(n > 10 ? n / 60 : n); }
  return 0;
}

/** Each row's depth made legal: a task sits at most one level below the line above it, never deeper than MAX_DEPTH. */
export function settleDepths(rows: OutlineRow[]): OutlineRow[] {
  let prev = 0;
  return rows.map(r => {
    const d = r.depth === 0 ? 0 : Math.max(1, Math.min(r.depth, prev + 1, MAX_DEPTH));
    prev = d;
    return d === r.depth ? r : { ...r, depth: d };
  });
}

/** The lines under row i (deeper, until the next line at its depth or shallower). */
export function subtreeEnd(rows: OutlineRow[], i: number): number {
  let j = i + 1;
  while (j < rows.length && rows[j].depth > rows[i].depth) j++;
  return j;
}

type Raw = Record<string, any>;
export interface OutlinePlan {
  modules: Array<Record<string, any>>;
  /** Full new documents for tasks that change or are new. */
  puts: Array<[string, Raw]>;
  /** Tasks taken out of the outline: they become "not doing it" (old), never erased. */
  drops: string[];
}

/**
 * What saving the outline does to the project's blocks and tasks.
 * Existing tasks keep everything the outline does not show (dates, logs, notes); a task that gets steps hands its hours to them.
 * `before` is the outline as it was opened, so a line removed from it is told apart from a task the outline never showed.
 */
export function applyOutline(opts: {
  rows: OutlineRow[]; before: OutlineRow[]; pid: string;
  items: Record<string, Raw>; modules: Array<Record<string, any>>;
  newId: (kind: 'm' | 'i') => string;
}): OutlinePlan {
  const { pid, items } = opts;
  const rows = settleDepths(opts.rows.map(r => ({ ...r, title: r.title.trim() })));
  const oldMods = new Map(opts.modules.map(m => [m.id, m]));
  const modules: Array<Record<string, any>> = [];
  const keep = new Set<string>();
  let next = Math.max(0, ...Object.values(items).map(x => Number(x.order) || 0)) + 1;
  const stack: string[] = [];      // stack[d] = task id at depth d (1-based) currently open
  let mod = '';
  const placed: Array<{ id: string; parent: string; module: string; order: number; row: OutlineRow }> = [];
  for (const r of rows) {
    if (r.depth === 0) {
      if (!r.title) continue;
      const same = modules.find(x => x.name === r.title);
      if (same) { mod = same.id; stack.length = 0; continue; }
      const m = r.id && oldMods.get(r.id);
      const id = m ? r.id : opts.newId('m');
      const mod1: Record<string, any> = m ? { ...m, name: r.title } : { id, name: r.title };
      if (r.due) mod1.due = r.due; else if (r.due === '') delete mod1.due;
      modules.push(mod1);
      mod = id; stack.length = 0;
      continue;
    }
    const known = !!(r.id && items[r.id] && !items[r.id].old);
    if (!r.title && !known) { continue; }
    let d = r.depth;
    while (d > 1 && !stack[d - 1]) d--;
    const id = known ? r.id : opts.newId('i');
    stack[d] = id; stack.length = d + 1;
    placed.push({ id, parent: d > 1 ? stack[d - 1] : '', module: mod, order: 0, row: r });
    keep.add(id);
  }
  // within each row of siblings, the orders they already had are handed back out in outline order: an untouched row keeps its numbers
  const sibs = new Map<string, typeof placed>();
  for (const p of placed) { const key = p.parent || 'm:' + p.module; if (!sibs.has(key)) sibs.set(key, []); sibs.get(key)!.push(p); }
  for (const row of sibs.values()) {
    const had = row.filter(p => items[p.id]).map(p => Number(items[p.id].order) || 0).sort((a, b) => a - b);
    if (had.length === row.length && new Set(had).size === had.length && row.some((p, i) => Number(items[p.id].order) !== had[i])) { row.forEach((p, i) => { p.order = had[i]; }); continue; }
    // new lines in the row: each task keeps its number while that still sorts after the one above it
    // (equal numbers are fine while the titles still sort the same way: the tree breaks ties by title)
    let last = -Infinity, lastTitle = '';
    for (const p of row) {
      const own = items[p.id] ? Number(items[p.id].order) || 0 : NaN, title = p.row.title || items[p.id]?.title || '';
      p.order = own > last || (own === last && title.localeCompare(lastTitle) >= 0) ? own : next++;
      last = p.order; lastTitle = title;
    }
  }
  const holders = new Set(placed.filter(p => p.parent).map(p => p.parent));
  const openKids = new Set(placed.filter(p => p.parent && !p.row.done).map(p => p.parent));
  const puts: Array<[string, Raw]> = [];
  for (const p of placed) {
    const was = items[p.id];
    const hours = holders.has(p.id) ? 0 : Math.max(0, r2(p.row.hours || 0));
    if (!was) {
      puts.push([p.id, { kind: 'task', title: p.row.title, date: null, time: '', end: '', hours, est: hours, done: false, doneOn: null, project: pid, module: p.module, parent: p.parent, tags: [], note: '', order: p.order, log: {}, actual: null }]);
      continue;
    }
    // a step keeps the block field it had while it stays under the same task: the tree reads its block from the top task
    const module = p.parent && (was.parent || '') === p.parent ? (was.module || '') : p.module;
    const now: Raw = { ...was, title: p.row.title || was.title, module, parent: p.parent || (was.parent ? '' : was.parent), order: p.order };
    if (holders.has(p.id)) { if (Number(was.hours) > 0 || Number(was.est) > 0) now.split = { hours: was.hours, est: was.est }; now.hours = 0; now.est = 0; }
    // its steps all gone and no time typed: it gets back the time it had before it was split
    else if (!hours && !(Number(was.hours) > 0) && was.split) { now.hours = Number(was.split.hours) || 0; now.est = Number(was.split.est) || 0; now.split = null; }
    else if (Math.abs((Number(was.hours) || 0) - hours) > 1e-9) { now.hours = hours; if (!(Number(was.est) > 0)) now.est = hours; }
    // a task with a step still to do is not done
    if (now.done && openKids.has(p.id)) { now.done = false; now.doneOn = null; }
    if (JSON.stringify(now) !== JSON.stringify(was)) puts.push([p.id, now]);
  }
  const drops = opts.before.filter(r => r.depth > 0 && r.id && items[r.id] && !items[r.id].old && !keep.has(r.id)).map(r => r.id);
  return { modules, puts, drops };
}
