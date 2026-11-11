// Bridge for the Mac float window (Runway Float). It only runs inside the app's hidden web view, where
// window.webkit.messageHandlers.runway exists; in a normal browser it does nothing.
// The protocol is the old Runway page's, unchanged, so the same float app works with either page:
//   page → app: a JSON state every few seconds (today's list, earlier leftovers, spiral timer, next exam)
//   app → page: window.runwayCmd({op, ...}) for ticks, adds, moves and the timers.
// What is new: focus time from the float's "do" stretches and block timer becomes sessions, so it lights lamps.
import { add, calSync, createEngine, diff, pickOrder, r2 } from '../engine/src';
import type { createStore } from './store';
import { countTargets, countTo } from './count';

declare const __SHARE__: boolean;

type Store = ReturnType<typeof createStore>;
const A_MIN = [10, 20, 30, 40, 45], B_MIN = [10, 15];
export const blockMin = (i: number) => i % 2 === 0 ? A_MIN[Math.min(i / 2, A_MIN.length - 1)] : B_MIN[Math.min((i - 1) / 2, B_MIN.length - 1)];
export const isA = (i: number) => i % 2 === 0;
/** Time worked past the bell counts, up to this much: a timer left running while away adds at most an hour. */
export const OVER_MAX_MS = 3600e3;
const pad = (n: number) => String(n).padStart(2, '0');
const hm2m = (h: string) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
const uid = (p: string) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function startBridge(S: Store, today: () => string) {
  const NB = (window as any).webkit?.messageHandlers?.runway;
  if (!NB) return () => {};
  // from here on the page is inside Runway Float
  const D = S.data;
  const ui = { spin: false };

  const all = (): any[] => Object.entries(D.items).map(([id, x]) => ({ id, ...x }));
  const hrs = (x: any) => +x.est || +x.hours || 0;
  const isTask = (x: any) => (x.kind || 'task') === 'task' && !x.old && !(x.note || '').startsWith('砍掉');
  const set = () => D.settings.main || {};
  /** The data without items hidden away as old, the way the page plans with it. */
  const live = () => ({ ...D, items: Object.fromEntries(Object.entries(D.items).filter(([, x]) => !x.old)) });
  const examOn = () => !!set().examMode;
  // times before 05:00 belong to the night of the same day, so they sort after the evening
  const tkey = (h: string) => !h ? '9' : h < '05:00' ? '2' + h : '1' + h;
  const byOrder = (a: any, b: any) => tkey(a.time || '').localeCompare(tkey(b.time || '')) || (a.order || 0) - (b.order || 0);
  const todayA = () => { const t = today(); return all().filter(x => isTask(x) && x.date === t && (!x.done || x.doneOn === t)).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || byOrder(a, b)); };
  const todayBlocks = () => { const t = today(); return all().filter(x => isTask(x) && x.date === t && (!x.done || x.doneOn === t)).sort(byOrder); };
  const overdue = () => { const t = today(); return all().filter(x => isTask(x) && !x.done && x.date && x.date < t).sort((a, b) => b.date.localeCompare(a.date)); };
  const Bs = (): string[] => Array.isArray(D.spiral.b?.list) ? D.spiral.b.list : [];
  function spiralState() { let s = D.spiral.state; if (!s || s.date !== today()) s = { date: today(), idx: 0, endsAt: null, left: blockMin(0) * 60, bi: 0, acc: 0, runFrom: null }; return s; }
  const leftSec = (s: any) => s.endsAt ? Math.round((s.endsAt - Date.now()) / 1000) : s.left;
  function blockState() { const b = D.spiral.block; return b && b.date === today() && b.id ? b : null; }
  function blockSecs(x: any) { if (x.time && x.end) { const d = hm2m(x.end) - hm2m(x.time); if (d > 0) return d * 60; } return Math.round((hrs(x) || 1) * 3600); }
  const blockLeft = (b: any) => b.endsAt ? Math.round((b.endsAt - Date.now()) / 1000) : b.left;
  /** Today's open tasks in the order the page's "now" card offers them, so the float and the page agree. */
  const byNow = (): any[] => {
    const d = new Date(), ok = new Set(todayA().filter(x => !x.done).map(x => x.id));
    return pickOrder(createEngine(live(), today()), d.getHours() * 60 + d.getMinutes()).filter(i => ok.has(i.id)).map(i => ({ id: i.id, ...D.items[i.id] }));
  };
  function currentBlock() {
    const b = blockState();
    if (b && D.items[b.id] && !D.items[b.id].done && !D.items[b.id].old) return { id: b.id, ...D.items[b.id] };
    return byNow()[0] || null;
  }
  // the page header counts down to the nearest exam, so the float starts there too
  function nextExam() { const t = today(); return all().filter(x => x.kind === 'exam' && x.date >= t && !x.done && !x.old).sort((a, b) => a.date.localeCompare(b.date))[0]; }

  /** Focus time as a session, logged on the task the old way too so the old Runway would still see it. */
  function logFocus(itemId: string | null, secs: number, startedAt: number) {
    if (secs < 30) return;
    const t = today(), mins = Math.max(1, Math.round(secs / 60)), it = itemId ? D.items[itemId] : null;
    const st = new Date(startedAt);
    S.addSession(uid('s'), { date: t, item: itemId || '', project: it?.project || '', start: `${pad(st.getHours())}:${pad(st.getMinutes())}`, mins });
    if (it) S.put('items', itemId!, { ...it, log: { ...(it.log || {}), [t]: r2((Number(it.log?.[t]) || 0) + mins / 60) } });
  }
  /** Seconds the current "do" stretch has run so far, including earlier runs before a pause. */
  const runSecs = (s: any) => (s.acc || 0) + (s.runFrom ? Math.max(0, Math.round((Math.min(Date.now(), s.endsAt ? s.endsAt + OVER_MAX_MS : Date.now()) - s.runFrom) / 1000)) : 0);
  /** What to do now: last night's pick for today if there is one, else the first in the page's order (engine pickOrder). */
  const firstOpen = () => {
    const open = byNow();
    const f = set().first; if (f && f.date === today() && open.some(x => x.id === f.id)) return f.id;
    return open[0]?.id || null;
  };

  /** The task the running stretch is on: the one the page or float started it on while it is still open, else the one by the clock. */
  const activeItem = (s: any) => { const x = s.item && D.items[s.item]; return x && !x.done && !x.old ? s.item : firstOpen(); };

  function post() {
    if (S.mode !== 'live' && S.mode !== 'local' && S.mode !== 'memory') return;
    try {
      const t = today(), s = spiralState(), ex = nextExam();
      // a bad day on the page: the float shows only the one small thing, or that today is a rest day
      const lw = set().low && set().low.date === t ? set().low : null;
      const lowKeep = (x: any) => !lw || x.done || (lw.kind === 'small' && x.id === lw.id);
      const lowNow = lw ? (lw.kind === 'small' && D.items[lw.id] && !D.items[lw.id].done ? lw.id : null) : undefined;
      NB.postMessage(JSON.stringify({
        today: t, nick: set().nick || (__SHARE__ ? '' : 'Yan'), local: S.mode !== 'live',
        acc: ({ blue: ['#1F3BE0', '#7B8CFF'], orange: ['#E2541C', '#FF7A45'], green: ['#11704F', '#4FD19A'], rose: ['#C42A5A', '#FF7AA3'] } as Record<string, string[]>)[set().mzAcc || 'blue'] || ['#1F3BE0', '#7B8CFF'],
        mode: examOn() && !ui.spin ? 'exam' : 'spiral',
        examMode: examOn(),
        exam: ex ? { title: ex.title || '', days: diff(t, ex.date) } : null,
        targets: countTargets(D.items, D.projects, t).slice(0, 20).map(x => ({ id: x.id, title: x.title, days: diff(t, x.date) })),
        count: (() => { const c = countTo(D.items, D.projects, set(), t); return c ? { id: c.id, title: c.title, short: c.label, days: diff(t, c.date) } : null; })(),
        spiral: { idx: s.idx || 0, endsAt: s.endsAt || null, left: s.left ?? blockMin(s.idx || 0) * 60, bi: s.bi || 0 },
        block: (() => { const x: any = currentBlock(); if (!x) return null; const b = blockState(), mine = b && b.id === x.id, total = mine ? b.total : blockSecs(x);
          return { id: x.id, title: x.title || '', time: x.time || '', end: x.end || '', note: (x.note || '').split('\n')[0].slice(0, 60), total, left: mine ? Math.max(-5999, blockLeft(b)) : total, endsAt: mine ? (b.endsAt || null) : null }; })(),
        b: Bs(),
        now: lowNow !== undefined ? lowNow : activeItem(s),
        // the next two weeks for the float to write into Apple Calendar
        ...(S.mode === 'live' ? (() => { const c = calSync(createEngine(live(), t), 14); return { cal: c.events, todo: c.tasks }; })() : { cal: null, todo: null }),
        low: lw ? { kind: lw.kind, text: lw.kind === 'rest' ? '今天歇着，没做的事收工时再说' : '状态差 · 只做这一件，别的先收起来' } : null,
        tasks: (examOn() ? todayBlocks() : todayA()).filter(lowKeep).map(x => ({ id: x.id, title: x.title || '', done: !!x.done, time: x.time || '', end: x.end || '' })),
        overdue: overdue().slice(0, 15).map(x => ({ id: x.id, title: x.title || '', done: false, time: '', end: '' })),
      }));
    } catch { /* the float simply keeps its last state */ }
  }

  const putItem = (id: string, patch: Record<string, any>) => { if (D.items[id]) S.put('items', id, { ...D.items[id], ...patch }); };
  const mv = (id: string, date: string | null) => putItem(id, { date, time: '', end: '' });
  const setSpiral = (id: string, body: Record<string, any>) => S.put('spiral', id, body);
  const newTask = (title: string) => ({ kind: 'task', title, date: today(), done: false, doneOn: null, project: '', module: '', note: '', tags: [], time: '', end: '', est: 0, hours: 0, order: Math.max(0, ...all().map(x => x.order || 0)) + 1, log: {}, actual: null });

  (window as any).runwayCmd = (c: any) => {
    try {
      const t = today(), s = spiralState(), id = c.id;
      switch (c.op) {
        // ticked or unticked in Apple Reminders
        case 'setDone': { const x = D.items[id]; if (x && !x.old && !!x.done !== !!c.done) putItem(id, { done: !!c.done, doneOn: c.done ? (x.date && x.date <= t ? x.date : t) : null }); break; }
        case 'toggle': { const x = D.items[id]; if (x) { const now = !x.done; putItem(id, { done: now, doneOn: now ? t : null }); } break; }
        case 'add': { const v = String(c.title || '').trim(); if (v) S.put('items', uid('i'), newTask(v)); break; }
        case 'tmr': mv(id, add(t, 1)); break;
        case 'toToday': mv(id, t); break;
        case 'extraTmr': todayA().filter(x => !x.done).slice(3).forEach(x => mv(x.id, add(t, 1))); break;
        case 'clearOver': overdue().forEach(x => mv(x.id, null)); break;
        case 'addB': { const v = String(c.title || '').trim(); if (v) setSpiral('b', { list: [...Bs(), v] }); break; }
        case 'delB': { const l = Bs().slice(); l.splice(+c.i, 1); setSpiral('b', { list: l }); break; }
        case 'start': setSpiral('state', { ...s, endsAt: Date.now() + leftSec(s) * 1000, runFrom: isA(s.idx || 0) ? Date.now() : null, item: isA(s.idx || 0) ? activeItem(s) : s.item || null, total: s.total || blockMin(s.idx || 0) * 60, rang: false }); break;
        case 'pause': setSpiral('state', { ...s, left: Math.max(0, leftSec(s)), endsAt: null, acc: isA(s.idx || 0) ? runSecs(s) : 0, runFrom: null }); break;
        case 'next': {
          if (isA(s.idx || 0)) logFocus(activeItem(s), runSecs(s), s.runFrom || Date.now());
          const i = (s.idx || 0) + 1;
          setSpiral('state', { ...s, idx: i, endsAt: Date.now() + blockMin(i) * 60000, left: blockMin(i) * 60, bi: (s.bi || 0) + (isA(s.idx || 0) ? 0 : 1), acc: 0, runFrom: isA(i) ? Date.now() : null, item: isA(i) ? activeItem(s) : s.item || null, kind: null, total: blockMin(i) * 60, rang: false });
          break;
        }
        // tick off what is being done now; the stretch so far is its focus time, and the clock keeps going for the next one
        case 'doneNow': {
          const x = D.items[id]; if (!x || x.done) break;
          if (isA(s.idx || 0)) logFocus(id, runSecs(s), s.runFrom || Date.now());
          putItem(id, { done: true, doneOn: t });
          if (isA(s.idx || 0)) setSpiral('state', { ...s, acc: 0, runFrom: s.endsAt ? Date.now() : null, item: firstOpen() });
          break;
        }
        case 'more10': setSpiral('state', { ...s, acc: isA(s.idx || 0) ? runSecs(s) : 0, runFrom: isA(s.idx || 0) ? Date.now() : null, endsAt: Date.now() + 600000, total: (isA(s.idx || 0) ? runSecs(s) : 0) + 600, item: isA(s.idx || 0) ? activeItem(s) : s.item || null, rang: false }); break;
        case 'swapB': setSpiral('state', { ...s, bi: (s.bi || 0) + 1 }); break;
        case 'countTo': S.put('settings', 'main', { ...set(), countTo: String(c.id || ''), countName: '' }); break;
        case 'reset': setSpiral('state', { date: t, idx: 0, endsAt: null, left: blockMin(0) * 60, bi: s.bi || 0, acc: 0, runFrom: null, item: null }); break;
        case 'spin': ui.spin = true; break;
        case 'unspin': ui.spin = false; break;
        case 'bStart': {
          const b = blockState(), x = D.items[id]; if (!x) break;
          if (b && b.id === id) { if (!b.endsAt) setSpiral('block', { ...b, endsAt: Date.now() + Math.max(60, b.left) * 1000, runFrom: Date.now(), rang: false }); }
          else { const total = blockSecs(x); setSpiral('block', { date: t, id, total, left: total, endsAt: Date.now() + total * 1000, runFrom: Date.now(), acc: 0, rang: false }); }
          break;
        }
        case 'bPause': { const b = blockState(); if (b) setSpiral('block', { ...b, left: Math.max(0, blockLeft(b)), endsAt: null, acc: runSecs(b), runFrom: null }); break; }
        case 'bMore': { const b = blockState(); if (b) { const base = b.endsAt ? Math.max(Date.now(), b.endsAt) : null; setSpiral('block', { ...b, total: b.total + 900, left: (b.left || 0) + (base ? 0 : 900), endsAt: base ? base + 900000 : null, rang: false }); } break; }
        case 'bDone': {
          const b = blockState(), x = D.items[id]; if (!x) break;
          const patch: Record<string, any> = { done: true, doneOn: t };
          if (b && b.id === id) {
            const secs = runSecs({ ...b, endsAt: null });
            if (secs >= 30) logFocus(id, secs, b.runFrom || Date.now()); else patch.actual = Math.round((b.total - Math.max(0, blockLeft(b))) / 360) / 10 || null;
          }
          putItem(id, patch);
          setSpiral('block', { date: t, id: null });
          break;
        }
      }
    } catch { /* ignore a bad command */ }
    setTimeout(post, 30);
  };

  setInterval(post, 4000);
  return post;
}
