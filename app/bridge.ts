// Bridge for the Mac float window (Runway Float). It only runs inside the app's hidden web view, where
// window.webkit.messageHandlers.runway exists; in a normal browser it does nothing.
// The protocol is the old Runway page's, unchanged, so the same float app works with either page:
//   page → app: a JSON state every few seconds (today's list, earlier leftovers, spiral timer, next exam)
//   app → page: window.runwayCmd({op, ...}) for ticks, adds, moves and the timers.
// What is new: focus time from the float's "do" stretches and block timer becomes sessions, so it lights lamps.
import { add, diff, r2 } from '../engine/src';
import type { createStore } from './store';

type Store = ReturnType<typeof createStore>;
const A_MIN = [10, 20, 30, 40, 45], B_MIN = [10, 15];
const blockMin = (i: number) => i % 2 === 0 ? A_MIN[Math.min(i / 2, A_MIN.length - 1)] : B_MIN[Math.min((i - 1) / 2, B_MIN.length - 1)];
const isA = (i: number) => i % 2 === 0;
const pad = (n: number) => String(n).padStart(2, '0');
const hm2m = (h: string) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
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
  function currentBlock() {
    const b = blockState(), open = todayBlocks().filter(x => !x.done);
    if (b && D.items[b.id] && !D.items[b.id].done && !D.items[b.id].old) return { id: b.id, ...D.items[b.id] };
    const t = nowHM();
    return open.find(x => x.time && x.end && x.time <= t && t < x.end) || open.find(x => !x.time || x.time >= t) || open[0] || null;
  }
  function nextExam() { const t = today(); return all().filter(x => (x.kind === 'exam' || x.kind === 'deadline') && x.date >= t && !x.done).sort((a, b) => a.date.localeCompare(b.date))[0]; }

  /** Focus time as a session, logged on the task the old way too so the old Runway would still see it. */
  function logFocus(itemId: string | null, secs: number, startedAt: number) {
    if (secs < 30) return;
    const t = today(), mins = Math.max(1, Math.round(secs / 60)), it = itemId ? D.items[itemId] : null;
    const st = new Date(startedAt);
    S.addSession(uid('s'), { date: t, item: itemId || '', project: it?.project || '', start: `${pad(st.getHours())}:${pad(st.getMinutes())}`, mins });
    if (it) S.put('items', itemId!, { ...it, log: { ...(it.log || {}), [t]: r2((Number(it.log?.[t]) || 0) + mins / 60) } });
  }
  /** Seconds the current "do" stretch has run so far, including earlier runs before a pause. */
  const runSecs = (s: any) => (s.acc || 0) + (s.runFrom ? Math.max(0, Math.round((Math.min(Date.now(), s.endsAt || Date.now()) - s.runFrom) / 1000)) : 0);
  /** What to do now: the task whose slot is running, else the next one by the clock, else one without a time, else the first. */
  const firstOpen = () => {
    const open = todayA().filter(x => !x.done), now = tkey(nowHM());
    const hit = open.find(x => x.time && x.end && tkey(x.time) <= now && now < tkey(x.end))
      || open.find(x => x.time && tkey(x.time) >= now) || open.find(x => !x.time) || open[0];
    return hit?.id || null;
  };

  function post() {
    if (S.mode !== 'live' && S.mode !== 'memory') return;
    try {
      const t = today(), s = spiralState(), ex = nextExam();
      NB.postMessage(JSON.stringify({
        today: t, nick: set().nick || 'Yan', local: S.mode !== 'live',
        acc: ({ blue: ['#1F3BE0', '#7B8CFF'], orange: ['#E2541C', '#FF7A45'], green: ['#11704F', '#4FD19A'], rose: ['#C42A5A', '#FF7AA3'] } as Record<string, string[]>)[set().mzAcc || 'blue'] || ['#1F3BE0', '#7B8CFF'],
        mode: examOn() && !ui.spin ? 'exam' : 'spiral',
        examMode: examOn(),
        exam: ex ? { title: ex.title || '', days: diff(t, ex.date) } : null,
        targets: [
          ...all().filter(x => (x.kind === 'exam' || x.kind === 'deadline') && x.date >= t && !x.done).map(x => ({ id: x.id, title: x.title || '', days: diff(t, x.date) })),
          ...Object.entries(D.projects).filter(([, p]) => p.deadline && p.deadline >= t && !p.archived).map(([id, p]) => ({ id: 'p:' + id, title: (p.name || id) + ' 截止', days: diff(t, p.deadline) })),
        ].sort((a, b) => a.days - b.days).slice(0, 20),
        spiral: { idx: s.idx || 0, endsAt: s.endsAt || null, left: s.left ?? blockMin(s.idx || 0) * 60, bi: s.bi || 0 },
        block: (() => { const x: any = currentBlock(); if (!x) return null; const b = blockState(), mine = b && b.id === x.id, total = mine ? b.total : blockSecs(x);
          return { id: x.id, title: x.title || '', time: x.time || '', end: x.end || '', note: (x.note || '').split('\n')[0].slice(0, 60), total, left: mine ? Math.max(-5999, blockLeft(b)) : total, endsAt: mine ? (b.endsAt || null) : null }; })(),
        b: Bs(),
        now: firstOpen(),
        tasks: (examOn() ? todayBlocks() : todayA()).map(x => ({ id: x.id, title: x.title || '', done: !!x.done, time: x.time || '', end: x.end || '' })),
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
        case 'toggle': { const x = D.items[id]; if (x) { const now = !x.done; putItem(id, { done: now, doneOn: now ? t : null }); } break; }
        case 'add': { const v = String(c.title || '').trim(); if (v) S.put('items', uid('i'), newTask(v)); break; }
        case 'tmr': mv(id, add(t, 1)); break;
        case 'toToday': mv(id, t); break;
        case 'extraTmr': todayA().filter(x => !x.done).slice(3).forEach(x => mv(x.id, add(t, 1))); break;
        case 'clearOver': overdue().forEach(x => mv(x.id, null)); break;
        case 'addB': { const v = String(c.title || '').trim(); if (v) setSpiral('b', { list: [...Bs(), v] }); break; }
        case 'delB': { const l = Bs().slice(); l.splice(+c.i, 1); setSpiral('b', { list: l }); break; }
        case 'start': setSpiral('state', { ...s, endsAt: Date.now() + leftSec(s) * 1000, runFrom: isA(s.idx || 0) ? Date.now() : null, rang: false }); break;
        case 'pause': setSpiral('state', { ...s, left: Math.max(0, leftSec(s)), endsAt: null, acc: isA(s.idx || 0) ? runSecs(s) : 0, runFrom: null }); break;
        case 'next': {
          if (isA(s.idx || 0)) logFocus(firstOpen(), runSecs(s), s.runFrom || Date.now());
          const i = (s.idx || 0) + 1;
          setSpiral('state', { ...s, idx: i, endsAt: Date.now() + blockMin(i) * 60000, left: blockMin(i) * 60, bi: (s.bi || 0) + (isA(s.idx || 0) ? 0 : 1), acc: 0, runFrom: isA(i) ? Date.now() : null, rang: false });
          break;
        }
        case 'more10': setSpiral('state', { ...s, acc: isA(s.idx || 0) ? runSecs(s) : 0, runFrom: isA(s.idx || 0) ? Date.now() : null, endsAt: Date.now() + 600000, rang: false }); break;
        case 'swapB': setSpiral('state', { ...s, bi: (s.bi || 0) + 1 }); break;
        case 'reset': setSpiral('state', { date: t, idx: 0, endsAt: null, left: blockMin(0) * 60, bi: s.bi || 0, acc: 0, runFrom: null }); break;
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
