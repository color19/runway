// Runway lights: time invested, drawn as lamps. One lamp is 10 minutes of focus, lit in the project's colour.
// A session cut short leaves a partly lit lamp; nothing ever goes dark again.
import type { Session } from '../../engine/src';
import { fmtH } from '../../engine/src';

export const LAMP_MINS = 10;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Lamps for one session: whole lamps, then a part-lit one for the remainder. */
function lamps(s: Session, color: string, label: string, opts: { fresh?: boolean }) {
  const full = Math.floor(s.mins / LAMP_MINS), part = (s.mins % LAMP_MINS) / LAMP_MINS;
  const one = (k: number, fill: number) => `<i class="lamp${opts.fresh ? ' on' : ''}" style="--c:${esc(color)};--f:${Math.round(fill * 100)}%${opts.fresh ? `;--d:${k * 70}ms` : ''}"></i>`;
  let html = '';
  for (let k = 0; k < full; k++) html += one(k, 1);
  if (part > 0) html += one(full, part);
  return `<span class="sess" title="${esc(label)}" aria-label="${esc(label)}">${html}</span>`;
}

/** Whole lamps a number of minutes is worth; the remainder shows as a part-lit lamp. */
export const lampCount = (mins: number) => Math.floor(mins / LAMP_MINS + 1e-9);

/** Today's runway: every session in the order it happened, a small gap between sessions. */
export function todayRunway(sessions: Session[], colorOf: (pid: string) => string, labelOf: (s: Session) => string, fresh: string) {
  return `<div class="strip">${sessions.map(s => lamps(s, colorOf(s.project), labelOf(s), { fresh: s.id === fresh })).join('')}</div>`;
}

/** One day as a stack of lamps from the ground up, for the seven-day view. */
export function dayStack(sessions: Session[], colorOf: (pid: string) => string, labelOf: (s: Session) => string) {
  return `<div class="stack">${sessions.map(s => lamps(s, colorOf(s.project), labelOf(s), {})).join('')}</div>`;
}

/**
 * A project's own runway: how much of the way to its deadline you have already lit.
 * Lit share = hours invested / (hours invested + hours still to do).
 */
export function projectRunway(invested: number, remaining: number, color: string) {
  const total = invested + remaining;
  if (total < 0.01) return '';
  const pct = Math.min(100, invested / total * 100);
  return `<div class="prun" style="--c:${esc(color)};--p:${pct.toFixed(1)}%" role="img" aria-label="已投入 ${fmtH(invested)}，还剩约 ${fmtH(remaining)}"><i></i></div>`;
}

export const sessionLabel = (title: string, s: Session) => `${title || '专注'} · ${s.start ? s.start + ' 起 ' : ''}${fmtH(s.mins / 60)}`;
