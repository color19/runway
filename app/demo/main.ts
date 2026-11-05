// Visual demo of the "today" page and the project drawer, running on the real engine.
import { cnd, createEngine, dayLoads, diff, drawer, fmtH, investedByProject, investedDays, investedOn, lineage, monIdx, pickOrder, sessionsOf, sessionsOn, sum, todayOf } from '../../engine/src';
import type { Engine, Item } from '../../engine/src';
import { seed } from './seed';
import { dayStack, lampCount, projectRunway, sessionLabel, todayRunway } from './lights';

const T = todayOf(Date.now());
const store = seed(T);
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const dayL = (d: string) => `${cnd(d)} ${WD[monIdx(d)]}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const root = document.getElementById('app')!;

const ui = {
  skip: 0,
  showAll: false,
  drawerOpen: false,
  picker: null as string | null,
  timer: null as null | { id: string; kind: 'ten' | 'block'; startAt: number; endsAt: number; total: number; rang: boolean },
  justPlanted: '' as string,
  toast: null as null | { text: string; undo?: () => void; at: number },
};

/* ---------- store changes ---------- */
const raw = (id: string) => store.items[id];
function moveTo(id: string, date: string | null, text: string) {
  const prev = { date: raw(id).date, time: raw(id).time, end: raw(id).end };
  Object.assign(raw(id), { date, time: '', end: '' });
  say(text, () => Object.assign(raw(id), prev));
}
function toggleDone(id: string) {
  const it = raw(id), now = !it.done;
  Object.assign(it, { done: now, doneOn: now ? T : null });
  if (now) { chime(); if (ui.timer?.id === id) plant(); ui.skip = 0; }
}
function say(text: string, undo?: () => void) { ui.toast = { text, undo, at: Date.now() }; }

/** Ends the running timer and plants a tree for the time spent. Half a minute or more counts; nothing is ever lost. */
function plant() {
  const t = ui.timer; if (!t) return;
  ui.timer = null;
  const secs = Math.min(t.total, Math.round((Date.now() - t.startAt) / 1000));
  if (secs < 30) return;
  const it = raw(t.id), start = new Date(t.startAt);
  const id = 'live' + Date.now().toString(36);
  (store.sessions ||= {})[id] = { date: T, item: t.id, project: it.project || '', start: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`, mins: Math.max(1, Math.round(secs / 60)) };
  ui.justPlanted = id;
  const m = Math.max(1, Math.round(secs / 60));
  say(m >= 10 ? `又亮了 ${lampCount(m)} 盏灯 · ${fmtH(m / 60)}` : `亮了一点 · ${m} 分钟也算`);
}
const startTimer = (id: string, kind: 'ten' | 'block', secs: number) => { ui.timer = { id, kind, startAt: Date.now(), endsAt: Date.now() + secs * 1000, total: secs, rang: false }; };
const colorOf = (eng: Engine, pid: string) => eng.derive().projMap.get(pid)?.color || '#8F9A93';
function titleOf(eng: Engine, sid: string) { const s = store.sessions![sid]; return (s.item && store.items[s.item]?.title) || eng.derive().projMap.get(s.project)?.name || '专注'; }

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
  const exam = eng.derive().items.filter(i => i.kind === 'exam' && i.date && i.date >= T).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const left = exam ? diff(T, exam.date!) : null;
  return `<header class="bar">
    <div class="brand">Runway</div>
    <nav class="layers" aria-label="视角">
      <button type="button" data-act="layer" data-layer="全局">全局</button>
      <button type="button" data-act="layer" data-layer="本周">本周</button>
      <button type="button" aria-current="page">今天</button>
    </nav>
    ${exam ? `<div class="exam"><span>${esc(exam.title.replace(/考试$/, ''))}还有</span><b class="mono">${left}</b><span>天</span></div>` : ''}
  </header>`;
}

function dayHead(eng: Engine) {
  const tasks = eng.itemsOn(T).filter(i => i.kind === 'task');
  const placed = sum(tasks.map(i => i.done ? i.est : i.hours));
  const done = sum(tasks.filter(i => i.done).map(i => i.est));
  const cap = eng.capOf(T);
  const pct = placed > 0 ? Math.min(100, done / placed * 100) : 0;
  const over = placed - cap;
  return `<div class="dayhead">
    <h1>${dayL(T)}</h1>
    <p class="tally">今天排了 <b class="mono">${fmtH(placed)}</b><span class="sep"></span>做完了 <b class="mono">${fmtH(done)}</b><span class="sep"></span>还剩 <b class="mono">${fmtH(placed - done)}</b></p>
    <div class="meter" role="img" aria-label="今天做完 ${Math.round(pct)}%"><i style="width:${pct}%"></i></div>
    ${over > 0.01 ? `<p class="soft">今天排的比可用的 ${fmtH(cap)} 多 ${fmtH(over)}。可以把一两件放回项目，明天再说。</p>` : ''}
    ${groveToday(eng)}
  </div>`;
}

function groveToday(eng: Engine) {
  const all = sessionsOf(store), today = sessionsOn(all, T);
  const mins = sum(today.map(x => x.mins));
  const label = (x: typeof today[number]) => sessionLabel(titleOf(eng, x.id), x);
  return `<section class="grove-today" aria-label="今天的跑道灯">
    <div class="grove-hd"><h3>今天点亮的灯</h3><span><b class="mono">${lampCount(mins)}</b> 盏<span class="sep"></span>投入 <b class="mono">${fmtH(mins / 60)}</b></span></div>
    ${today.length
      ? todayRunway(today, pid => colorOf(eng, pid), label, ui.justPlanted)
      : `<p class="soft grove-empty">开始第一段专注，跑道就会亮起第一盏灯。一盏灯是 10 分钟，只做三分钟也会亮一点。</p>`}
  </section>`;
}

function groveWeek(eng: Engine) {
  const days = investedDays(sessionsOf(store), T, 7);
  const total = sum(days.map(d => d.hours));
  const label = (x: typeof days[number]['sessions'][number]) => sessionLabel(titleOf(eng, x.id), x);
  return `<section class="block week" aria-label="最近七天">
    <div class="grove-hd"><h3>最近七天</h3><span>一共 <b class="mono">${lampCount(total * 60)}</b> 盏<span class="sep"></span><b class="mono">${fmtH(total)}</b></span></div>
    <div class="weekgrid">${days.map(d => `<div class="wday${d.date === T ? ' is-today' : ''}">
      ${dayStack(d.sessions, pid => colorOf(eng, pid), label)}
      <span class="wd">${d.date === T ? '今天' : WD[monIdx(d.date)]}</span><span class="wh mono">${d.hours ? fmtH(d.hours) : '–'}</span>
    </div>`).join('')}</div>
    <p class="soft legend">一盏灯 10 分钟，颜色是项目。</p>
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
  const time = it.time ? `${it.time}–${it.end}` : '';
  return `<article class="now${running ? ' running' : ''}">
    <div class="now-label">${running ? (ui.timer!.kind === 'ten' ? '先做 10 分钟' : '整块进行中') : '现在做'}</div>
    <h2>${esc(it.title)}</h2>
    ${lineage(eng, it) ? `<p class="lin">${esc(lineage(eng, it))}</p>` : ''}
    <p class="est mono">${time ? time + ' · ' : ''}预计 ${fmtH(it.hours)}</p>
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
  const when = it.time ? `${it.time}–${it.end}` : it.kind === 'task' ? fmtH(it.hours || it.est) : '';
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
  const all = eng.itemsOn(T);
  return `<main class="today">
    ${dayHead(eng)}
    ${nowCard(eng, order)}
    ${next.length ? `<section class="block"><h3>接下来</h3><ul class="rows">${next.map(i => row(eng, i, { back: true })).join('')}</ul></section>` : ''}
    <section class="block">
      <button class="fold" type="button" data-act="all" aria-expanded="${ui.showAll}"><h3>今天全部</h3><span class="mono">${all.length}</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6l4 4 4-4"/></svg></button>
      ${ui.showAll ? `<ul class="rows">${all.map(i => row(eng, i, { check: true, back: true })).join('')}</ul>` : ''}
    </section>
    ${groveWeek(eng)}
  </main>`;
}

const PILL: Record<string, string> = { good: 'good', mid: 'tight', bad: 'short', flat: 'flat' };
function drawerView(eng: Engine) {
  const groups = drawer(eng);
  const waiting = sum(groups.map(g => g.items.length));
  const dv = eng.derive();
  const inv = investedByProject(sessionsOf(store));
  return `<aside class="drawer${ui.drawerOpen ? ' open' : ''}" aria-label="项目">
    <button class="drawer-handle" type="button" data-act="drawer" aria-expanded="${ui.drawerOpen}"><b>项目</b><span>${waiting} 件还没排进日子</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4-4 4 4"/></svg></button>
    <div class="drawer-hd"><h2>项目</h2><p>还没排进日子的事都在这里。放到今天，或者挑一天。</p></div>
    <div class="groups">
    ${groups.map(g => {
      const p = g.project, st = g.status;
      const isExam = p ? dv.items.some(x => x.kind === 'exam' && x.date === p.deadline) : false;
      const pill = !st ? '' : st.cnt ? `<span class="pill flat mono">今天 ${st.cnt.tD}/${st.cnt.tT} ${esc(p!.count!.unit)}</span>` : `<span class="pill ${PILL[st.k || 'flat']}">${esc(st.label)}</span>`;
      const spent = inv[p ? p.id : ''] || 0;
      const sub = [p && g.quotaToday > 0.01 ? `今天目标 ${fmtH(g.quotaToday)}` : '', spent > 0.01 ? `已投入 ${fmtH(spent)}` : '', p ? `${cnd(p.deadline)}${isExam ? '考试' : '截止'}` : '没有截止日，什么时候做都行'].filter(Boolean).join(' · ');
      return `<section class="grp">
        <header><span class="swatch" style="background:${p ? esc(p.color) : 'var(--muted)'}"></span><b>${p ? esc(p.name) : '生活和杂事'}</b>${pill}</header>
        <p class="grp-sub">${sub}</p>
        ${p && st && !st.cnt ? projectRunway(spent, st.rem, p.color) : ''}
        ${g.items.length ? `<ul class="items">${g.items.map(i => {
          const mod = p?.modules.find(m => m.id === i.module)?.name;
          return `<li class="it">
            <div class="it-t"><span>${esc(i.title)}</span><small>${[mod, fmtH(i.hours || i.est)].filter(Boolean).map(esc).join(' · ')}</small></div>
            <div class="it-a"><button class="mini signal" type="button" data-act="today" data-id="${i.id}">放到今天</button><button class="mini" type="button" data-act="pick" data-id="${i.id}" aria-label="挑一天">挑一天</button></div>
          </li>`; }).join('')}</ul>` : `<p class="grp-none">没有待排的事，引擎会按剩下的量往后摊。</p>`}
      </section>`; }).join('')}
    </div>
  </aside>`;
}

function pickerView(eng: Engine) {
  if (!ui.picker) return '';
  const it = eng.derive().items.find(i => i.id === ui.picker)!;
  const need = it.hours || it.est;
  const due = eng.derive().projMap.get(it.project)?.deadline;
  return `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="排到哪天">
    <header><h2>「${esc(it.title)}」排到哪天？</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <p class="soft">要 ${fmtH(need)}。条子是每天已经排了多少，对比能用多少。</p>
    <ul class="days">${dayLoads(eng, T, 14).map(l => {
      const pct = l.cap > 0 ? Math.min(100, l.placed / l.cap * 100) : 100;
      const late = !!due && l.date >= due;
      const fits = !late && l.cap > 0 && l.room >= need - 1e-6;
      const txt = late ? (l.date === due ? '截止当天' : '过了截止') : l.cap <= 0 ? '休息日' : l.room <= 0.01 ? '已经排满' : fits ? `还能放 ${fmtH(l.room)}` : `只剩 ${fmtH(l.room)}`;
      return `<li><button type="button" class="day${fits ? ' fits' : ''}${late ? ' late' : ''}" data-act="assign" data-id="${it.id}" data-day="${l.date}">
        <span class="d">${l.date === T ? '今天' : dayL(l.date)}</span>
        <span class="load" aria-hidden="true"><i style="width:${pct}%"></i></span>
        <span class="r">${txt}</span>
      </button></li>`; }).join('')}</ul>
  </div>`;
}

function toastView() {
  const t = ui.toast;
  if (!t || Date.now() - t.at > 5000) return '';
  return `<div class="toast" role="status"><span>${esc(t.text)}</span>${t.undo ? `<button type="button" data-act="undo">撤销</button>` : ''}</div>`;
}

function render() {
  const eng = createEngine(store, T);
  const y = window.scrollY;
  const dScroll = (root.querySelector('.groups') as HTMLElement | null)?.scrollTop ?? 0;
  root.innerHTML = `${header(eng)}<div class="cols">${today(eng)}${drawerView(eng)}</div>${pickerView(eng)}${toastView()}
    <p class="foot">演示用的示例数据，刷新会回到初始状态。背后跑的是真的排程引擎：放一件到今天，项目状态和今天的总量会跟着重算。</p>`;
  window.scrollTo(0, y);
  const g = root.querySelector('.groups') as HTMLElement | null; if (g) g.scrollTop = dScroll;
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

/* ---------- events ---------- */
root.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  const { act, id, day } = el.dataset;
  const title = id ? raw(id).title : '';
  switch (act) {
    case 'ten': plant(); startTimer(id!, 'ten', 600); break;
    case 'block': plant(); startTimer(id!, 'block', Math.round((raw(id!).hours || 1) * 3600)); break;
    case 'stop': plant(); break;
    case 'swap': ui.skip++; break;
    case 'done': toggleDone(id!); break;
    case 'all': ui.showAll = !ui.showAll; break;
    case 'drawer': ui.drawerOpen = !ui.drawerOpen; break;
    case 'today': moveTo(id!, T, `「${title}」放到今天了`); break;
    case 'back': if (ui.timer?.id === id) plant(); moveTo(id!, null, `「${title}」放回项目了`); break;
    case 'pick': ui.picker = id!; break;
    case 'assign': ui.picker = null; moveTo(id!, day!, `「${title}」排到${day === T ? '今天' : dayL(day!)}`); break;
    case 'close': ui.picker = null; break;
    case 'undo': ui.toast?.undo?.(); ui.toast = null; break;
    case 'layer': say(`${el.dataset.layer}这一层是下一步，这个演示先看今天`); break;
    default: return;
  }
  render();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.picker) { ui.picker = null; render(); } });

render();
