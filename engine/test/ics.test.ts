import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, icsOf } from '../src';

const base = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/synthetic.json', import.meta.url)), 'utf8'));
const D = '2026-11-04';
const ics = icsOf(createEngine(base, D), Date.UTC(2026, 10, 4, 8));
const events = ics.split('BEGIN:VEVENT').slice(1);

test('是一份合法的日历文件', () => {
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) { expect(e).toMatch(/UID:.+@runway/); expect(e).toMatch(/DTSTART/); expect(e).toMatch(/SUMMARY:/); }
});
test('只放接下来两周，不放做完的', () => {
  const starts = [...ics.matchAll(/DTSTART(?:;VALUE=DATE)?:(\d{8})/g)].map(m => m[1]);
  expect(Math.min(...starts.map(Number))).toBeGreaterThanOrEqual(20261104);
  expect(Math.max(...starts.map(Number))).toBeLessThanOrEqual(20261117);
  expect(ics).not.toContain('FSA 复习');
});
test('考试是全天事件', () => expect(ics).toMatch(/DTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261118\r\nSUMMARY:考试：/));
test('逗号和分号要转义', () => {
  const s = structuredClone(base); s.items.tx = { kind: 'task', title: 'a, b; c', date: D, time: '09:00', end: '10:00', hours: 1 };
  expect(icsOf(createEngine(s, D), 0)).toContain('SUMMARY:a\\, b\\; c');
});
