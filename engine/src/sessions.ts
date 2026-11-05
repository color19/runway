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
