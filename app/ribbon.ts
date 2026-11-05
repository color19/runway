// "Today's runway": one day laid out on a clock axis. Done time is solid in the project's colour,
// ticked-off-but-untimed work is hatched, what is still planned is a dashed outline, now is a blue line.
// Time with no known clock time sits in its own small block, never forced onto the axis.
import type { Item, Session } from '../engine/src';
import { fmtH, hm, sum } from '../engine/src';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hhmm = (m: number) => `${Math.floor(m / 60) % 24}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export interface Axis { from: number; to: number }

/** 8:00–24:00, widened to the hour around anything earlier or later. */
export function axisFor(sessions: Session[], planned: Item[] = [], extraMins: number[] = []): Axis {
  let from = 8 * 60, to = 24 * 60;
  const marks: number[] = [...extraMins];
  for (const s of sessions) { const a = hm(s.start); if (a != null) marks.push(a, a + s.mins); }
  for (const p of planned) { const a = hm(p.time); if (a != null) marks.push(a, hm(p.end) ?? a + (p.hours || 1) * 60); }
  for (const m of marks) { if (m < from) from = Math.floor(m / 60) * 60; if (m > to) to = Math.ceil(m / 60) * 60; }
  return { from: Math.max(0, from), to: Math.min(30 * 60, to) };
}
const pct = (ax: Axis, m: number) => Math.max(0, Math.min(100, (m - ax.from) / (ax.to - ax.from) * 100));

export interface RibbonOpts {
  sessions: Session[];
  planned?: Item[];
  axis: Axis;
  colorOf: (pid: string) => string;
  titleOf: (s: Session) => string;
  nowMin?: number;
  live?: { startMin: number; nowMin: number; color: string; title: string } | null;
  fresh?: string;
  big?: boolean;
}

/**
 * Where each session with a clock time goes, in minutes after midnight.
 * Untimed (estimated) work is only placed roughly, so it never overlaps: each such block starts where the
 * previous one ends; and finished work can't sit in the future, so they are walked back to end by now.
 */
export function place(sessions: Session[], nowMin?: number) {
  const timed = sessions.filter(s => hm(s.start) != null).sort((x, y) => hm(x.start)! - hm(y.start)!);
  let lastEnd = -1;
  const placed = timed.map(s => { let a = hm(s.start)!; if (s.estimated && a < lastEnd) a = lastEnd; lastEnd = Math.max(lastEnd, a + s.mins); return { s, a }; });
  if (nowMin != null) {
    let limit = nowMin;
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i];
      if (p.a + p.s.mins > limit) { if (!p.s.estimated) break; p.a = limit - p.s.mins; }
      limit = Math.min(limit, p.a);
    }
  }
  return placed;
}

export function ribbon(o: RibbonOpts) {
  const ax = o.axis;
  const placed = place(o.sessions, o.nowMin);
  const blocks = placed.map(({ s, a }) => {
    const l = pct(ax, a), w = Math.max(0.5, pct(ax, a + s.mins) - l);
    const t = o.titleOf(s), label = `${t} · ${hhmm(a)} 起 ${fmtH(s.mins / 60)}${s.estimated ? '（没计时，按预计算）' : ''}`;
    return `<div class="rb-seg${s.estimated ? ' est' : ''}${s.id === o.fresh ? ' fresh' : ''}" style="left:${l}%;width:${w}%;--c:${esc(o.colorOf(s.project))}" title="${esc(label)}">${o.big && w > 9 ? `<span>${esc(t)}</span>` : ''}</div>`;
  }).join('');
  const plans = (o.planned || []).filter(p => hm(p.time) != null).map(p => {
    const a = hm(p.time)!, e = hm(p.end) ?? a + Math.max(0.25, p.hours || p.est || 1) * 60;
    const l = pct(ax, a), w = Math.max(0.5, pct(ax, e) - l);
    return `<div class="rb-plan" style="left:${l}%;width:${w}%" title="${esc(`计划：${p.title} · ${p.time}${p.end ? '–' + p.end : ''}`)}">${o.big && w > 9 ? `<span>${esc(p.title)}</span>` : ''}</div>`;
  }).join('');
  const live = o.live ? (() => { const l = pct(ax, o.live.startMin), w = Math.max(0.4, pct(ax, o.live.nowMin) - l); return `<div class="rb-seg live" style="left:${l}%;width:${w}%;--c:${esc(o.live.color)}" title="${esc(o.live.title)} · 正在计时">${o.big && w > 9 ? `<span>${esc(o.live.title)}</span>` : ''}</div>`; })() : '';
  const now = o.nowMin != null && o.nowMin >= ax.from && o.nowMin <= ax.to
    ? `<div class="rb-now" style="left:${pct(ax, o.nowMin)}%">${o.big ? `<b class="mono">${hhmm(o.nowMin)}</b>` : ''}</div>` : '';
  return `<div class="rb${o.big ? ' big' : ''}" style="--hours:${(ax.to - ax.from) / 60}">${plans}${blocks}${live}${now}</div>`;
}

/** Hour labels under a big ribbon. */
export function ruler(ax: Axis) {
  const span = (ax.to - ax.from) / 60, step = span > 12 ? 2 : 1, out: string[] = [];
  for (let h = Math.ceil(ax.from / 60); h * 60 <= ax.to; h += step) out.push(`<span style="left:${pct(ax, h * 60)}%">${h === 24 ? 24 : h % 24}</span>`);
  return `<div class="rb-ruler mono" aria-hidden="true">${out.join('')}</div>`;
}

/** Minutes with no clock time, grouped by project, as small chips. */
export function untimed(sessions: Session[], colorOf: (pid: string) => string, nameOf: (pid: string) => string) {
  const by = new Map<string, number>();
  for (const s of sessions) if (hm(s.start) == null) by.set(s.project, (by.get(s.project) || 0) + s.mins);
  if (!by.size) return '';
  return `<div class="rb-untimed"><span>没记时刻</span>${[...by.entries()].map(([p, m]) => `<i style="--c:${esc(colorOf(p))}" title="${esc(nameOf(p))}"></i><b class="mono">${fmtH(m / 60)}</b>`).join('')}</div>`;
}

export const untimedMins = (sessions: Session[]) => sum(sessions.filter(s => hm(s.start) == null).map(s => s.mins));

/** A project's own runway: how much of the way to its deadline you have already covered. */
export function projectRunway(invested: number, remaining: number, color: string) {
  const total = invested + remaining;
  if (total < 0.01) return '';
  const p = Math.min(100, invested / total * 100);
  return `<div class="prun" style="--c:${esc(color)};--p:${p.toFixed(1)}%" role="img" aria-label="已投入 ${fmtH(invested)}，还剩约 ${fmtH(remaining)}"><i></i></div>`;
}

export interface TableOpts {
  sessions: Session[];
  planned?: Item[];
  axis: Axis;
  colorOf: (pid: string) => string;
  titleOf: (s: Session) => string;
  nowMin?: number;
  live?: { startMin: number; nowMin: number; color: string; title: string } | null;
  fresh?: string;
}

/**
 * The Korean study-planner timetable: one row per hour, six 10-minute cells, time highlighted along the rows
 * like a marker in the project's colour. Same placement rules as the ribbon.
 */
export function timetable(o: TableOpts) {
  const from = Math.floor(Math.min(o.axis.from, 6 * 60) / 60), to = Math.ceil(o.axis.to / 60);
  type Span = { a: number; b: number; cls: string; c: string; label: string };
  const spans: Span[] = place(o.sessions, o.nowMin).map(({ s, a }) => ({
    a, b: a + s.mins, cls: (s.estimated ? 'est' : '') + (s.id === o.fresh ? ' fresh' : ''), c: o.colorOf(s.project),
    label: `${o.titleOf(s)} · ${hhmm(a)} 起 ${fmtH(s.mins / 60)}${s.estimated ? '（没计时，按预计算）' : ''}`,
  }));
  if (o.live) spans.push({ a: o.live.startMin, b: Math.max(o.live.startMin + 1, o.live.nowMin), cls: 'live', c: o.live.color, label: `${o.live.title} · 正在计时` });
  const plans = (o.planned || []).filter(p => hm(p.time) != null).map(p => {
    const a = hm(p.time)!; return { a, b: hm(p.end) ?? a + Math.max(0.25, p.hours || p.est || 1) * 60, label: `计划：${p.title} · ${p.time}${p.end ? '–' + p.end : ''}` };
  });
  const rows: string[] = [];
  for (let h = from; h < to; h++) {
    const rs = h * 60, re = rs + 60;
    const cut = (a: number, b: number) => { const x = Math.max(a, rs), y = Math.min(b, re); return y > x ? [(x - rs) / 60 * 100, (y - x) / 60 * 100] : null; };
    let cells = '';
    for (const p of plans) { const c = cut(p.a, p.b); if (c) cells += `<i class="tt-plan" style="left:${c[0]}%;width:${c[1]}%" title="${esc(p.label)}"></i>`; }
    for (const sp of spans) { const c = cut(sp.a, sp.b); if (c) cells += `<i class="tt-ink ${sp.cls}" style="left:${c[0]}%;width:${c[1]}%;--c:${esc(sp.c)}" title="${esc(sp.label)}"></i>`; }
    const nowHere = o.nowMin != null && o.nowMin >= rs && o.nowMin < re;
    if (nowHere) cells += `<i class="tt-now" style="left:${(o.nowMin! - rs) / 60 * 100}%" title="现在 ${hhmm(o.nowMin!)}"></i>`;
    rows.push(`<div class="tt-row${nowHere ? ' is-now' : ''}"><span class="tt-h mono">${h % 24 || (h === 24 ? 24 : 0)}</span><div class="tt-cells">${cells}</div></div>`);
  }
  return `<div class="tt" role="img" aria-label="今天的 10 分钟时间表"><div class="tt-row tt-head mono" aria-hidden="true"><span></span><div class="tt-ticks"><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span><span>60</span></div></div>${rows.join('')}</div>`;
}
