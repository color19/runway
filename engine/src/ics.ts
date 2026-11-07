// The plan as calendar events, so it shows up in the phone's own calendar and on the lock screen:
// as an .ics file to download, and as the list the Mac float writes into Apple Calendar.
import type { Engine } from './engine';
import type { Day } from './dates';
import { add, fmtH, range } from './dates';
import { hm } from './today';

export interface CalEvent {
  /** Stable across runs, so a calendar updates the event instead of adding a copy. */
  uid: string;
  date: Day;
  /** Minutes after midnight; both null for an all-day event. */
  start: number | null;
  end: number | null;
  title: string;
  notes: string;
}

/** The next `days` days: timed things at their time, exams and deadlines all day, untimed tasks folded into one all-day line per day. */
export function calEvents(eng: Engine, days = 14): CalEvent[] {
  const t = eng.today, dv = eng.derive(), out: CalEvent[] = [];
  for (const d of range(t, add(t, days - 1))) {
    const loose: string[] = [];
    for (const i of eng.itemsOn(d).filter(x => !x.done)) {
      if (i.kind === 'exam' || i.kind === 'deadline') { out.push({ uid: i.id, date: d, start: null, end: null, title: (i.kind === 'exam' ? '考试：' : '截止：') + i.title, notes: '' }); continue; }
      const st = hm(i.time), en = hm(i.end);
      if (st != null) {
        const stop = en != null && en > st ? en : st + Math.max(15, Math.round((i.hours || 0.5) * 60));
        out.push({ uid: `${i.id}-${d.replace(/-/g, '')}`, date: d, start: st, end: Math.min(stop, 1439), title: i.title, notes: dv.projMap.get(i.project)?.name || '' });
      } else if (i.kind === 'task') loose.push(`${i.title}${i.hours ? ' ' + fmtH(i.hours) : ''}`);
    }
    if (loose.length) out.push({ uid: `day-${d.replace(/-/g, '')}`, date: d, start: null, end: null, title: `Runway：${loose.length} 件 · ${loose[0]}${loose.length > 1 ? ' 等' : ''}`, notes: loose.join('\n') });
  }
  return out;
}

/** The same events as an .ics file. */
export function icsOf(eng: Engine, nowMs: number, days = 14) {
  const tx = (x: string) => x.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const ymd = (d: string) => d.replace(/-/g, '');
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ev = calEvents(eng, days).map(e => ['BEGIN:VEVENT', `UID:${e.uid}@runway`, `DTSTAMP:${stamp}`,
    ...(e.start == null ? [`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(add(e.date, 1))}`] : [`DTSTART:${ymd(e.date)}T${hh(e.start)}`, `DTEND:${ymd(e.date)}T${hh(e.end!)}`]),
    `SUMMARY:${tx(e.title)}`, ...(e.notes ? [`DESCRIPTION:${tx(e.notes)}`] : []), 'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Runway//CN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Runway', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

export interface CalTask {
  /** The item id, so a task that moves to another day stays the same reminder. */
  uid: string;
  date: Day;
  /** Minutes after midnight, or null when the task has no time. */
  start: number | null;
  title: string;
  notes: string;
  done: boolean;
}

/**
 * What the Mac float keeps in Apple Calendar and Reminders for the next `days` days:
 * exams, deadlines and fixed events as calendar events; every task as a reminder that can be ticked off on the phone.
 */
export function calSync(eng: Engine, days = 14): { events: CalEvent[]; tasks: CalTask[] } {
  const t = eng.today, dv = eng.derive(), events: CalEvent[] = [], tasks: CalTask[] = [];
  for (const d of range(t, add(t, days - 1))) {
    for (const i of eng.itemsOn(d)) {
      const st = hm(i.time), en = hm(i.end), pn = dv.projMap.get(i.project)?.name || '';
      if (i.kind === 'task') { tasks.push({ uid: i.id, date: d, start: st, title: i.title, notes: pn, done: i.done }); continue; }
      if (i.done) continue;
      if (i.kind === 'exam' || i.kind === 'deadline') events.push({ uid: i.id, date: d, start: null, end: null, title: (i.kind === 'exam' ? '考试：' : '截止：') + i.title, notes: '' });
      else events.push({ uid: `${i.id}-${d.replace(/-/g, '')}`, date: d, start: st, end: st == null ? null : Math.min(en != null && en > st ? en : st + Math.max(15, Math.round((i.hours || 0.5) * 60)), 1439), title: i.title, notes: pn });
    }
  }
  return { events, tasks };
}
