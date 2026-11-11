// What the "today" page and the project drawer need, built on top of the planning engine.
import type { Day } from './dates';
import { add, diff, range, sum } from './dates';
import type { Engine, ProjectStatus } from './engine';
import { createEngine, sortItems } from './engine';
import type { Item, Project, Store } from './model';

/** 'HH:MM' → minutes after midnight, or null when empty. */
export const hm = (s: string): number | null => /^\d{1,2}:\d{2}$/.test(s) ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]) : null;

export interface DrawerGroup {
  /** null for tasks that belong to no project. */
  project: Project | null;
  status: ProjectStatus | null;
  /** Hours the plan gives this project today, never more than today has. */
  quotaToday: number;
  /** The plan wanted more for it today than today holds. */
  fullToday: boolean;
  items: Item[];
}

/**
 * The project drawer: every open task that is not on today or a later day, grouped by project.
 * Tasks left on an earlier day come back here quietly instead of piling up as overdue.
 */
export function drawer(eng: Engine): DrawerGroup[] {
  const t = eng.today, dv = eng.derive();
  const waiting = (i: Item) => i.kind === 'task' && !i.done && (!i.date || i.date < t);
  const byOrder = (a: Item, b: Item) => (a.order - b.order) || a.title.localeCompare(b.title);
  const groups: DrawerGroup[] = [];
  const fit = new Map(dayShares(eng, t).list);
  for (const p of dv.projects) {
    const items = dv.items.filter(i => i.project === p.id && waiting(i)).sort(byOrder);
    const live = p.deadline >= t && eng.remNow(p) > 1e-3;
    if (!items.length && !live) continue;
    const got = fit.get(p.id) || 0;
    groups.push({ project: p, status: eng.projStatus(p), quotaToday: got, fullToday: eng.quota(p.id) > got + 0.01, items });
  }
  const loose = dv.items.filter(i => !dv.projMap.has(i.project) && waiting(i)).sort(byOrder);
  if (loose.length) groups.push({ project: null, status: null, quotaToday: 0, fullToday: false, items: loose });
  return groups;
}

/** Everything on a day, in the page's usual order. */
export const dayItems = (eng: Engine, d: Day = eng.today) => eng.itemsOn(d);

/** A timed task this close to its start goes ahead of the ones that can be done at any time. */
export const SOON_MIN = 30;

/**
 * Today's open tasks in the order they should be done right now:
 * one whose time slot is running, then one starting within SOON_MIN, then untimed ones,
 * then timed ones whose start has passed, then timed ones that start later today.
 * Clock times before the day's start hour belong to the night of the same planning day.
 */
export function pickOrder(eng: Engine, nowMin: number): Item[] {
  const open = eng.itemsOn(eng.today).filter(i => i.kind === 'task' && !i.done);
  const from = (Number(eng.settings.dayStart) || 0) * 60;
  const at = (m: number | null) => m != null && m < from ? m + 1440 : m;
  const now = at(nowMin)!;
  const rank = (i: Item) => {
    const s = at(hm(i.time)), e = at(hm(i.end));
    if (s != null && e != null && s <= now && now < e) return 0;
    if (s == null) return 2;
    if (s < now) return 3;
    return s - now <= SOON_MIN ? 1 : 4;
  };
  return open.slice().sort((a, b) => (rank(a) - rank(b)) || (at(hm(a.time)) ?? 0) - (at(hm(b.time)) ?? 0) || sortItems(a, b));
}

export interface DayShares {
  /** Hours each project gets that day, largest first; projects with nothing are left out. */
  list: Array<[string, number]>;
  /** The plan wanted more than the day holds, and was cut to fit. */
  full: boolean;
}

/**
 * The plan's hours for one day, cut to the hours that day has: count goals keep their fixed number,
 * then the earliest deadline is served first. What does not fit is not shown as a number anywhere.
 */
export function dayShares(eng: Engine, d: Day = eng.today): DayShares {
  const want = eng.allocate(eng.today).byDay[d] || {};
  const ps = eng.derive().projects.filter(p => want[p.id] > 1e-6);
  let room = Math.max(0, eng.capOf(d)), full = false;
  const list: Array<[string, number]> = [];
  for (const p of [...ps.filter(p => eng.cntOf(p)), ...ps.filter(p => !eng.cntOf(p))]) {
    const h = Math.min(want[p.id], room);
    if (h < want[p.id] - 0.01) full = true;
    room -= h;
    if (h > 0.01) list.push([p.id, h]);
  }
  return { list: list.sort((a, b) => b[1] - a[1]), full };
}

export interface DayLoad {
  date: Day;
  /** Hours available that day. */
  cap: number;
  /** Hours of open tasks already placed on that day. */
  placed: number;
  /** Hours the plan spreads onto that day across all projects. */
  need: number;
  /** cap − placed; negative means the day is already over full. */
  room: number;
}

/** Load for the next `n` days starting at `from`, for the "which day?" picker. */
export function dayLoads(eng: Engine, from: Day = eng.today, n = 14): DayLoad[] {
  return range(from, add(from, n - 1)).map(d => {
    const cap = eng.capOf(d);
    const placed = sum(eng.itemsOn(d).filter(i => i.kind === 'task' && !i.done).map(i => i.hours));
    return { date: d, cap, placed, need: eng.dayNeed(d), room: cap - placed };
  });
}

/** One quiet line saying where a task comes from, e.g. "CFA Level 1 › 组合管理 · 离考试 13 天". */
export function lineage(eng: Engine, it: Item): string {
  const dv = eng.derive(), p = dv.projMap.get(it.project);
  if (!p) return '';
  const mod = p.modules.find(m => m.id === it.module);
  const isExam = dv.items.some(x => x.kind === 'exam' && x.date === p.deadline);
  const left = diff(eng.today, p.deadline);
  const when = left > 0 ? ` · 离${isExam ? '考试' : '截止'} ${left} 天` : left === 0 ? ` · ${isExam ? '今天考试' : '今天截止'}` : '';
  return `${p.name}${mod ? ' › ' + mod.name : ''}${when}`;
}

export interface IfToday { project: Project; before: ProjectStatus; after: ProjectStatus }

/**
 * How each running project would stand if today got only `hours` in all (time already spent today included).
 * Only asks the question; the plan changes when the user says so.
 */
export function ifToday(store: Store, today: Day, hours: number): IfToday[] {
  const a = createEngine(store, today);
  const main = (store.settings.main || {}) as Record<string, any>;
  const b = createEngine({ ...store, settings: { ...store.settings, main: { ...main, over: { ...(main.over || {}), [today]: Math.max(0, hours) } } } }, today);
  const out: IfToday[] = [];
  for (const p of a.derive().projects) {
    const before = a.projStatus(p);
    if (before.k === 'flat' || before.label === '全部完成' || before.label === '已过 Deadline') continue;
    out.push({ project: p, before, after: b.projStatus(b.derive().projMap.get(p.id)!) });
  }
  return out;
}
