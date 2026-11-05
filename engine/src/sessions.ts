// Focus sessions: every stretch of timed work, however short. They are what "time invested" counts.
import type { Day } from './dates';
import { add, range, sum } from './dates';
import type { Store } from './model';

export interface Session {
  id: string;
  /** Task the session was for; may be empty. */
  item: string;
  /** Project of that task; empty for tasks outside any project. */
  project: string;
  date: Day;
  /** 'HH:MM' when it started. */
  start: string;
  /** Minutes actually spent. Any length counts, there is no minimum. */
  mins: number;
  /** True when nobody timed it: a task ticked off without a timer, counted at its estimate. */
  estimated?: boolean;
}

export function sessionsOf(store: Store): Session[] {
  return Object.entries(store.sessions || {})
    .map(([id, s]) => ({ id, item: s.item || '', project: s.project || '', date: s.date, start: s.start || '', mins: Math.max(0, Number(s.mins) || 0) }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && s.mins > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** Sessions on one day, in the order they happened. */
export const sessionsOn = (all: Session[], d: Day) => all.filter(s => s.date === d);

/** Hours invested on one day. */
export const investedOn = (all: Session[], d: Day) => sum(sessionsOn(all, d).map(s => s.mins)) / 60;

/** Hours invested per project over all time; tasks outside any project are under ''. */
export function investedByProject(all: Session[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of all) out[s.project] = (out[s.project] || 0) + s.mins / 60;
  return out;
}

/** The `n` days ending on `to`, each with its sessions and total hours. */
export function investedDays(all: Session[], to: Day, n = 7) {
  return range(add(to, -(n - 1)), to).map(d => ({ date: d, sessions: sessionsOn(all, d), hours: investedOn(all, d) }));
}

/**
 * Sessions plus time logged the old way, plus finished tasks nobody timed (an item's `log`: hours per day, written by the legacy timer and
 * by this app for compatibility). Logged time not already covered by a session on the same item and day
 * becomes one extra session, so every logged hour shows up once and only once.
 */
export function sessionsWithLogs(store: Store): Session[] {
  const real = sessionsOf(store);
  const covered = new Map<string, number>();
  for (const s of real) covered.set(s.item + '|' + s.date, (covered.get(s.item + '|' + s.date) || 0) + s.mins);
  const extra: Session[] = [];
  for (const [id, it] of Object.entries(store.items)) {
    if (!it || it.old) continue;
    for (const [d, h] of Object.entries(it.log || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const mins = Math.round((Number(h) || 0) * 60) - (covered.get(id + '|' + d) || 0);
      if (mins > 0) extra.push({ id: `log:${id}:${d}`, item: id, project: it.project || '', date: d, start: '', mins });
    }
  }
  // done tasks with no timing at all still show up: at their recorded actual time, or else at their estimate
  for (const [id, it] of Object.entries(store.items)) {
    if (!it || it.old || !it.done || (it.kind || 'task') !== 'task') continue;
    const day = it.doneOn || it.date;
    if (!day || Object.keys(it.log || {}).length || real.some(s => s.item === id)) continue;
    const actual = it.actual != null ? Number(it.actual) : null;
    const hours = actual != null && actual > 0 ? actual : Number(it.est ?? it.hours) || 0;
    if (hours > 0) extra.push({ id: `done:${id}`, item: id, project: it.project || '', date: day, start: it.time || '', mins: Math.round(hours * 60), estimated: !(actual != null && actual > 0) });
  }
  return [...real, ...extra].sort((a, b) => a.date.localeCompare(b.date) || (a.start || '99').localeCompare(b.start || '99'));
}
