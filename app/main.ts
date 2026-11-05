// Runway: today's runway, the "now" card and the project drawer, on the real engine and real data.
import { MAX_DEPTH, add, cnd, createEngine, descendants, projectTree, range, dayLoads, diff, drawer, fmtH, investedByProject, investedDays, lineage, monIdx, parse, pickOrder, r2, sessionsOn, sessionsWithLogs, sum, todayOf } from '../engine/src';
import type { Engine, Item, ProjectStatus, Session, Store, TreeNode } from '../engine/src';
import { seed } from './seed';
import { axisFor, projectRunway, ribbon, ruler, timetable, untimed } from './ribbon';
import { backupOf, createStore, parseBackup } from './store';
import { startBridge } from './bridge';

const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WD_EN = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
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
  layer: 'today' as 'today' | 'project' | 'week' | 'global',
  pid: '',
  /** Folds the viewer flipped away from the default (fully done modules start folded). */
  fold: new Set<string>(),
  showDone: false,
  addUnder: '',
  subText: '',
  focusSub: false,
  weekOff: 0,
  sheet: null as null | 'data' | 'import' | 'edit' | 'wrap' | 'cap',
  editId: '',
  draft: {} as Record<string, string>,
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
const parentOf = (id: string): string | undefined => S.data.items[id]?.parent || undefined;
/** Ids of tasks that have steps under them; their time is the sum of the steps. */
const parentIds = () => new Set(Object.values(S.data.items).filter(x => !x.old && x.parent && S.data.items[x.parent] && !S.data.items[x.parent].old).map(x => x.parent as string));
const kidsOf = (id: string) => Object.entries(S.data.items).filter(([, x]) => !x.old && x.parent === id).map(([k]) => k);
/** "CFA Level 1 › 固定收益 · 离考试 13 天" with the task a step sits under put in. */
function trail(eng: Engine, it: Item) {
  const l = lineage(eng, it), up = parentOf(it.id), pt = up && raw(up) && !raw(up).old ? raw(up).title : '';
  if (!pt) return l;
  if (!l) return pt;
  return l.includes(' · ') ? l.replace(' · ', ` › ${pt} · `) : `${l} › ${pt}`;
}
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
  if (now) for (const k of descendants(id, Object.keys(S.data.items).map(x => ({ id: x })), parentOf)) if (!raw(k).old && !raw(k).done) patch(k, { done: true, doneOn: T() });
  // a task with steps is done exactly when all its steps are
  for (let c = id, up = parentOf(c), n = 0; up && raw(up) && n < MAX_DEPTH + 1; c = up, up = parentOf(c), n++) {
    const all = kidsOf(up).every(k => !!raw(k).done);
    if (all && !raw(up).done) patch(up, { done: true, doneOn: T() });
    else if (!all && raw(up).done) patch(up, { done: false, doneOn: null });
    else break;
  }
}

/** Ends the running timer and puts the time spent on today's runway. Half a minute or more counts. */
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
  say(`跑道上多了 ${fmtH(mins / 60)}${mins < 10 ? '，几分钟也算' : ''}`);
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
function header() {
  const saved = S.mode === 'live' ? '已保存' : S.mode === 'memory' ? '没有保存' : S.mode === 'loading' ? '读取中' : '保存出了问题';
  return `<header class="bar">
    <div class="brand">Runway</div>
    <nav class="layers" aria-label="视角">
      ${(['global', 'project', 'week', 'today'] as const).map(l => `<button type="button" data-act="layer" data-layer="${l}"${ui.layer === l ? ' aria-current="page"' : ''}>${{ global: '全局', project: '项目', week: '本周', today: '今天' }[l]}</button>`).join('')}
    </nav>
    <button class="savestate ${S.mode}" type="button" data-act="data"><i></i>${saved}</button>
  </header>
  ${S.problem ? `<p class="problem" role="alert">${esc(S.problem)}<button type="button" data-act="dismiss">知道了</button></p>` : ''}
  ${S.mode === 'memory' ? `<p class="problem">这个页面现在拿不到数据库，看到的是示例，改动刷新就会丢。在 claude.ai 里打开这个页面才能保存。</p>` : ''}`;
}

function legend(eng: Engine, list: Session[]) {
  const by = new Map<string, number>();
  for (const x of list) by.set(x.project, (by.get(x.project) || 0) + x.mins);
  if (!by.size) return '';
  return `<ul class="legend-chips">${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([pid, m]) =>
    `<li><i style="background:${esc(colorOf(eng, pid))}"></i>${esc(nameOf(eng, pid))}<span class="mono">${fmtH(m / 60)}</span></li>`).join('')}</ul>`;
}

const hoursUpper = (h: number) => fmtH(h).toUpperCase();
/** "CFA Level 1" → "CFA", "643 Economics…" → "643", "求职2027NG" → "求职". */
const shortName = (name: string) => (name.match(/^([A-Za-z]+|\d+|[一-鿿]{1,4})/) || [name.slice(0, 4)])[0];

/** Today as one page of a Korean study planner: header, comment, now, tasks on the left; the 10-minute timetable on the right. */
function page(eng: Engine) {
  const t = T(), d = parse(t);
  const dv = eng.derive(), items = eng.itemsOn(t);
  const sessions = sessionsOn(sessionsWithLogs(view()), t);
  const invested = sum(sessions.map(x => x.mins)) / 60;
  const exam = dv.items.filter(i => i.kind === 'exam' && i.date && i.date >= t && !i.done).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const tasks = items.filter(i => i.kind === 'task');
  const placed = sum(tasks.map(i => i.done ? i.est : i.hours)), cap = eng.capOf(t);
  const planned = items.filter(i => !i.done && i.time && (i.kind === 'task' || i.kind === 'event'));
  const now = nowMin();
  const tm = ui.timer, startMin = tm ? new Date(tm.startAt).getHours() * 60 + new Date(tm.startAt).getMinutes() : 0;
  const ax = axisFor(sessions, planned, [now, ...(tm ? [startMin] : [])]);
  const live = tm && raw(tm.id) ? { startMin, nowMin: now, color: colorOf(eng, raw(tm.id).project || ''), title: raw(tm.id).title } : null;
  const note = String(S.data.notes[t]?.text || '').split('\n')[0];
  const order = pickOrder(eng, now);
  const cur = order.length ? (ui.timer ? order.find(i => i.id === ui.timer!.id) || order[0] : order[ui.skip % order.length]) : null;
  const next = order.filter(i => i !== cur).slice(0, 2);
  // tasks grouped by subject, as in a paper planner
  const groups = new Map<string, Item[]>();
  for (const it of [...tasks].sort((a, b) => Number(a.done) - Number(b.done))) { const k = it.project || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(it); }
  const logged = (it: Item) => Object.keys(it.log || {}).some(k => k === t) || sessions.some(x => x.item === it.id && !x.estimated);
  return `<section class="page" aria-label="今天这一页">
    <div class="pg-main">
      <div class="pad pad-cream">
      <div class="pad-hd"><span>today</span><span class="mono">${t.replace(/-/g, '.')}</span></div>
      <header class="pg-head">
        <div class="pg-date"><span class="kick">${WD[monIdx(t)]} · ${d.getMonth() + 1}月${d.getDate()}日</span><h1>${WD_EN[monIdx(t)].toLowerCase()}</h1></div>
        <div class="pg-nums">
          ${exam ? `<div><span class="kick">d-day · ${esc(shortName(exam.title))}</span><b class="big">D-${diff(t, exam.date!)}</b></div>` : ''}
          <div><span class="kick">total time</span><b class="big signal">${hoursUpper(invested)}</b></div>
        </div>
      </header>
      <label class="pg-comment"><span class="kick">comment</span><input id="comment" type="text" autocomplete="off" maxlength="80" placeholder="今天想对自己说的一句话" value="${esc(note)}"></label>
      </div>
      <div class="pad pad-butter">
        <div class="pad-hd"><span>focus on</span><span>${order.length ? `还有 ${order.length} 件` : '都做完了'}</span></div>
        ${nowCard(eng, order)}
        ${next.length ? `<section class="block next"><h3 class="kick">next</h3><ul class="rows">${next.map(i => row(eng, i, { back: true })).join('')}</ul></section>` : ''}
      </div>
      <section class="pad pad-sage tasks">
        <div class="pad-hd"><span>tasks</span><span>排了 ${fmtH(placed)}${placed > cap + 0.01 ? `，比可用的 ${fmtH(cap)} 多 ${fmtH(placed - cap)}` : ''}</span></div>
        ${groups.size ? [...groups.entries()].map(([pid, its]) => `<div class="tg">
          <span class="tg-sub" style="--c:${esc(colorOf(eng, pid))}">${esc(pid ? shortName(nameOf(eng, pid)) : '生活')}</span>
          <ul>${its.map(it => `<li class="tl${it.done ? ' done' : ''}"${it.done ? '' : ` draggable="true" data-drag="${it.id}"`}>
            <span class="tl-t"><button class="ed" type="button" data-act="edit" data-id="${it.id}">${esc(it.title)}</button></span>
            <span class="tl-m mono">${it.time ? it.time : (it.hours || it.est) ? fmtH(it.hours || it.est) : ''}</span>
            <button class="mark${it.done ? ' o' : logged(it) ? ' tri' : ''}" type="button" data-act="done" data-id="${it.id}" aria-label="${it.done ? '标成没做完' : '标成做完'}：${esc(it.title)}">${it.done ? 'O' : logged(it) ? '△' : ''}</button>
            ${!it.done ? `<button class="mini ghost" type="button" data-act="back" data-id="${it.id}" aria-label="放回项目：${esc(it.title)}">放回</button>` : '<span></span>'}
          </li>`).join('')}</ul>
        </div>`).join('') : `<p class="soft">今天还没排事。从右边的项目里放一件进来。</p>`}
        <div class="tasks-foot"><button class="btn quiet" type="button" data-act="wrap">收工</button></div>
      </section>
    </div>
    <aside class="pad pad-sky pg-side" aria-label="时间表">
      <div class="pad-hd"><span>time table</span><span>10 min</span></div>
      ${timetable({ sessions, planned, axis: ax, colorOf: pid => colorOf(eng, pid), titleOf: x => titleOf(eng, x), nowMin: now, live, fresh: ui.justPlanted })}
      ${legend(eng, sessions)}
      ${untimed(sessions, pid => colorOf(eng, pid), pid => nameOf(eng, pid))}
      ${sessions.some(x => x.estimated) ? `<p class="soft tiny">斜纹是做完了但没计时的，按排的时段大致画上。</p>` : ''}
    </aside>
  </section>`;
}

function weekRuns(eng: Engine) {
  const t = T(), days = investedDays(sessionsWithLogs(view()), t, 7);
  const total = sum(days.map(d => d.hours));
  const ax = axisFor(days.flatMap(d => d.sessions));
  return `<section class="pad pad-lilac week" aria-label="最近七天">
    <div class="pad-hd"><span>weekly · 最近七天</span><span>一共 <b class="mono">${fmtH(total)}</b></span></div>
    <div class="wk">
      <div class="wk-row wk-head"><span></span>${ruler(ax)}<span></span><span></span></div>
      ${days.map(d => `<div class="wk-row${d.date === t ? ' is-today' : ''}">
        <span class="wd">${d.date === t ? '今天' : WD[monIdx(d.date)]}</span>
        ${ribbon({ sessions: d.sessions, axis: ax, colorOf: pid => colorOf(eng, pid), titleOf: x => titleOf(eng, x), nowMin: d.date === t ? nowMin() : undefined })}
        <span class="wk-untimed">${untimed(d.sessions, pid => colorOf(eng, pid), pid => nameOf(eng, pid))}</span>
        <span class="wh mono">${d.hours ? fmtH(d.hours) : '–'}</span>
      </div>`).join('')}
    </div>
    ${legend(eng, days.flatMap(d => d.sessions))}
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
    <h2><button class="ed" type="button" data-act="edit" data-id="${it.id}">${esc(it.title)}</button></h2>
    ${trail(eng, it) ? `<p class="lin">${esc(trail(eng, it))}</p>` : ''}
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
  const lin = trail(eng, it);
  const when = it.time ? `${it.time}${it.end ? '–' + it.end : ''}` : it.kind === 'task' && (it.hours || it.est) ? fmtH(it.hours || it.est) : '';
  return `<li class="row${it.done ? ' done' : ''}${it.kind !== 'task' ? ' event' : ''}">
    ${opts.check && it.kind === 'task' ? `<input class="check" type="checkbox" id="c-${it.id}" data-act="done" data-id="${it.id}" ${it.done ? 'checked' : ''} aria-label="做完了：${esc(it.title)}">` : `<span class="dotslot"></span>`}
    <div class="row-t"><span><button class="ed" type="button" data-act="edit" data-id="${it.id}">${esc(it.title)}</button></span>${lin ? `<small>${esc(lin)}</small>` : ''}</div>
    <span class="row-m mono">${when}</span>
    ${opts.back && it.kind === 'task' && !it.done ? `<button class="mini" type="button" data-act="back" data-id="${it.id}">放回项目</button>` : '<span></span>'}
  </li>`;
}

function today(eng: Engine) {
  return `<main class="today">${page(eng)}${weekRuns(eng)}</main>`;
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
  const holders = parentIds();
  const groups = drawer(eng).map(g => ({ ...g, items: g.items.filter(i => !holders.has(i.id)) }));
  const waiting = sum(groups.map(g => g.items.length));
  const dv = eng.derive(), t = T();
  const inv = investedByProject(sessionsWithLogs(view()));
  return `<aside class="drawer pad-sand${ui.drawerOpen ? ' open' : ''}" aria-label="项目" data-drop="pool">
    <button class="drawer-handle" type="button" data-act="drawer" aria-expanded="${ui.drawerOpen}"><b>项目</b><span>${waiting} 件还没排进日子</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4-4 4 4"/></svg></button>
    <div class="pad-hd drawer-hd"><span>projects</span><span>还没排进日子的事</span></div>
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
        <header>${p ? `<button class="swatch" type="button" data-act="color" data-pid="${p.id}" style="background:${esc(color)}" aria-label="换 ${esc(p.name)} 的颜色" aria-expanded="${ui.colorFor === p.id}"></button>` : `<span class="swatch" style="background:${LOOSE_COLOR}"></span>`}${p ? `<button class="ed grp-name" type="button" data-act="proj" data-pid="${p.id}"><b>${esc(p.name)}</b></button>` : '<b>生活和杂事</b>'}${pill}</header>
        ${p && ui.colorFor === p.id ? `<div class="palette" role="group" aria-label="选颜色">${PALETTE.map(([n, c]) => `<button type="button" data-act="setcolor" data-pid="${p.id}" data-color="${c}" style="background:${c}" aria-label="${n}" aria-pressed="${c.toLowerCase() === color.toLowerCase()}" title="${n}"></button>`).join('')}</div>` : ''}
        <p class="grp-sub">${sub}</p>
        ${p && st && !st.cnt ? projectRunway(spent, st.rem, color) : ''}
        ${g.items.length ? `<ul class="items">${g.items.map(i => {
          const mod = p?.modules.find(m => m.id === i.module)?.name;
          const was = i.date && i.date < t ? `原来排在 ${cnd(i.date)}` : '';
          return `<li class="it" draggable="true" data-drag="${i.id}">
            <div class="it-t"><span><button class="ed" type="button" data-act="edit" data-id="${i.id}">${esc(i.title)}</button></span><small>${[mod, (i.hours || i.est) ? fmtH(i.hours || i.est) : '', was].filter(Boolean).map(esc).join(' · ')}</small></div>
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
  if (ui.sheet !== 'data' && ui.sheet !== 'import') return '';
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

/** Click a task to change it. Values live in ui.draft so a re-render from the database never wipes what is being typed. */
function openEdit(id: string) {
  const it = raw(id); if (!it) return;
  ui.sheet = 'edit'; ui.editId = id;
  ui.draft = { title: it.title || '', date: it.date || '', time: it.time || '', end: it.end || '', hours: String(r2(Number(it.hours) || 0)), project: it.project || '', parent: it.parent || '', note: it.note || '' };
}
function editView(eng: Engine) {
  if (ui.sheet !== 'edit') return '';
  const it = raw(ui.editId); if (!it) return '';
  const d = ui.draft, task = (it.kind || 'task') === 'task';
  const projects = eng.derive().projects.slice();
  if (d.project && !projects.some(p => p.id === d.project) && S.data.projects[d.project]) projects.push({ id: d.project, name: S.data.projects[d.project].name } as any);
  const f = (name: string, label: string, type = 'text', extra = '') => `<label class="fld"><span>${label}</span><input id="ed-${name}" name="${name}" type="${type}" value="${esc(d[name])}" autocomplete="off" ${extra}></label>`;
  return `<div class="scrim" data-act="close"></div>
  <div class="sheet top" role="dialog" aria-modal="true" aria-label="改这件事">
    <header><h2>改这件事</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <form class="edit" data-form="edit">
      ${f('title', '名字', 'text', 'maxlength="200" required')}
      <div class="fld-row">${f('date', '哪天', 'date')}${f('time', '开始', 'time')}${f('end', '结束', 'time')}</div>
      <div class="fld-row">
        ${task ? f('hours', '还要多少小时', 'number', 'min="0" max="24" step="0.25" inputmode="decimal"') : ''}
        <label class="fld"><span>项目</span><select id="ed-project" name="project">
          <option value=""${d.project ? '' : ' selected'}>生活和杂事</option>
          ${projects.map(p => `<option value="${esc(p.id)}"${p.id === d.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
      </div>
      ${task ? parentField(eng, ui.editId, d.project, d.parent) : ''}
      <label class="fld"><span>备注</span><textarea id="ed-note" name="note" rows="3">${esc(d.note)}</textarea></label>
      <p class="soft tiny">日期空着，就是放在项目里，还没排进哪天。</p>
      <div class="acts">
        <button class="btn primary" type="submit">保存</button>
        <button class="btn" type="button" data-act="close">取消</button>
        <span class="grow"></span>
        ${!it.done ? `<button class="btn quiet" type="button" data-act="drop" data-id="${esc(ui.editId)}">不做了</button>` : ''}
      </div>
    </form>
  </div>`;
}
function saveEdit() {
  const id = ui.editId, it = raw(id); if (!it) return;
  const d = ui.draft, prev = { ...it };
  const date = d.date || null;
  const next: Record<string, any> = { ...it, title: d.title.trim() || it.title, date, time: date ? d.time : '', end: date ? d.end : '', project: d.project, note: d.note };
  if (d.project !== (it.project || '')) next.module = '';
  let undoHolder = () => {};
  if ((it.kind || 'task') === 'task') {
    const h = Math.max(0, r2(Number(d.hours) || 0));
    next.hours = h;
    if (!(Number(it.est) > 0)) next.est = h;
    const up = d.parent && raw(d.parent) && !raw(d.parent).old && (raw(d.parent).project || '') === d.project && d.parent !== id ? d.parent : '';
    next.parent = up;
    if (up) { next.module = raw(up).module || ''; if (up !== (it.parent || '')) undoHolder = becomeHolder(up); }
  }
  S.put('items', id, next);
  ui.sheet = null; ui.editId = '';
  say('改好了', () => { S.put('items', id, prev); undoHolder(); });
}
/** Soft "not doing it": the task leaves every list but stays in the data and the backup. */
function drop(id: string) {
  if (ui.timer?.id === id) plant();
  const title = raw(id).title;
  const under = descendants(id, Object.keys(S.data.items).map(k => ({ id: k })), parentOf).filter(k => !raw(k).old);
  for (const k of [id, ...under]) { if (ui.timer?.id === k) plant(); patch(k, { old: true }); }
  say(`「${title}」${under.length ? `和下面 ${under.length} 步` : ''}不做了`, () => { for (const k of [id, ...under]) patch(k, { old: false }); });
}

/** End of the day: what got done, and where each unfinished task goes. Nothing is marked late. */
function wrapView(eng: Engine) {
  if (ui.sheet !== 'wrap') return '';
  const t = T();
  const tasks = eng.itemsOn(t).filter(i => i.kind === 'task');
  const done = tasks.filter(i => i.done), open = tasks.filter(i => !i.done);
  const mins = sum(sessionsOn(sessionsWithLogs(view()), t).map(x => x.mins));
  const note = String(S.data.notes[t]?.text || '').split('\n')[0];
  return `<div class="scrim" data-act="close"></div>
  <div class="sheet top" role="dialog" aria-modal="true" aria-label="收工">
    <header><h2>收工</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <p>${done.length ? `今天做完了 ${done.length} 件` : '今天还没有勾掉的事'}${mins ? `，跑道上一共 ${fmtH(mins / 60)}` : ''}。${done.length || mins ? '' : '有些日子就是这样，明天再来。'}</p>
    ${done.length ? `<p class="wrap-done">${done.map(i => esc(i.title)).join(' · ')}</p>` : ''}
    ${open.length ? `<h3 class="kick">没做完的，放到哪</h3>
      <ul class="wrap-list">${open.map(i => `<li>
        <span class="wt">${esc(i.title)}${(i.hours || i.est) ? `<small class="mono"> ${fmtH(i.hours || i.est)}</small>` : ''}</span>
        <button class="mini signal" type="button" data-act="tmrw" data-id="${i.id}">明天</button>
        <button class="mini" type="button" data-act="back" data-id="${i.id}">放回项目</button>
        <button class="mini ghost" type="button" data-act="drop" data-id="${i.id}">不做了</button>
      </li>`).join('')}</ul>` : `<p class="soft">今天排的都安排好了。</p>`}
    <label class="fld"><span>comment</span><input id="wrap-comment" type="text" autocomplete="off" maxlength="80" placeholder="今天想对自己说的一句话" value="${esc(note)}"></label>
    <div class="acts"><button class="btn primary" type="button" data-act="close">好了</button></div>
  </div>`;
}

/* ---------- planning layers: week and global ---------- */
/** The engine's labels, said without debt or deadlines-in-red. */
function calm(st?: ProjectStatus | null) {
  const l = st?.label || '';
  if (l.startsWith('欠')) return { k: 'tight', label: '有点赶' };
  if (l === '已过 Deadline') return { k: 'flat', label: '过了截止日' };
  return { k: PILL[st?.k || 'flat'], label: l };
}
const mainSettings = () => (S.data.settings.main || {}) as Record<string, any>;
/** Changes the hours available on single days (settings.over), with undo. */
function setDays(days: string[], to: (cap: number) => number, text: string) {
  const eng = createEngine(view(), T()), main = mainSettings();
  const prev = { ...(main.over || {}) }, over = { ...prev };
  for (const d of days) {
    if (main.off && main.off[d] != null) continue;
    const v = Math.max(0, Math.min(24, r2(to(eng.capOf(d)))));
    if (Math.abs(v - (Number(eng.settings.cap[monIdx(d)]) || 0)) < 1e-6) delete over[d]; else over[d] = v;
  }
  S.put('settings', 'main', { ...main, over });
  say(text, () => S.put('settings', 'main', { ...mainSettings(), over: prev }));
}

function weekView(eng: Engine) {
  const t = T();
  const back = Number(eng.settings.weekStart) === 0 ? (monIdx(t) + 1) % 7 : monIdx(t);
  const start = add(add(t, -back), ui.weekOff * 7);
  const all = sessionsWithLogs(view());
  const alloc = eng.allocate(t).byDay;
  const rows = range(start, add(start, 6)).map(d => {
    const its = eng.itemsOn(d), tasks = its.filter(i => i.kind === 'task');
    return {
      d, its, cap: eng.capOf(d),
      placed: sum(tasks.map(i => i.done ? i.est : i.hours)),
      spent: sum(sessionsOn(all, d).map(x => x.mins)) / 60,
      sug: Object.entries(alloc[d] || {}).filter(([, h]) => h > 0.05).sort((a, b) => b[1] - a[1]),
    };
  });
  const scale = Math.max(1, ...rows.map(r => Math.max(r.cap, r.placed)));
  const name = ui.weekOff === 0 ? '这周' : ui.weekOff === -1 ? '上周' : ui.weekOff === 1 ? '下周' : `${cnd(start)}那周`;
  return `<main class="plan">
    <section class="pad pad-sky wv" aria-label="本周">
      <div class="pad-hd"><span>week · ${name}</span><span>排了 ${fmtH(sum(rows.map(r => r.placed)))}，能用 ${fmtH(sum(rows.map(r => r.cap)))}</span></div>
      <nav class="wv-nav" aria-label="换一周">
        <button class="mini" type="button" data-act="wk" data-step="-1">‹ 上一周</button>
        <b>${cnd(start)} – ${cnd(add(start, 6))}</b>
        ${ui.weekOff ? `<button class="mini" type="button" data-act="wk" data-step="0">回到这周</button>` : ''}
        <button class="mini" type="button" data-act="wk" data-step="1">下一周 ›</button>
      </nav>
      <p class="soft tiny wv-tip">把一件事拖到另一天就改了日期，拖到右边项目里就放回去。手机上点名字改日期。</p>
      ${rows.map(r => {
        const past = r.d < t, isT = r.d === t, over = r.placed > r.cap + 0.01;
        const capW = r.cap / scale * 100, fillW = Math.min(r.placed, r.cap) / scale * 100;
        return `<section class="wv-day${isT ? ' is-today' : ''}${past ? ' past' : ''}" data-drop="${r.d}">
          <header class="wv-hd"><b>${isT ? '今天' : WD[monIdx(r.d)]}</b><span class="mono">${r.d.slice(5).replace('-', '.')}</span></header>
          <div class="wv-body">
            <div class="wv-load">
              <span class="wv-bar" aria-hidden="true"><i class="cap" style="width:${capW}%"></i><i class="fill" style="width:${fillW}%"></i>${over ? `<i class="over" style="left:${capW}%;width:${(r.placed - r.cap) / scale * 100}%"></i>` : ''}</span>
              <span class="wv-num mono">${r.cap <= 0 && !r.placed ? '休息日' : `排了 ${fmtH(r.placed)} / 能用 ${fmtH(r.cap)}`}</span>
              ${past ? '' : `<span class="wv-step"><button class="mini" type="button" data-act="cap-day" data-day="${r.d}" data-by="-1" aria-label="${cnd(r.d)}少 1 小时">−</button><button class="mini" type="button" data-act="cap-day" data-day="${r.d}" data-by="1" aria-label="${cnd(r.d)}多 1 小时">+</button></span>`}
            </div>
            ${r.its.length ? `<ul class="wv-items">${r.its.map(i => {
              const task = i.kind === 'task', h = task ? (i.done ? i.est : i.hours) : 0;
              return `<li class="wv-chip${i.done ? ' done' : ''}${task ? '' : ' ev'}" style="--c:${esc(colorOf(eng, i.project || ''))}"${task && !i.done ? ` draggable="true" data-drag="${i.id}"` : ''}>
                <button class="ed" type="button" data-act="edit" data-id="${i.id}">${esc(i.title)}</button>
                <span class="mono">${i.time ? i.time : h ? fmtH(h) : ''}</span>${i.done ? '<span class="o" aria-label="做完了">O</span>' : ''}
              </li>`; }).join('')}</ul>` : `<p class="wv-none">${past ? '这天没排事' : '还没排事，可以从右边拖一件过来'}</p>`}
            <p class="wv-sug">${past
              ? (r.spent ? `那天做了 ${fmtH(r.spent)}` : '')
              : r.sug.length ? `照截止日摊到这天：${r.sug.map(([pid, h]) => `<span style="--c:${esc(colorOf(eng, pid))}">${esc(shortName(nameOf(eng, pid)))} ${fmtH(h)}</span>`).join(' · ')}` : ''}</p>
          </div>
        </section>`; }).join('')}
    </section>
  </main>`;
}

function globalView(eng: Engine) {
  const t = T(), dv = eng.derive();
  const projs = dv.projects.filter(p => p.deadline >= t);
  const marks = dv.items.filter(i => (i.kind === 'exam' || i.kind === 'deadline') && i.date && i.date >= t && !i.done);
  let end = [...projs.map(p => p.deadline), ...marks.map(i => i.date!)].sort().pop() || add(t, 27);
  if (diff(t, end) < 27) end = add(t, 27);
  if (diff(t, end) > 180) end = add(t, 180);
  const span = diff(t, end) + 1;
  const X = (d: string) => Math.max(0, Math.min(100, diff(t, d) / span * 100));
  const mondays = range(t, end).filter(d => monIdx(d) === 0);
  const grid = `<span class="gv-grid" aria-hidden="true">${mondays.map(d => `<i style="left:${X(d)}%"></i>`).join('')}</span>`;
  const loose = marks.filter(i => !projs.some(p => p.deadline === i.date));
  const lanes = projs.map(p => {
    const st = eng.projStatus(p), w = calm(st), c = p.color || LOOSE_COLOR;
    const from = p.start > t ? p.start : t, left = diff(t, p.deadline);
    const isExam = marks.some(i => i.kind === 'exam' && i.date === p.deadline);
    const cnt = st.cnt ? `今天 ${st.cnt.tD}/${st.cnt.tT} ${p.count?.unit || ''}` : '';
    const sub = [`${cnd(p.deadline)}${isExam ? '考试' : '截止'} · 还有 ${left} 天`, cnt || (st.rem > 0.01 ? `还剩 ${fmtH(st.rem)}` : ''), cnt ? '' : (st.short || '')].filter(Boolean).join(' · ');
    return `<div class="gv-row">
      <div class="gv-name"><span><i style="background:${esc(c)}"></i><button class="ed" type="button" data-act="proj" data-pid="${p.id}"><b>${esc(p.name)}</b></button></span>${w.label ? `<span class="pill ${w.k}">${esc(w.label)}</span>` : ''}</div>
      <div class="gv-track">${grid}<span class="gv-bar" style="left:${X(from)}%;width:${Math.max(0.8, X(p.deadline) - X(from))}%;--c:${esc(c)}"></span><span class="gv-end" style="left:${X(p.deadline)}%;--c:${esc(c)}" title="${esc(cnd(p.deadline))}"></span></div>
      <p class="gv-sub">${esc(sub)}</p>
    </div>`;
  }).join('');
  const other = loose.length ? `<div class="gv-row">
      <div class="gv-name"><span><i style="background:${LOOSE_COLOR}"></i><b>其他日子</b></span></div>
      <div class="gv-track">${grid}${loose.map(i => `<span class="gv-end" style="left:${X(i.date!)}%;--c:${LOOSE_COLOR}" title="${esc(cnd(i.date!) + ' ' + i.title)}"></span>`).join('')}</div>
      <p class="gv-sub">${loose.map(i => esc(`${cnd(i.date!)} ${i.title}`)).join(' · ')}</p>
    </div>` : '';
  const loads = range(t, end).map(d => ({ d, need: eng.dayNeed(d), cap: eng.capOf(d) }));
  const top = Math.max(1, ...loads.map(l => Math.max(l.need, l.cap)));
  const crowded: Array<{ from: string; to: string; need: number[]; cap: number[] }> = [];
  let run: (typeof crowded)[number] | null = null;
  for (const l of loads) {
    if (l.cap > 0 && l.need > l.cap + 0.25) { if (!run) crowded.push(run = { from: l.d, to: l.d, need: [], cap: [] }); run.to = l.d; run.need.push(l.need); run.cap.push(l.cap); }
    else if (l.cap > 0) run = null;
  }
  const avg = (a: number[]) => sum(a) / Math.max(1, a.length);
  return `<main class="plan">
    <section class="pad pad-sage gv" aria-label="全局">
      <div class="pad-hd"><span>all projects · 全局</span><span>${cnd(t)} 到 ${cnd(end)}</span></div>
      <div class="gv-row gv-head"><span></span><div class="gv-axis">${mondays.filter((_, i) => i % Math.max(1, Math.ceil(mondays.length / 6)) === 0 && i > 0 || (i === 0 && X(mondays[0]) > 9)).map(d => `<span style="left:${X(d)}%">${d.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/')}</span>`).join('')}<span class="gv-today" style="left:0">今天</span></div></div>
      ${lanes || `<p class="soft gv-empty">还没有进行中的项目。</p>`}${other}
    </section>
    <section class="pad pad-butter gv-load" aria-label="每天的负荷">
      <div class="pad-hd"><span>load · 每天要做多少</span><button class="mini" type="button" data-act="cap-open">每天能用多少小时</button></div>
      <div class="gv-row"><div class="gv-name"><span class="soft tiny">柱子是引擎照截止日摊到那天的量，细线是那天能用的时间</span></div>
        <div class="gv-curve" style="grid-template-columns:repeat(${span},minmax(0,1fr))">${loads.map(l => `<span class="gv-col${l.cap > 0 && l.need > l.cap + 0.25 ? ' tight' : ''}${l.cap <= 0 ? ' off' : ''}" style="--h:${l.need / top * 100}%;--cap:${l.cap / top * 100}%;--in:${l.need > 0 ? Math.min(100, l.cap / l.need * 100) : 100}%" title="${esc(`${cnd(l.d)}：要 ${fmtH(l.need)}，能用 ${fmtH(l.cap)}`)}"></span>`).join('')}</div></div>
      <div class="gv-outs">
        ${crowded.length ? crowded.slice(0, 4).map(c => `<div class="gv-out">
          <p><b>${cnd(c.from)}${c.from !== c.to ? ' – ' + cnd(c.to) : ''}</b> 比较挤：平均每天要 ${fmtH(avg(c.need))}，能用 ${fmtH(avg(c.cap))}。</p>
          <div class="acts"><button class="mini signal" type="button" data-act="give" data-from="${c.from}" data-to="${c.to}">${c.need.length > 1 ? `这 ${c.need.length} 天每天多给 1 小时` : '这天多给 1 小时'}</button><button class="mini" type="button" data-act="layer" data-layer="week">去本周挪一挪</button></div>
        </div>`).join('') + `<p class="soft tiny">也可以在右边项目里点开不必做的事，选"不做了"。</p>` : `<p class="soft">接下来每天要做的，都在能用的时间里。</p>`}
      </div>
    </section>
  </main>`;
}

function capView() {
  if (ui.sheet !== 'cap') return '';
  return `<div class="scrim" data-act="close"></div>
  <div class="sheet top" role="dialog" aria-modal="true" aria-label="每天能用多少小时">
    <header><h2>平常每天能用多少小时</h2><button class="x" type="button" data-act="close" aria-label="关闭">×</button></header>
    <form class="edit" data-form="cap">
      <div class="cap-grid">${WD.map((w, i) => `<label class="fld"><span>${w}</span><input id="cap-${i}" name="c${i}" type="number" min="0" max="24" step="0.5" inputmode="decimal" value="${esc(ui.draft['c' + i])}"></label>`).join('')}</div>
      <p class="soft tiny">这是平常能拿来做事的时间，引擎按它把各个项目摊到每一天。哪天特别，就在"本周"里那天单独加减。</p>
      <div class="acts"><button class="btn primary" type="submit">保存</button><button class="btn" type="button" data-act="close">取消</button></div>
    </form>
  </div>`;
}
function saveCap() {
  const main = mainSettings(), prev = main.cap;
  const cap = WD.map((_, i) => Math.max(0, Math.min(24, r2(Number(ui.draft['c' + i]) || 0))));
  S.put('settings', 'main', { ...main, cap });
  ui.sheet = null;
  say('每天能用的时间改好了', () => S.put('settings', 'main', { ...mainSettings(), cap: prev }));
}

/* ---------- project layer: module › task › step › smaller step ---------- */
/** A task getting its first step: from now on its time is the steps' time. Returns how to undo that. */
function becomeHolder(pid: string) {
  const it = raw(pid);
  if (!it || kidsOf(pid).length || !(Number(it.hours) > 0 || Number(it.est) > 0)) return () => {};
  const prev = { hours: it.hours, est: it.est };
  patch(pid, { hours: 0, est: 0 });
  return () => patch(pid, prev);
}
function addSub(parentId: string, moduleId: string) {
  const eng = createEngine(view(), T());
  const q = parseQuick(ui.subText, eng);
  if (!q.title || !ui.pid) return;
  const up = parentId && raw(parentId) ? raw(parentId) : null;
  const order = Math.max(0, ...Object.values(S.data.items).map(x => Number(x.order) || 0)) + 1;
  const holderHad = up ? Number(up.hours) || 0 : 0;
  const undoHolder = up ? becomeHolder(parentId) : () => {};
  const id = uid('i');
  S.put('items', id, { kind: 'task', title: q.title, date: null, time: '', end: '', hours: q.hours, est: q.hours, done: false, doneOn: null, project: ui.pid, module: up ? (up.module || '') : moduleId, parent: up ? parentId : '', tags: [], note: '', order, log: {}, actual: null });
  if (up?.done) patch(parentId, { done: false, doneOn: null });
  ui.subText = ''; ui.focusSub = true;
  const switched = up && holderHad > 0 && !kidsOf(parentId).some(k => k !== id);
  say(`记下了「${q.title}」${switched ? `，「${up!.title}」的时间改成按小步加起来算` : ''}`, () => { S.put('items', id, null); undoHolder(); });
}
const folded = (key: string, byDefault: boolean) => ui.fold.has(key) ? !byDefault : byDefault;
function foldBtn(key: string, open: boolean, label: string) {
  return `<button class="pj-fold" type="button" data-act="fold" data-key="${esc(key)}" data-def="${open ? 0 : 1}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'}：${esc(label)}"><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 2.5 7.5 6 4 9.5"/></svg></button>`;
}
function addForm(parentId: string, moduleId: string, step: boolean) {
  return `<form class="pj-add" data-form="sub" data-parent="${esc(parentId)}" data-module="${esc(moduleId)}">
    <input id="sub-input" type="text" autocomplete="off" maxlength="200" value="${esc(ui.subText)}" placeholder="${step ? '拆一小步，比如：先把题号分好 15m' : '加一件事，比如：FI 错题重做 1h'}" aria-label="${step ? '加一小步' : '加一件事'}">
    <button class="mini signal" type="submit">记下</button><button class="mini ghost" type="button" data-act="sub-cancel">好了</button>
  </form>`;
}
function nodeView(n: TreeNode, t: string): string {
  const it = n.item, kids = n.children.filter(k => ui.showDone || k.open > 0);
  if (!ui.showDone && n.open === 0) return '';
  const holder = n.children.length > 0, open = holder && (!folded(it.id, false) || ui.addUnder === it.id);
  const steps = n.total - 1, stepsDone = steps - (n.open - (it.done ? 0 : 1));
  const when = it.date ? (it.done ? '' : it.date < t ? `原来排在 ${cnd(it.date)}` : it.date === t ? '今天' : dayL(it.date)) : '';
  const meta = [holder ? `${stepsDone}/${steps} 步` : '', !it.done && (holder ? n.hours : it.hours) > 0.001 ? (holder ? `还剩 ${fmtH(n.hours)}` : fmtH(it.hours)) : '', when].filter(Boolean).join(' · ');
  const later = !it.done && (!it.date || it.date < t);
  return `<li class="pj-node d${n.depth}${it.done ? ' done' : ''}">
    <div class="pj-row"${!it.done && !holder ? ` draggable="true" data-drag="${it.id}"` : ''}>
      ${holder ? foldBtn(it.id, open, it.title) : '<span class="pj-gap"></span>'}
      <button class="mark${it.done ? ' o' : ''}" type="button" data-act="done" data-id="${it.id}" aria-label="${it.done ? '标成没做完' : '标成做完'}：${esc(it.title)}">${it.done ? 'O' : ''}</button>
      <div class="pj-t"><button class="ed" type="button" data-act="edit" data-id="${it.id}">${esc(it.title)}</button>${meta ? `<small class="mono">${esc(meta)}</small>` : ''}</div>
      <div class="pj-a">
        ${later && !holder ? `<button class="mini signal" type="button" data-act="today" data-id="${it.id}">放到今天</button>` : ''}
        ${n.depth < MAX_DEPTH && !it.done ? `<button class="mini" type="button" data-act="sub" data-id="${it.id}" aria-label="在「${esc(it.title)}」下面拆一小步">+</button>` : ''}
      </div>
    </div>
    ${ui.addUnder === it.id ? addForm(it.id, '', true) : ''}
    ${holder && open && kids.length ? `<ul class="pj-kids">${kids.map(k => nodeView(k, t)).join('')}</ul>` : ''}
  </li>`;
}
function projectView(eng: Engine) {
  const t = T(), dv = eng.derive();
  const projs = [...dv.projects].sort((a, b) => Number(a.deadline < t) - Number(b.deadline < t) || a.deadline.localeCompare(b.deadline));
  if (!projs.length) return `<main class="plan"><section class="pad pad-lilac pj"><div class="pad-hd"><span>project</span><span></span></div><p class="soft pj-empty">还没有项目。</p></section></main>`;
  const p = projs.find(x => x.id === ui.pid) || projs[0];
  ui.pid = p.id;
  const st = eng.projStatus(p), w = calm(st), c = p.color || LOOSE_COLOR;
  const groups = projectTree(p, dv.items, parentOf);
  const spent = investedByProject(sessionsWithLogs(view()))[p.id] || 0;
  const isExam = dv.items.some(x => x.kind === 'exam' && x.date === p.deadline);
  const left = diff(t, p.deadline);
  const open = sum(groups.map(g => g.open)), total = sum(groups.map(g => g.total));
  return `<main class="plan">
    <nav class="pj-tabs" aria-label="选项目">${projs.map(x => `<button type="button" data-act="proj" data-pid="${x.id}"${x.id === p.id ? ' aria-current="page"' : ''}><i style="background:${esc(x.color || LOOSE_COLOR)}"></i>${esc(x.name)}</button>`).join('')}</nav>
    <section class="pad pad-lilac pj" aria-label="${esc(p.name)}">
      <div class="pad-hd"><span>project · <b class="pj-name">${esc(p.name)}</b></span><span>${cnd(p.deadline)}${isExam ? '考试' : '截止'}${left >= 0 ? ` · 还有 ${left} 天` : ''}</span></div>
      <div class="pj-top">
        <div class="pj-sum">${w.label ? `<span class="pill ${w.k}">${esc(w.label)}</span>` : ''}<span class="soft">${total ? `${open} 件没做，共 ${total} 件` : '还没有事'}${st.rem > 0.01 && !st.cnt ? ` · 还剩 ${fmtH(st.rem)}` : ''}${spent > 0.01 ? ` · 已投入 ${fmtH(spent)}` : ''}</span></div>
        ${st.cnt ? '' : projectRunway(spent, st.rem, c)}
        <label class="pj-toggle"><input type="checkbox" data-act="show-done"${ui.showDone ? ' checked' : ''}> 显示做完的</label>
      </div>
      ${groups.map(g => {
        const key = 'm:' + g.id, isOpen = !folded(key, g.open === 0 && !ui.showDone) || ui.addUnder === key;
        const nodes = g.nodes.filter(n => ui.showDone || n.open > 0);
        const info = g.open ? `${g.open} 件没做${g.hours > 0.01 ? ` · 还剩 ${fmtH(g.hours)}` : ''}` : g.total ? '都做完了' : '还没有事';
        return `<section class="pj-mod${g.open ? '' : ' quiet'}">
          <header class="pj-mhd">${foldBtn(key, isOpen, g.name)}<b>${esc(g.name)}</b><span class="soft tiny">${info}${g.due ? ` · ${cnd(g.due)}前` : ''}</span><button class="mini" type="button" data-act="sub" data-id="${esc(key)}">+ 任务</button></header>
          ${ui.addUnder === key ? addForm('', g.id, false) : ''}
          ${isOpen ? (nodes.length ? `<ul class="pj-tree">${nodes.map(n => nodeView(n, t)).join('')}</ul>` : g.total ? `<p class="pj-none">都做完了。想看就打开"显示做完的"。</p>` : `<p class="pj-none">还没有事，点"+ 任务"加一件。</p>`) : ''}
        </section>`; }).join('')}
    </section>
  </main>`;
}
/** Tasks this one can sit under: same project, not itself or its own steps, and not already at the deepest level. */
function parentField(eng: Engine, id: string, project: string, current: string) {
  const p = project ? eng.derive().projMap.get(project) : null;
  if (!p) return '';
  const below = new Set(descendants(id, Object.keys(S.data.items).map(k => ({ id: k })), parentOf));
  const groups = projectTree(p, eng.derive().items, parentOf);
  const opts = (n: TreeNode): string => n.item.id === id || below.has(n.item.id) || n.depth >= MAX_DEPTH ? '' :
    `<option value="${esc(n.item.id)}"${n.item.id === current ? ' selected' : ''}>${'　'.repeat(n.depth - 1)}${esc(n.item.title)}${n.item.done ? '（做完了）' : ''}</option>` + n.children.map(opts).join('');
  return `<label class="fld"><span>放在哪件事下面</span><select id="ed-parent" name="parent">
    <option value=""${current ? '' : ' selected'}>不放，自己就是一件事</option>
    ${groups.map(g => { const o = g.nodes.map(opts).join(''); return o ? `<optgroup label="${esc(g.name)}">${o}</optgroup>` : ''; }).join('')}
  </select></label>`;
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
  const typing = !!active?.id && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && root.contains(active);
  let caret: number | null = null;
  try { caret = typing ? (active as HTMLInputElement).selectionStart : null; } catch { caret = null; }
  const eng = createEngine(view(), T());
  const y = window.scrollY;
  const dScroll = (root.querySelector('.groups') as HTMLElement | null)?.scrollTop ?? 0;
  if (S.mode === 'loading') { root.innerHTML = `<p class="loading">正在读取你的数据…</p>`; return; }
  const main = ui.layer === 'week' ? weekView(eng) : ui.layer === 'global' ? globalView(eng) : ui.layer === 'project' ? projectView(eng) : today(eng);
  const body = isEmpty() && !ui.started && S.mode === 'live' ? emptyView() : `<div class="cols">${main}${drawerView(eng)}</div>`;
  root.innerHTML = `${header()}${body}${pickerView(eng)}${dataSheet()}${editView(eng)}${wrapView(eng)}${capView()}${toastView()}`;
  window.scrollTo(0, y);
  const g = root.querySelector('.groups') as HTMLElement | null; if (g) g.scrollTop = dScroll;
  if (typing) { const q = document.getElementById(active!.id) as HTMLInputElement | null; if (q) { q.focus(); try { if (caret != null) q.setSelectionRange(caret, caret); } catch { /* not a text field */ } } }
  else if (ui.focusSub) document.getElementById('sub-input')?.focus();
  ui.focusSub = false;
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
let lastMinute = new Date().getMinutes();
setInterval(() => {
  tick();
  if (ui.toast && Date.now() - ui.toast.at > 5000 && root.querySelector('.toast')) { ui.toast = null; render(); return; }
  // once a minute: the now line moves and a running timer's segment grows
  const m = new Date().getMinutes();
  if (m !== lastMinute) { lastMinute = m; if (!(document.activeElement as HTMLElement | null)?.closest('input')) render(); }
}, 1000);

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
    case 'edit': ui.picker = null; openEdit(id!); break;
    case 'wrap': ui.sheet = 'wrap'; break;
    case 'drop': drop(id!); if (ui.sheet === 'edit') { ui.sheet = null; ui.editId = ''; } break;
    case 'tmrw': moveTo(id!, add(T(), 1), `「${title}」挪到明天了`); break;
    case 'back': ui.picker = null; if (ui.timer?.id === id) plant(); moveTo(id!, null, `「${title}」放回项目了`); break;
    case 'pick': ui.picker = id!; break;
    case 'assign': ui.picker = null; moveTo(id!, day!, `「${title}」排到${day === T() ? '今天' : dayL(day!)}`); break;
    case 'close': ui.picker = null; if (!ui.busy) { ui.sheet = null; ui.pending = null; ui.editId = ''; } break;
    case 'undo': ui.toast?.undo?.(); ui.toast = null; break;
    case 'layer': ui.layer = el.dataset.layer as typeof ui.layer; ui.sheet = null; window.scrollTo(0, 0); render(); window.scrollTo(0, 0); return;
    case 'proj': ui.layer = 'project'; ui.pid = pid!; ui.addUnder = ''; ui.sheet = null; ui.drawerOpen = false; render(); window.scrollTo(0, 0); return;
    case 'fold': { const k = el.dataset.key!; if (ui.fold.has(k)) ui.fold.delete(k); else ui.fold.add(k); break; }
    case 'sub': {
      ui.addUnder = ui.addUnder === id ? '' : id!; ui.subText = ''; ui.focusSub = !!ui.addUnder;
      break;
    }
    case 'sub-cancel': ui.addUnder = ''; ui.subText = ''; break;
    case 'show-done': ui.showDone = (el as HTMLInputElement).checked; ui.fold.clear(); break;
    case 'wk': ui.weekOff = Number(el.dataset.step) ? ui.weekOff + Number(el.dataset.step) : 0; break;
    case 'cap-day': { const by = Number(el.dataset.by); setDays([day!], c => c + by, `${cnd(day!)}能用的时间${by > 0 ? '多了' : '少了'} 1 小时`); break; }
    case 'give': { const days = range(el.dataset.from!, el.dataset.to!).filter(d => eng.capOf(d) > 0); setDays(days, c => c + 1, `${days.length} 天每天多给了 1 小时`); break; }
    case 'cap-open': ui.sheet = 'cap'; ui.draft = Object.fromEntries(WD.map((_, i) => ['c' + i, String(Number(eng.settings.cap[i]) || 0)])); break;
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
root.addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.act === 'file') readFile(t);
  if (t.id === 'ed-project' && ui.sheet === 'edit') { ui.draft.project = t.value; ui.draft.parent = ''; render(); }
  if (t.id === 'comment' || t.id === 'wrap-comment') { const d = T(), v = t.value.trim(), old = S.data.notes[d]; if (v !== String(old?.text || '').split('\n')[0]) S.put('notes', d, v ? { ...(old || {}), text: v } : null); }
});
root.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.closest('[data-form="edit"], [data-form="cap"]') && t.name) ui.draft[t.name] = t.value; if (t.id === 'sub-input') ui.subText = t.value; if (t.id === 'quick-input') { ui.quick = t.value; const hint = root.querySelector('.quick-row .soft'); if (hint) { const q = ui.quick.trim() ? parseQuick(ui.quick, createEngine(view(), T())) : null; const h = q && q.title ? [q.project ? nameOf(createEngine(view(), T()), q.project) : '', q.hours ? fmtH(q.hours) : ''].filter(Boolean).join(' · ') : ''; hint.textContent = h ? '会记成：' + h : '可以加 #项目 和时长'; } } });
root.addEventListener('submit', e => { e.preventDefault(); const f = (e.target as HTMLElement).dataset.form; if (f === 'quick') { addQuick(createEngine(view(), T()), false); render(); } if (f === 'edit') { saveEdit(); render(); } if (f === 'cap') { saveCap(); render(); } if (f === 'sub') { const fe = e.target as HTMLElement; addSub(fe.dataset.parent || '', fe.dataset.module || ''); render(); } });

/* drag a task to another day, or onto the project drawer to put it back */
let dragId = '';
root.addEventListener('dragstart', e => {
  const el = (e.target as HTMLElement).closest('[data-drag]') as HTMLElement | null; if (!el) return;
  dragId = el.dataset.drag!;
  e.dataTransfer?.setData('text/plain', dragId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  el.classList.add('dragging');
});
root.addEventListener('dragover', e => {
  const z = (e.target as HTMLElement).closest('[data-drop]') as HTMLElement | null; if (!z || !dragId) return;
  e.preventDefault();
  root.querySelectorAll('.hot').forEach(x => x !== z && x.classList.remove('hot'));
  z.classList.add('hot');
});
root.addEventListener('drop', e => {
  const z = (e.target as HTMLElement).closest('[data-drop]') as HTMLElement | null;
  const id = dragId || e.dataTransfer?.getData('text/plain') || ''; dragId = '';
  if (!z || !id || !raw(id)) return;
  e.preventDefault();
  const to = z.dataset.drop === 'pool' ? null : z.dataset.drop!;
  if ((raw(id).date ?? null) === to) { render(); return; }
  if (!to && ui.timer?.id === id) plant();
  moveTo(id, to, to ? `「${raw(id).title}」排到${to === T() ? '今天' : dayL(to)}` : `「${raw(id).title}」放回项目了`);
  render();
});
root.addEventListener('dragend', () => { dragId = ''; root.querySelectorAll('.hot,.dragging').forEach(x => x.classList.remove('hot', 'dragging')); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.addUnder && !ui.sheet) { ui.addUnder = ''; ui.subText = ''; render(); return; } if (e.key === 'Escape' && (ui.picker || ui.sheet)) { ui.picker = null; if (!ui.busy) { ui.sheet = null; ui.pending = null; ui.editId = ''; } render(); } });

/* ---------- start ---------- */
toFloat = startBridge(S, T);
render();
S.connect().then(async () => {
  if (S.mode === 'memory') await S.replaceAll(seed(T()), () => {});
  render();
});
