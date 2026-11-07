// The plan as a calendar file, so it shows up in the phone's own calendar and on the lock screen.
import type { Engine } from './engine';
import { add, fmtH, range } from './dates';
import { hm } from './today';

/** The next two weeks as an .ics file, so the plan shows up in the phone's own calendar and lock screen. */
export function icsOf(eng: Engine, nowMs: number, days = 14) {
  const t = eng.today, dv = eng.derive();
  const tx = (x: string) => x.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const ymd = (d: string) => d.replace(/-/g, '');
  const hh = (m: number) => { const c = Math.max(0, Math.min(1439, m)); return `${String(Math.floor(c / 60)).padStart(2, '0')}${String(c % 60).padStart(2, '0')}00`; };
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ev: string[] = [];
  const push = (uid: string, f: string[]) => ev.push(['BEGIN:VEVENT', `UID:${uid}@runway`, `DTSTAMP:${stamp}`, ...f, 'END:VEVENT'].join('\r\n'));
  const allDay = (d: string) => [`DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(add(d, 1))}`];
  for (const d of range(t, add(t, days - 1))) {
    const loose: string[] = [];
    for (const i of eng.itemsOn(d).filter(x => !x.done)) {
      const pn = dv.projMap.get(i.project)?.name;
      if (i.kind === 'exam' || i.kind === 'deadline') { push(i.id, [...allDay(d), `SUMMARY:${tx((i.kind === 'exam' ? '考试：' : '截止：') + i.title)}`]); continue; }
      const st = hm(i.time), en = hm(i.end);
      if (st != null) push(`${i.id}-${ymd(d)}`, [`DTSTART:${ymd(d)}T${hh(st)}`, `DTEND:${ymd(d)}T${hh(en != null && en > st ? en : st + Math.max(15, Math.round((i.hours || 0.5) * 60)))}`, `SUMMARY:${tx(i.title)}`, ...(pn ? [`DESCRIPTION:${tx(pn)}`] : [])]);
      else if (i.kind === 'task') loose.push(`${i.title}${i.hours ? ' ' + fmtH(i.hours) : ''}`);
    }
    if (loose.length) push(`day-${ymd(d)}`, [...allDay(d), `SUMMARY:${tx(`Runway：${loose.length} 件 · ${loose[0]}${loose.length > 1 ? ' 等' : ''}`)}`, `DESCRIPTION:${tx(loose.join('\n'))}`]);
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Runway//CN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Runway', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
