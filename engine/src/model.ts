import type { Day } from './dates';
import { add } from './dates';

export type Kind = 'task' | 'event' | 'deadline' | 'exam';
const KINDS: Kind[] = ['task', 'event', 'deadline', 'exam'];

/** Per-day hour map, e.g. { '2026-11-04': 1.5 } */
export type DayHours = Record<Day, number>;

export interface Tag { id: string; name: string; color?: string; due?: boolean }

export interface Settings {
  /** Hours available Monday … Sunday. */
  cap: number[];
  /** Per-day override of available hours. */
  over: Record<Day, number>;
  /** Days off: zero hours, the plan works around them. */
  off: Record<Day, unknown>;
  weekStart: number;
  /** Hours after midnight that still count as the previous day. */
  dayStart: number;
  /** Spread each project over the hours other projects leave free, not over raw capacity. */
  balance: boolean;
  askActual: boolean;
  tags: Tag[];
  [k: string]: unknown;
}

export interface Item {
  id: string;
  title: string;
  date: Day | null;
  time: string;
  end: string;
  /** Hours still remaining. */
  hours: number;
  /** Original estimate in hours. */
  est: number;
  log: DayHours;
  /** Remaining hours retired per day (partial progress). */
  burn: DayHours | null;
  actual: number | null;
  done: boolean;
  doneOn: Day | null;
  project: string;
  module: string;
  tags: string[];
  kind: Kind;
  note: string;
  rep: string;
  order: number;
  seg: Record<string, unknown>;
}

export interface CountGoal {
  unit: string;
  /** Minutes one unit is worth, so counts take up time too. */
  mins: number;
  /** Daily target that applies from each `from` date on. */
  plan: Array<{ from: Day; n: number }>;
  log: Record<Day, number>;
}

export interface Project {
  id: string;
  name: string;
  start: Day;
  deadline: Day;
  color: string;
  /** Days kept free before the deadline. */
  buffer: number;
  /** Lump workload in hours, for work not broken into tasks. */
  lump: number;
  /** Hours logged against the lump. */
  log: DayHours;
  modules: Array<{ id: string; name: string; [k: string]: unknown }>;
  note: string;
  askActual: boolean;
  count: CountGoal | null;
}

/** What the page stores: collections of raw documents keyed by id. */
export interface Store {
  items: Record<string, Record<string, any>>;
  projects: Record<string, Record<string, any>>;
  settings: { main?: Record<string, any> };
  /** Focus sessions, see sessions.ts. Absent in old backups. */
  sessions?: Record<string, Record<string, any>>;
}

export const DEF_SETTINGS = { cap: [4, 5, 5, 5, 5, 3, 4], over: {}, weekStart: 1, dayStart: 0, balance: true, askActual: true, accent: 'burgundy', palette: 'classic', nick: '', tags: [], gcal: false, home: 'today', pinned: false, theme: 'dark', look: 'art' };
const DEFAULT_COLOR = '#6B8FB8';

export function normSettings(raw: Record<string, any> = {}): Settings {
  return { ...DEF_SETTINGS, ...raw, cap: (raw.cap && raw.cap.length === 7) ? raw.cap : DEF_SETTINGS.cap, over: raw.over || {}, off: raw.off || {}, tags: raw.tags || [] } as Settings;
}

export function normItem(id: string, it: Record<string, any>): Item {
  const hours = it.hours != null ? Number(it.hours) || 0 : (it.minutes ? Number(it.minutes) / 60 : 0);
  return {
    id, title: it.title || '未命名', date: it.date || null, time: it.time || '', end: it.end || '', hours,
    est: it.est != null ? Number(it.est) || hours : hours, log: it.log || {}, burn: it.burn || null,
    actual: it.actual != null ? Number(it.actual) : null, done: !!it.done, doneOn: it.doneOn || (it.done ? (it.date || null) : null),
    project: it.project || '', module: it.module || '', tags: Array.isArray(it.tags) ? it.tags : [], kind: KINDS.includes(it.kind) ? it.kind : 'task',
    note: it.note || '', rep: it.rep || '', order: it.order || 0, seg: it.seg || {},
  };
}

export function normProj(id: string, p: Record<string, any>, today: Day): Project {
  return {
    id, name: p.name || '未命名项目', start: p.start || today, deadline: p.deadline || add(today, 30), color: p.color || DEFAULT_COLOR,
    buffer: Number(p.buffer) || 0, lump: p.lump != null ? Number(p.lump) || 0 : (Number(p.totalHours) || 0), log: p.log || {},
    modules: Array.isArray(p.modules) ? p.modules : [], note: p.note || '', askActual: p.askActual !== false,
    count: p.count && typeof p.count === 'object' ? {
      unit: p.count.unit != null ? String(p.count.unit) : '份', mins: Number(p.count.mins) || 10,
      plan: (Array.isArray(p.count.plan) ? p.count.plan : [])
        .filter((x: any) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.from || ''))
        .map((x: any) => ({ from: x.from, n: Math.max(0, Math.round(Number(x.n) || 0)) }))
        .sort((a: any, b: any) => a.from.localeCompare(b.from)),
      log: p.count.log && typeof p.count.log === 'object' ? p.count.log : {},
    } : null,
  };
}

/** A task that is still open but whose remaining time was recorded as zero. */
export const needsReest = (i: Item) => i.kind === 'task' && !i.done && i.hours <= 1e-6 && (i.est > 0 || Object.keys(i.log || {}).length > 0);
