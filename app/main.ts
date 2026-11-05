// Runway: the "today" page, the project drawer and the runway lights, on the real engine and real data.
import { cnd, createEngine, dayLoads, diff, drawer, fmtH, investedByProject, investedDays, lineage, monIdx, pickOrder, r2, sessionsOn, sessionsWithLogs, sum, todayOf } from '../engine/src';
import type { Engine, Item, Session, Store } from '../engine/src';
import { seed } from './seed';
import { dayStack, lampCount, projectRunway, sessionLabel, todayRunway } from './lights';
import { backupOf, createStore, parseBackup } from './store';
import { startBridge } from './bridge';

const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const dayL = (d: string) => `${cnd(d)} ${WD[monIdx(d)]}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const uid = (p: string) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const root = document.getElementById('app')!;

/** Lamp colours: far apart in hue so projects never blur together. Klein blue stays reserved for "now". */
export const PALETTE: Array<[string, string]> = [
  ['雾蓝', '#5B7FB8'], ['湖青', '#2A9DA8'], ['松绿', '#3E8A5E'], ['橄榄', '#8C9A2E'], ['琥珀', '#D08A1E'],
  ['珊瑚', '#E0725A'], ['莓粉', '#C9558F'], ['紫藤', '#8E6CC4'], ['可可', '#9A7458'],
];
const LOOSE_COLOR = '#8F9A93';

let raf = 0;
let toFloat: () => void = () => {};
const S = createStore(() => { toFloat(); if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); });

const ui = {
  skip: 0,
  showAll: false,
  drawerOpen: false,
  picker: null as string | null,
  colorFor: null as string | null,
  sheet: null as null | 'data' | 'import',
  pending: null as null | ReturnType<typeof parseBackup>,
  busy: '',
  started: false,
  timer: null as null | { id: string; kind: 'ten' | 'block'; startAt: number; endsAt: number; total: number; rang: boolean },
  justPlanted: '',
  quick: '',
  toast: null as null | { text: string; undo?: () => void; at: number },
};

/* ---------- reading the data ---------- */
const T = () => todayOf(Date.now(), Number(S.data.settings.main?.dayStart) || 0);
/** What the engine sees: everything except the old tasks hidden in October, which stay stored for the backup. */
function view(): Store {
  const items: Store['items'] = {};
  for (const [id, it] of Object.entries(S.data.items)) if (!it.old) items[id] = it;
  return { items, projects: S.data.projects, settings: S.data.settings, sessions: S.data.sessions };
}
const raw = (id: string) => S.data.items[id];
const colorOf = (eng: Engine, pid: string) => eng.derive().projMap.get(pid)?.color || LOOSE_COLOR;
const nameOf = (eng: Engine, pid: string) => eng.derive().projMap.get(pid)?.name || '其他';
const titleOf = (eng: Engine, s: Session) => (s.item && S.data.items[s.item]?.title) || nameOf(eng, s.project);
const isEmpty = () => !Object.keys(S.data.items).length && !Object.keys(S.data.projects).length;

/* ---------- changing the data ---------- */
function say(text: string, undo?: () => void) { ui.toast = { text, undo, at: Date.now() }; }
function patch(id: string, p: Record<string, any>) { S.put('items', id, { ...raw(id), ...p }); }

function moveTo(id: string, date: string | null, text: string) {
  const prev = { date: raw(id).date ?? null, time: raw(id).time || '', end: raw(id).end || '' };
  patch(id, { date, time: '', end: '' });
  say(text, () => patch(id, prev));
}
function toggleDone(id: string) {
  const now = !raw(id).done;
  if (now && ui.timer?.id === id) plant();
  patch(id, { done: now, doneOn: now ? T() : null });
  if (now) { chime(); ui.skip = 0; }
}

/** Ends the running timer and lights lamps for the time spent. Half a minute or more counts. */
function plant() {
  const t = ui.timer; if (!t) return;
  ui.timer = null;
  const secs = Math.min(t.total, Math.round((Date.now() - t.startAt) / 1000));
  if (secs < 30 || !raw(t.id)) return;
  const it = raw(t.id), start = new Date(t.startAt), d = T();
  const mins = Math.max(1, Math.round(secs / 60));
  const id = uid('s');
  S.addSession(id, { date: d, item: t.id, project: it.project || '', start: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`, mins });
  // also log it the old way, so a backup read by the old Runway keeps the time
  patch(t.id, { log: { ...(it.log || {}), [d]: r2((Number(it.log?.[d]) || 0) + mins / 60) } });
  ui.justPlanted = id;
  say(mins >= 10 ? `又亮了 ${lampCount(mins)} 盏灯 · ${fmtH(mins / 60)}` : `亮了一点 · ${mins} 分钟也算`);
}
const startTimer = (id: string, kind: 'ten' | 'block', secs: number) => { ui.timer = { id, kind, startAt: Date.now(), endsAt: Date.now() + secs * 1000, total: secs, rang: false }; };

function parseQuick(text: string, eng: Engine) {
  let title = text.trim(), hours = 0, project = '';
  const m = title.match(/\s+(\d+(?:\.\d+)?)\s*(h|小时|m|min|分钟)$/i);
  if (m) { hours = /^(m|min|分钟)$/i.test(m[2]) ? Number(m[1]) / 60 : Number(m[1]); title = title.slice(0, m.index).trim(); }
  const tag = title.match(/#(\S+)/);
  if (tag) {
    const q = tag[1].toLowerCase();
    const p = eng.derive().projects.find(x => x.name.toLowerCase().includes(q));
    if (p) { project = p.id; title = title.replace(tag[0], '').replace(/\s{2,}/g, ' ').trim(); }
  }
  return { title, hours: r2(hours), project };
}
function addQuick(eng: Engine, toToday: boolean) {
  const q = parseQuick(ui.quick, eng);
  if (!q.title) return;
  const order = Math.max(0, ...Object.values(S.data.items).map(x => Number(x.order) || 0)) + 1;
  const id = uid('i');
  S.put('items', id, { kind: 'task', title: q.title, date: toToday ? T() : null, time: '', end: '', hours: q.hours, est: q.hours, done: false, doneOn: null, project: q.project, module: '', tags: [], note: '', order, log: {}, actual: null });
  ui.quick = '';
  say(`记下了「${q.title}」${toToday ? '，放在今天' : '，在项目抽屉里'}`);
}

/* ---------- small pleasures ---------- */
let ac: AudioContext | null = null;
function chime() {
  try {
    ac = ac || new AudioContext();
    const t = ac.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ac!.createOscillator(), g = ac!.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.35);
      o.connect(g).connect(ac!.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.4);
    });
  } catch { /* sound is optional */ }
}

/* ---------- views ---------- */
function header(eng: Engine) {
  const t = T();
  const exam = eng.derive().items.filter(i => i.kind === 'exam' && i.date && i.date >= t && !i.done).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const saved = S.mode === 'live' ? '已保存' : S.mode === 'memory' ? '没有保存' : S.mode === 'loading' ? '读取中' : '保存出了问题';
  return `<header class="bar">
    <div class="brand">Runway</div>
    <nav class="layers" aria-label="视角">
      <button type="button" data-act="layer" data-layer="全局">全局</button>
      <button type="button" data-act="layer" data-layer="本周">本周</button>
      <button type="button" aria-current="page">今天</button>
    </nav>
    ${exam ? `<div class="exam"><span>${esc(exam.title.replace(/(考试|当天)$/, ''))}还有</span><b class="mono">${diff(t, exam.date!)}</b><span>天</span></div>` : '<div class="exam"></div>'}
    <button class="savestate ${S.mode}" type="button" data-act="data"><i></i>${saved}</button>
  </header>
  ${S.problem ? `<p class="problem" role="alert">${esc(S.problem)}<button type="button" data-act="dismiss">知道了</button></p>` : ''}
  ${S.mode === 'memory' ? `<p class="problem">这个页面现在拿不到数据库，看到的是示例，改动刷新就会丢。在 claude.ai 里打开这个页面才能保存。</p>` : ''}`;
}

function dayHead(eng: Engine) {
  const t = T();
  const tasks = eng.itemsOn(t).filter(i => i.kind === 'task');
  const placed = sum(tasks.map(i => i.done ? i.est : i.hours));
  const done = sum(tasks.filter(i => i.done).map(i => i.est));
  const cap = eng.capOf(t);
  const pct = placed > 0 ? Math.min(100, done / placed * 100) : 0;
  const over = placed - cap;
  return `<div class="dayhead">
    <h1>${dayL(t)}</h1>
    <p class="tally">今天排了 <b class="mono">${fmtH(placed)}</b><span class="sep"></span>做完了 <b class="mono">${fmtH(done)}</b><span class="sep"></span>还剩 <b class="mono">${fmtH(Math.max(0, placed - done))}</b></p>
    <div class="meter" role="img" aria-label="今天做完 ${Math.round(pct)}%"><i style="width:${pct}%"></i></div>
    ${over > 0.01 ? `<p class="soft">今天排的比可用的 ${fmtH(cap)} 多 ${fmtH(over)}。可以把一两件放回项目，明天再说。</p>` : ''}
    ${lightsToday(eng)}
  </div>`;
}

function legend(eng: Engine, list: Session[]) {
  const by = new Map<string, number>();
  for (const s of list) by.set(s.project, (by.get(s.project) || 0) + s.mins);
  if (!by.size) return '';
  return `<ul class="legend-chips">${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([pid, m]) =>
    `<li><i style="background:${esc(colorOf(eng, pid))}"></i>${esc(nameOf(eng, pid))}<span class="mono">${fmtH(m / 60)}</span></li>`).join('')}</ul>`;
}

function lightsToday(eng: Engine) {
  const t = T(), all = sessionsWithLogs(view()), today = sessionsOn(all, t);
  const mins = sum(today.map(x => x.mins)), estMins = sum(today.filter(x => x.estimated).map(x => x.mins));
  return `<section class="grove-today" aria-label="今天点亮的灯">
    <div class="grove-hd"><h3>今天点亮的灯</h3><span><b class="mono">${lampCount(mins)}</b> 盏<span class="sep"></span>投入 <b class="mono">${fmtH(mins / 60)}</b></span></div>
    ${today.length
      ? todayRunway(today, pid => colorOf(eng, pid), x => sessionLabel(titleOf(eng, x), x), ui.justPlanted) + legend(eng, today) + (estMins ? `<p class="soft legend">空心的 ${fmtH(estMins / 60)} 是做完了但没计时的事，按预计时长算。下次点"开始整块"，灯就是实心的。</p>` : '')
      : `<p class="soft grove-empty">开始第一段专注，跑道就会亮起第一盏灯。一盏灯是 10 分钟，只做三分钟也会亮一点。</p>`}
  </section>`;
}

function lightsWeek(eng: Engine) {
  const t = T(), days = investedDays(sessionsWithLogs(view()), t, 7);
  const total = sum(days.map(d => d.hours));
  // the tallest day fits in about 140px: lamps get thinner on heavy weeks instead of the column growing
  const most = Math.max(1, ...days.map(d => sum(d.sessions.map(x => Math.ceil(x.mins / 10)))));
  const per = 140 / most, lampPx = per >= 7 ? 5 : Math.max(1.2, per * 0.72), gapPx = per >= 7 ? 2 : Math.max(0.4, per * 0.28);
  const anyEst = days.some(d => d.sessions.some(x => x.estimated));
  return `<section class="block week" aria-label="最近七天">
    <div class="grove-hd"><h3>最近七天</h3><span>一共 <b class="mono">${lampCount(total * 60)}</b> 盏<span class="sep"></span><b class="mono">${fmtH(total)}</b></span></div>
    <div class="weekgrid">${days.map(d => `<div class="wday${d.date === t ? ' is-today' : ''}">
      ${dayStack(d.sessions, pid => colorOf(eng, pid), x => sessionLabel(titleOf(eng, x), x), lampPx, gapPx)}
      <span class="wd">${d.date === t ? '今天' : WD[monIdx(d.date)]}</span><span class="wh mono">${d.hours ? fmtH(d.hours) : '–'}</span>
    </div>`).join('')}</div>
    ${legend(eng, days.flatMap(d => d.sessions))}
    <p class="soft legend">一盏灯 10 分钟。${anyEst ? '空心的灯是做完了但没计时的事，按预计时长算。' : ''}点项目名前的色块可以换颜色。</p>
  </section>`;
}

function nowCard(eng: Engine, order: Item[]) {
  if (!order.length) return `<article class="now empty">
    <div class="now-label">现在做</div>
    <h2>今天排的都做完了</h2>
    <p class="lin">想多做一点，就从项目里放一件到今天。不想也完全可以。</p>
  </article>`;
  const it = ui.timer ? (order.find(i => i.id === ui.timer!.id) || order[0]) : order[ui.skip % order.length];
  const running = ui.timer && ui.timer.id === it.id;
  const time = it.time ? `${it.time}${it.end ? '–' + it.end : ''}` : '';
  return `<article class="now${running ? ' running' : ''}">
    <div class="now-label">${running ? (ui.timer!.kind === 'ten' ? '先做 10 分钟' : '整块进行中') : '现在做'}</div>
    <h2>${esc(it.title)}</h2>
    ${lineage(eng, it) ? `<p class="lin">${esc(lineage(eng, it))}</p>` : ''}
    ${it.note ? `<p class="lin note">${esc(it.note.split('\n')[0].slice(0, 120))}</p>` : ''}
    <p class="est mono">${time ? time + ' · ' : ''}预计 ${fmtH(it.hours || it.est)}</p>
    ${running ? `<div class="clock mono" id="clock">--:--</div><div class="track" aria-hidden="true"><i id="track"></i></div>` : ''}
    <div class="acts">
      ${running
        ? `<button class="btn primary" type="button" data-act="done" data-id="${it.id}">做完了</button>
           <button class="btn" type="button" data-act="ten" data-id="${it.id}">再来 10 分钟</button>
           <button class="btn quiet" type="button" data-act="stop">停下</button>`
        : `<button class="btn primary" type="button" data-act="ten" data-id="${it.id}">先做 10 分钟</button>
           <button class="btn" type="button" data-act="block" data-id="${it.id}">开始整块</button>
           ${order.length > 1 ? `<button class="btn quiet" type="button" data-act="swap">换一件</button>` : ''}`}
    </div>
  </article>`;
}

function row(eng: Engine, it: Item, opts: { check?: boolean; back?: boolean } = {}) {
  const lin = lineage(eng, it);
  const when = it.time ? `${it.time}${it.end ? '–' + it.end : ''}` : it.kind === 'task' ? fmtH(it.hours || it.est) : '';
  return `<li class="row${it.done ? ' done' : ''}${it.kind !== 'task' ? ' event' : ''}">
    ${opts.check && it.kind === 'task' ? `<input class="check" type="checkbox" id="c-${it.id}" data-act="done" data-id="${it.id}" ${it.done ? 'checked' : ''} aria-label="做完了：${esc(it.title)}">` : `<span class="dotslot"></span>`}
    <div class="row-t"><span>${esc(it.title)}</span>${lin ? `<small>${esc(lin)}</small>` : ''}</div>
    <span class="row-m mono">${when}</span>
    ${opts.back && it.kind === 'task' && !it.done ? `<button class="mini" type="button" data-act="back" data-id="${it.id}">放回项目</button>` : '<span></span>'}
  </li>`;
}

function today(eng: Engine) {
  const order = pickOrder(eng, nowMin());
  const cur = order.length ? (ui.timer ? order.find(i => i.id === ui.timer!.id) || order[0] : order[ui.skip % order.length]) : null;
  const next = order.filter(i => i !== cur).slice(0, 2);
  const all = eng.itemsOn(T());
  return `<main class="today">
    ${dayHead(eng)}
    ${nowCard(eng, order)}
    ${next.length ? `<section class="block"><h3>接下来</h3><ul class="rows">${next.map(i => row(eng, i, { back: true })).join('')}</ul></section>` : ''}
    <section class="block">
      <button class="fold" type="button" data-act="all" aria-expanded="${ui.showAll}"><h3>今天全部</h3><span class="mono">${all.length}</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6l4 4 4-4"/></svg></button>
      ${ui.showAll ? `<ul class="rows">${all.map(i => row(eng, i, { check: true, back: true })).join('')}</ul>` : ''}
    </section>
    ${lightsWeek(eng)}
  </main>`;
}

function quickView(eng: Engine) {
  const q = ui.quick.trim() ? parseQuick(ui.quick, eng) : null;
  const hint = q && q.title ? [q.project ? nameOf(eng, q.project) : '', q.hours ? fmtH(q.hours) : ''].filter(Boolean).join(' · ') : '';
  return `<form class="quick" data-form="quick">
    <input id="quick-input" type="text" autocomplete="off" placeholder="随手记一件事，比如：Ethics 错题 #CFA 45m" value="${esc(ui.quick)}" aria-label="随手记">
    <div class="quick-row"><span class="soft">${hint ? '会记成：' + esc(hint) : '可以加 #项目 和时长'}</span>
      <button class="mini" type="submit">记下</button><button class="mini signal" type="button" data-act="quick-today">记下并放到今天</button></div>
  </form>`;
}

const PILL: Record<string, string> = { good: 'good', mid: 'tight', bad: 'short', flat: 'flat' };
function drawerView(eng: Engine) {
  const groups = drawer(eng);
  const waiting = sum(groups.map(g => g.items.length));
  const dv = eng.derive(), t = T();
  const inv = investedByProject(sessionsWithLogs(view()));
  return `<aside class="drawer${ui.drawerOpen ? ' open' : ''}" aria-label="项目">
    <button class="drawer-handle" type="button" data-act="drawer" aria-expanded="${ui.drawerOpen}"><b>项目</b><span>${waiting} 件还没排进日子</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4-4 4 4"/></svg></button>
    <div class="drawer-hd"><h2>项目</h2><p>还没排进日子的事都在这里。放到今天，或者挑一天。</p></div>
    ${quickView(eng)}
    <div class="groups">
    ${groups.map(g => {
      const p = g.project, st = g.status;
      const isExam = p ? dv.items.some(x => x.kind === 'exam' && x.date === p.deadline) : false;
      const pill = !st ? '' : st.cnt
        ? `<span class="pill flat mono">今天 ${st.cnt.tD}/${st.cnt.tT} ${esc(p!.count!.unit)}</span><button class="mini" type="button" data-act="cnt" data-pid="${p!.id}" aria-label="${esc(p!.name)} 加一${esc(p!.count!.unit)}">+1</button>`
        : `<span class="pill ${PILL[st.k || 'flat']}">${esc(st.label)}</span>`;
      const spent = inv[p ? p.id : ''] || 0;
      const sub = [p && g.quotaToday > 0.01 ? `今天目标 ${fmtH(g.quotaToday)}` : '', spent > 0.01 ? `已投入 ${fmtH(spent)}` : '', p ? `${cnd(p.deadline)}${isExam ? '考试' : '截止'}${diff(t, p.deadline) >= 0 ? '' : '（已过）'}` : '没有截止日，什么时候做都行'].filter(Boolean).join(' · ');
      const color = p ? p.color : LOOSE_COLOR;
      return `<section class="grp">
        <header>${p ? `<button class="swatch" type="button" data-act="color" data-pid="${p.id}" style="background:${esc(color)}" aria-label="换 ${esc(p.name)} 的颜色" aria-expanded="${ui.colorFor === p.id}"></button>` : `<span class="swatch" style="background:${LOOSE_COLOR}"></span>`}<b>${p ? esc(p.name) : '生活和杂事'}</b>${pill}</header>
        ${p && ui.colorFor === p.id ? `<div class="palette" role="group" aria-label="选颜色">${PALETTE.map(([n, c]) => `<button type="button" data-act="setcolor" data-pid="${p.id}" data-color="${c}" style="background:${c}" aria-label="${n}" aria-pressed="${c.toLowerCase() === color.toLowerCase()}" title="${n}"></button>`).join('')}</div>` : ''}
        <p class="grp-sub">${sub}</p>
        ${p && st && !st.cnt ? projectRunway(spent, st.rem, color) : ''}
        ${g.items.length ? `<ul class="items">${g.items.map(i => {
          const mod = p?.modules.find(m => m.id === i.module)?.name;
          const was = i.date && i.date < t ? `原来排在 ${cnd(i.date)}` : '';
          return `<li class="it">
            <div class="it-t"><span>${esc(i.title)}</span><small>${[mod, (i.hours || i.est) ? fmtH(i.hours || i.est) : '', was].filter(Boolean).map(esc).join(' · ')}</small></div>
            <div class="it-a"><button class="mini signal" type="button" data-act="today" data-id="${i.id}">放到今天</button><button class="mini" type="button" data-act="pick" data-id="${i.id}">挑一天</button></div>
          </li>`; }).join('')}</ul>` : `<p class="grp-none">没有待排的事，引擎会按剩下的量往后摊。</p>`}
      </section>`; }).join('')}
    </div>
  </aside>`;
}

function pickerView(eng: Engine) {
  if (!ui.picker) return '';
  const it = eng.derive().items.find(i => i.id === ui.picker);
  if (!it) return '';
  const need = it.hours || it.est;
  const due = eng.derive().projMap.get(it.project)?.deadline;
  const t = T();
  return `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="排到哪天">
    <header><h2>「${esc(it.title)}」排到哪天？</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <p class="soft">${need ? `要 ${fmtH(need)}。` : ''}条子是每天已经排了多少，对比能用多少。</p>
    <ul class="days">${dayLoads(eng, t, 14).map(l => {
      const pct = l.cap > 0 ? Math.min(100, l.placed / l.cap * 100) : 100;
      const late = !!due && l.date >= due;
      const fits = !late && l.cap > 0 && l.room >= need - 1e-6;
      const txt = late ? (l.date === due ? '截止当天' : '过了截止') : l.cap <= 0 ? '休息日' : l.room <= 0.01 ? '已经排满' : fits ? `还能放 ${fmtH(l.room)}` : `只剩 ${fmtH(l.room)}`;
      return `<li><button type="button" class="day${fits ? ' fits' : ''}${late ? ' late' : ''}" data-act="assign" data-id="${it.id}" data-day="${l.date}">
        <span class="d">${l.date === t ? '今天' : dayL(l.date)}</span>
        <span class="load" aria-hidden="true"><i style="width:${pct}%"></i></span>
        <span class="r">${txt}</span>
      </button></li>`; }).join('')}</ul>
    ${it.date ? `<button class="btn quiet" type="button" data-act="back" data-id="${it.id}">放回项目，先不排</button>` : ''}
  </div>`;
}

function dataSheet() {
  if (!ui.sheet) return '';
  const n = Object.keys(S.data.items).length, np = Object.keys(S.data.projects).length, ns = Object.keys(S.data.sessions).length;
  const where = S.mode === 'live' ? '存在这个页面自己的数据库里。电脑和手机打开同一个链接，看到的是同一份。' : S.mode === 'memory' ? '现在拿不到数据库，只存在这一次打开的页面里，刷新就会丢。' : '数据库现在有问题，改动可能没存上。';
  if (ui.sheet === 'import' && ui.pending) {
    const b = ui.pending;
    return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="从备份恢复">
      <header><h2>从备份恢复</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
      <p>备份里有 ${Object.keys(b.items).length} 件事、${Object.keys(b.projects || {}).length} 个项目${b.sessions ? `、${Object.keys(b.sessions).length} 段专注` : ''}${b.exportedAt ? `，导出于 ${esc(b.exportedAt.slice(0, 10))}` : ''}。</p>
      <p class="soft">恢复会替换这里现在的全部数据（${n} 件事、${np} 个项目）。想留一份，先点"导出备份"。</p>
      <div class="acts">${ui.busy ? `<span class="soft">${esc(ui.busy)}</span>` : `<button class="btn primary" type="button" data-act="import-ok">替换并恢复</button><button class="btn" type="button" data-act="close">取消</button>`}</div>
    </div>`;
  }
  return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="数据">
    <header><h2>数据</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <p>${where}</p>
    <p class="soft">现在有 ${n} 件事、${np} 个项目、${ns} 段专注。</p>
    <div class="acts col">
      <label class="btn filebtn">从旧版备份导入…<input id="file-import" type="file" accept=".json,application/json" data-act="file"></label>
      <button class="btn" type="button" data-act="export">导出备份</button>
    </div>
    <p class="soft">导出的文件就是旧版 Runway 的备份格式，旧版"导出与备份"里可以直接恢复，随时能退回去。</p>
  </div>`;
}

function emptyView() {
  return `<main class="empty-app">
    <h1>Runway 还没有数据</h1>
    <p>把旧版 Runway 的数据搬过来：在旧版的"导出与备份"里导出 JSON，然后在这里导入。</p>
    <div class="acts"><label class="btn primary filebtn">导入旧版备份…<input id="file-import-empty" type="file" accept=".json,application/json" data-act="file"></label>
    <button class="btn" type="button" data-act="start">从零开始</button></div>
  </main>`;
}

function toastView() {
  const t = ui.toast;
  if (!t || Date.now() - t.at > 5000) return '';
  return `<div class="toast" role="status"><span>${esc(t.text)}</span>${t.undo ? `<button type="button" data-act="undo">撤销</button>` : ''}</div>`;
}

function render() {
  const active = document.activeElement as HTMLElement | null;
  const typing = active?.id === 'quick-input';
  const caret = typing ? (active as HTMLInputElement).selectionStart : null;
  const eng = createEngine(view(), T());
  const y = window.scrollY;
  const dScroll = (root.querySelector('.groups') as HTMLElement | null)?.scrollTop ?? 0;
  if (S.mode === 'loading') { root.innerHTML = `<p class="loading">正在读取你的数据…</p>`; return; }
  const body = isEmpty() && !ui.started && S.mode === 'live' ? emptyView() : `<div class="cols">${today(eng)}${drawerView(eng)}</div>`;
  root.innerHTML = `${header(eng)}${body}${pickerView(eng)}${dataSheet()}${toastView()}`;
  window.scrollTo(0, y);
  const g = root.querySelector('.groups') as HTMLElement | null; if (g) g.scrollTop = dScroll;
  if (typing) { const q = document.getElementById('quick-input') as HTMLInputElement | null; if (q) { q.focus(); if (caret != null) q.setSelectionRange(caret, caret); } }
  tick();
  ui.justPlanted = '';
}

/* ---------- timer ---------- */
function tick() {
  const t = ui.timer; if (!t) return;
  const left = Math.round((t.endsAt - Date.now()) / 1000);
  const clock = document.getElementById('clock'), track = document.getElementById('track');
  if (clock) clock.textContent = left > 0 ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : '到点了';
  if (track) track.style.width = `${Math.min(100, (1 - Math.max(0, left) / t.total) * 100)}%`;
  if (left <= 0 && !t.rang) { t.rang = true; chime(); }
}
setInterval(() => { tick(); if (ui.toast && Date.now() - ui.toast.at > 5000 && root.querySelector('.toast')) { ui.toast = null; render(); } }, 1000);

/* ---------- backup ---------- */
async function exportBackup() {
  const text = JSON.stringify(backupOf(S.data), null, 1);
  let dl: any = null;
  try { dl = (window as any).claude?.use ? await (window as any).claude.use('downloads') : null; } catch { dl = null; }
  if (!dl) { say('这里不能直接下载文件。在 claude.ai 里打开这个页面再导出。'); render(); return; }
  try { await dl.save({ filename: `Runway-backup-${T()}.json`, data: text }); say('备份已导出'); }
  catch (e: any) { say(e?.code === 'declined' ? '没有导出' : `导出没成功（${e?.code || '未知'}）`); }
  render();
}
function readFile(input: HTMLInputElement) {
  const f = input.files?.[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const b = parseBackup(String(fr.result));
    if (!b) { say('这不是 Runway 的备份文件'); render(); return; }
    ui.pending = b; ui.sheet = 'import'; render();
  };
  fr.readAsText(f);
}
async function doImport() {
  const b = ui.pending; if (!b) return;
  ui.busy = '正在恢复…'; render();
  await S.replaceAll(b, (d, n) => { ui.busy = `正在恢复… ${d} / ${n}`; const el = root.querySelector('.sheet .acts .soft'); if (el) el.textContent = ui.busy; });
  ui.busy = ''; ui.pending = null; ui.sheet = null; ui.started = true;
  say('备份已恢复'); render();
}

/* ---------- events ---------- */
root.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el || el.dataset.act === 'file') return;
  const { act, id, day, pid } = el.dataset;
  const eng = createEngine(view(), T());
  const title = id && raw(id) ? raw(id).title : '';
  switch (act) {
    case 'ten': plant(); startTimer(id!, 'ten', 600); break;
    case 'block': plant(); startTimer(id!, 'block', Math.round((raw(id!).hours || raw(id!).est || 1) * 3600)); break;
    case 'stop': plant(); break;
    case 'swap': ui.skip++; break;
    case 'done': toggleDone(id!); break;
    case 'all': ui.showAll = !ui.showAll; break;
    case 'drawer': ui.drawerOpen = !ui.drawerOpen; break;
    case 'today': moveTo(id!, T(), `「${title}」放到今天了`); break;
    case 'back': ui.picker = null; if (ui.timer?.id === id) plant(); moveTo(id!, null, `「${title}」放回项目了`); break;
    case 'pick': ui.picker = id!; break;
    case 'assign': ui.picker = null; moveTo(id!, day!, `「${title}」排到${day === T() ? '今天' : dayL(day!)}`); break;
    case 'close': ui.picker = null; if (!ui.busy) { ui.sheet = null; ui.pending = null; } break;
    case 'undo': ui.toast?.undo?.(); ui.toast = null; break;
    case 'layer': say(`${el.dataset.layer}这一层还没做，下一步加上`); break;
    case 'color': ui.colorFor = ui.colorFor === pid ? null : pid!; break;
    case 'setcolor': { const p = S.data.projects[pid!]; if (p) S.put('projects', pid!, { ...p, color: el.dataset.color }); ui.colorFor = null; break; }
    case 'cnt': {
      const p = S.data.projects[pid!]; if (!p?.count) break;
      const t = T(), log = { ...(p.count.log || {}) }; log[t] = (Number(log[t]) || 0) + 1;
      S.put('projects', pid!, { ...p, count: { ...p.count, log } });
      say(`${p.name} 今天 +1 ${p.count.unit || ''}`, () => { const q = S.data.projects[pid!]; const l2 = { ...(q.count.log || {}) }; l2[t] = Math.max(0, (Number(l2[t]) || 0) - 1); S.put('projects', pid!, { ...q, count: { ...q.count, log: l2 } }); });
      break;
    }
    case 'quick-today': addQuick(eng, true); break;
    case 'data': ui.sheet = 'data'; break;
    case 'export': exportBackup(); return;
    case 'import-ok': doImport(); return;
    case 'start': ui.started = true; break;
    case 'dismiss': S.clearProblem(); break;
    default: return;
  }
  render();
});
root.addEventListener('change', e => { const t = e.target as HTMLInputElement; if (t.dataset.act === 'file') readFile(t); });
root.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.id === 'quick-input') { ui.quick = t.value; const hint = root.querySelector('.quick-row .soft'); if (hint) { const q = ui.quick.trim() ? parseQuick(ui.quick, createEngine(view(), T())) : null; const h = q && q.title ? [q.project ? nameOf(createEngine(view(), T()), q.project) : '', q.hours ? fmtH(q.hours) : ''].filter(Boolean).join(' · ') : ''; hint.textContent = h ? '会记成：' + h : '可以加 #项目 和时长'; } } });
root.addEventListener('submit', e => { e.preventDefault(); if ((e.target as HTMLElement).dataset.form === 'quick') { addQuick(createEngine(view(), T()), false); render(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (ui.picker || ui.sheet)) { ui.picker = null; if (!ui.busy) { ui.sheet = null; ui.pending = null; } render(); } });

/* ---------- start ---------- */
toFloat = startBridge(S, T);
render();
S.connect().then(async () => {
  if (S.mode === 'memory') await S.replaceAll(seed(T()), () => {});
  render();
});
