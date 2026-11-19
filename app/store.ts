// Where the data lives. On claude.ai the page keeps it in its own database (the `db` capability), so the
// phone and the Mac see the same thing. Without it the page still runs, from memory only, and says so.
// The rest of the app only sees `data` and `put`; a local-first backend can replace this file later.
// In the Mac app the page runs from the app itself and has no database of its own: the app keeps the claude.ai
// page open out of sight, and the two pages pass the data back and forth through the app (see serveRelay).
// The share build (__SHARE__) gives every viewer their own copy under data/users/<id>/, and when the
// link cannot write to the database at all it keeps the data in this browser instead.
import type { Store } from '../engine/src';

declare const __SHARE__: boolean;
const LOCAL_KEY = 'runway-share-data';
const REFUSED = new Set(['invalid_argument', 'not_granted', 'capability_disabled', 'capability_removed', 'revoked']);

export type Col = 'items' | 'projects' | 'settings' | 'notes' | 'sessions' | 'spiral';
const COLS: Col[] = ['items', 'projects', 'settings', 'notes', 'sessions', 'spiral'];
type Docs = Record<string, Record<string, any>>;
/** `spiral` holds the Mac float window's spiral timer: docs `state`, `b` (reward list) and `block`. */
export type Data = Required<Store> & { notes: Docs; spiral: Docs };
export type Mode = 'loading' | 'live' | 'local' | 'memory' | 'error';

/** Sessions are kept one document per day: { list: [{id, item, project, start, mins}] }. */
const sessionsToDays = (s: Docs) => {
  const days: Record<string, any[]> = {};
  for (const [id, x] of Object.entries(s)) (days[x.date] ||= []).push({ id, item: x.item || '', project: x.project || '', start: x.start || '', mins: x.mins });
  return days;
};

/** Set in the Mac app's own window: the app forwards to the hidden claude.ai page. */
const appHost = () => (window as any).webkit?.messageHandlers?.runwayApp;
/** Set in the hidden claude.ai page inside the Mac app. */
const relayHost = () => (window as any).webkit?.messageHandlers?.runwayRelay;

export function createStore(onChange: () => void) {
  const data: Data = { items: {}, projects: {}, settings: {}, notes: {}, sessions: {}, spiral: {} };
  let db: any = null;
  let mode: Mode = 'loading';
  let problem = '';
  const chains = new Map<string, Promise<void>>();
  const days: Record<string, Record<string, any>> = {};
  let base: any = null;
  const offs: Array<() => void> = [];
  const colRef = (col: Col) => base ? base.collection(col) : db.collection(col);
  // Mac app window: writes go to the hidden page; its snapshots are the truth, except one sent just before our latest write
  let relay = false, sent = 0, sentAt = 0;
  const send = (c: Record<string, any>) => { sent++; sentAt = Date.now(); appHost().postMessage(JSON.stringify({ ...c, seq: sent })); };

  /** The browser keeps the whole thing as one JSON value; sessions stay in their per-day shape. */
  let saveTimer = 0;
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ items: data.items, projects: data.projects, settings: data.settings, notes: data.notes, spiral: data.spiral, days })); }
      catch { problem = '这台设备的浏览器存不下数据了，有一处改动没存上。先导出一份备份。'; onChange(); }
    }, 300) as unknown as number;
  }
  function goLocal(keep: boolean) {
    offs.splice(0).forEach(f => { try { f(); } catch { /* already closed */ } });
    db = null;
    if (!keep) {
      let saved: any = null;
      try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { saved = null; }
      if (saved) { for (const col of COLS) if (col !== 'sessions') absorb(col, saved[col] || {}); absorb('sessions', saved.days || {}); }
    }
    try { localStorage.setItem(LOCAL_KEY + ':on', '1'); mode = 'local'; saveLocal(); } catch { mode = 'memory'; }
    onChange();
  }

  function absorb(col: Col, docs: Record<string, any>) {
    if (col !== 'sessions') { (data as any)[col] = docs; return; }
    const s: Docs = {};
    for (const k of Object.keys(days)) delete days[k];
    for (const [date, d] of Object.entries(docs)) { days[date] = d; for (const x of (d.list || [])) s[x.id] = { ...x, date }; }
    data.sessions = s;
  }

  function connectApp() {
    relay = true;
    (window as any).runwayData = (snap: any) => {
      if (snap.seq < sent && Date.now() - sentAt < 2000) return;
      // only the real data: a page that is still loading or signed out holds nothing or the example
      if (snap.mode === 'live') {
        const d = snap.data || {};
        for (const col of COLS) if (col !== 'sessions') absorb(col, d[col] || {});
        absorb('sessions', d.days || {});
      }
      mode = snap.mode === 'live' ? 'live' : mode === 'live' || snap.mode !== 'loading' ? 'error' : 'loading';
      problem = mode === 'error' ? (snap.problem || '数据连接断了，App 正在重新连接。') : '';
      onChange();
    };
    setTimeout(() => { if (mode === 'loading') { mode = 'error'; problem = '还没连上你的数据。App 会弹出 claude.ai 让你登录一次。'; onChange(); } }, 15000);
    appHost().postMessage(JSON.stringify({ op: 'hello' }));
  }

  async function connect() {
    if (appHost()) { connectApp(); return; }
    const c = (window as any).claude;
    if (__SHARE__) { let on = false; try { on = localStorage.getItem(LOCAL_KEY + ':on') === '1'; } catch { on = false; } if (on) { goLocal(false); return; } }
    try { db = c && c.use ? await c.use('db') : null; } catch { db = null; }
    if (!db) { if (__SHARE__) goLocal(false); else { mode = 'memory'; onChange(); } return; }
    if (__SHARE__) {
      let id: string | null = null;
      try { const u = await c.use('user'); id = u ? await u.id() : null; } catch { id = null; }
      if (id) base = db.doc('data/users/' + id + '/runway');
    }
    const seen = new Set<Col>();
    const timer = setTimeout(() => { if (mode === 'loading') { mode = 'error'; problem = '数据 10 秒还没读到，可能是网络问题。稍等一下再刷新。'; onChange(); } }, 10000);
    for (const col of COLS) {
      offs.push(colRef(col).onSnapshot((snap: any) => {
        const m: Record<string, any> = {};
        snap.docs.forEach((d: any) => { if (d.exists) m[d.id] = structuredClone(d.data()); });
        absorb(col, m);
        if (!snap.metadata.fromCache) seen.add(col);
        if (seen.size === COLS.length && mode !== 'live') { clearTimeout(timer); mode = 'live'; problem = ''; }
        onChange();
      }, (e: any) => { clearTimeout(timer); if (__SHARE__ && REFUSED.has(e?.code)) { goLocal(false); return; } mode = 'error'; problem = e?.code === 'revoked' ? '这个页面的数据权限被收回了。' : `数据连接断了（${e?.code || '未知'}）。刷新页面试试。`; onChange(); }));
    }
  }

  /** One write at a time per document; later writes to the same document wait for earlier ones. */
  function queue(key: string, job: () => Promise<void>) {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(job).catch((e: any) => {
      if (__SHARE__ && db && REFUSED.has(e?.code)) { goLocal(true); return; }
      problem = e?.code === 'quota_exceeded' ? '存储满了，有一处改动没存上。' : `有一处改动没存上（${e?.code || '未知'}），刷新后可能会丢。`;
      onChange();
    });
    chains.set(key, next);
    return next;
  }

  /** Change one document. `body` null deletes it. The screen updates at once; saving happens behind. */
  function put(col: Exclude<Col, 'sessions'>, id: string, body: Record<string, any> | null) {
    if (body) (data as any)[col][id] = body; else delete (data as any)[col][id];
    onChange();
    if (mode === 'local') saveLocal();
    if (relay) { send({ op: 'put', col, id, body }); return Promise.resolve(); }
    if (!db) return Promise.resolve();
    const ref = colRef(col).doc(id);
    return queue(col + '/' + id, () => body ? ref.set(body) : ref.delete());
  }

  /** Add one focus session; stored inside its day's document. */
  function addSession(id: string, s: { date: string; item: string; project: string; start: string; mins: number }) {
    data.sessions[id] = s;
    const day = days[s.date] = { list: [...(days[s.date]?.list || []), { id, item: s.item, project: s.project, start: s.start, mins: s.mins }] };
    onChange();
    if (mode === 'local') saveLocal();
    if (relay) { send({ op: 'session', id, s }); return Promise.resolve(); }
    if (!db) return Promise.resolve();
    return queue('sessions/' + s.date, () => colRef('sessions').doc(s.date).set(day));
  }

  /** Change how long one focus session counts for. */
  function setSessionMins(id: string, mins: number) {
    const s = data.sessions[id]; if (!s) return Promise.resolve();
    data.sessions[id] = { ...s, mins };
    const day = days[s.date] = { list: (days[s.date]?.list || []).map((x: any) => x.id === id ? { ...x, mins } : x) };
    onChange();
    if (mode === 'local') saveLocal();
    if (relay) { send({ op: 'mins', id, mins }); return Promise.resolve(); }
    if (!db) return Promise.resolve();
    return queue('sessions/' + s.date, () => colRef('sessions').doc(s.date).set(day));
  }

  /** Replace everything with a backup (old Runway format, optionally with sessions). */
  async function replaceAll(b: { items?: Docs; projects?: Docs; settings?: Docs; notes?: Docs; sessions?: Docs; spiral?: Docs }, progress: (done: number, total: number) => void) {
    const target: Record<Col, Docs> = {
      items: b.items || {}, projects: b.projects || {}, settings: b.settings || {}, notes: b.notes || {},
      sessions: Object.fromEntries(Object.entries(sessionsToDays(b.sessions || {})).map(([d, list]) => [d, { list }])),
      // old backups carry no spiral: keep the float window's reward list and timer as they are
      spiral: b.spiral || data.spiral,
    };
    const jobs: Array<[Col, string, Record<string, any> | null]> = [];
    for (const col of COLS) {
      const current = col === 'sessions' ? days : (data as any)[col];
      for (const id of Object.keys(current)) if (!target[col][id]) jobs.push([col, id, null]);
      for (const [id, body] of Object.entries(target[col])) jobs.push([col, id, body]);
    }
    for (const col of COLS) absorb(col, target[col]);
    onChange();
    if (mode === 'local') saveLocal();
    if (relay) { send({ op: 'replace', b }); progress(1, 1); return; }
    if (!db) { progress(jobs.length, jobs.length); return; }
    let done = 0;
    const worker = async () => {
      while (jobs.length) {
        const [col, id, body] = jobs.shift()!;
        if (!db) { done++; continue; }
        const ref = colRef(col).doc(id);
        await queue(col + '/' + id, () => body ? ref.set(body) : ref.delete());
        progress(++done, done + jobs.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  /** Everything, with sessions in their per-day documents: what the Mac app's window is sent. */
  const snapshot = () => ({ items: data.items, projects: data.projects, settings: data.settings, notes: data.notes, spiral: data.spiral, days });

  return {
    data, connect, put, addSession, setSessionMins, replaceAll, snapshot,
    get mode() { return mode; },
    get problem() { return problem; },
    clearProblem() { problem = ''; },
  };
}

/** In the hidden claude.ai page inside the Mac app: send the data to the app's window and carry out its writes.
 *  Returns what to call after every change. Does nothing anywhere else. */
export function serveRelay(S: ReturnType<typeof createStore>) {
  const h = relayHost();
  if (!h) return () => {};
  let seq = 0, timer = 0;
  const post = () => { clearTimeout(timer); timer = 0; h.postMessage(JSON.stringify({ seq, mode: S.mode, problem: S.problem, data: S.snapshot() })); };
  (window as any).runwayRelay = (c: any) => {
    seq = Math.max(seq, Number(c.seq) || 0);
    if (c.op === 'put') S.put(c.col, c.id, c.body);
    if (c.op === 'session') S.addSession(c.id, c.s);
    if (c.op === 'mins') S.setSessionMins(c.id, c.mins);
    if (c.op === 'replace') S.replaceAll(c.b, () => {});
    post();
  };
  // a beat even when nothing changes, so the app can tell a stuck page from a quiet one
  setInterval(post, 10000);
  return () => { if (!timer) timer = setTimeout(post, 80) as unknown as number; };
}

/** The backup file: the old Runway format, plus this app's sessions. Old Runway ignores the extra key. */
export function backupOf(data: Data) {
  return { app: 'runway', version: 2, exportedAt: new Date().toISOString(), items: data.items, projects: data.projects, notes: data.notes, settings: data.settings, sessions: data.sessions, spiral: data.spiral };
}

export function parseBackup(text: string) {
  let o: any;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.app !== 'runway' || typeof o.items !== 'object') return null;
  return o as { items: Docs; projects?: Docs; settings?: Docs; notes?: Docs; sessions?: Docs; spiral?: Docs; exportedAt?: string };
}
