// Where the data lives. On claude.ai the page keeps it in its own database (the `db` capability), so the
// phone and the Mac see the same thing. Without it the page still runs, from memory only, and says so.
// The rest of the app only sees `data` and `put`; a local-first backend can replace this file later.
import type { Store } from '../engine/src';

export type Col = 'items' | 'projects' | 'settings' | 'notes' | 'sessions' | 'spiral';
const COLS: Col[] = ['items', 'projects', 'settings', 'notes', 'sessions', 'spiral'];
type Docs = Record<string, Record<string, any>>;
/** `spiral` holds the Mac float window's spiral timer: docs `state`, `b` (reward list) and `block`. */
export type Data = Required<Store> & { notes: Docs; spiral: Docs };
export type Mode = 'loading' | 'live' | 'memory' | 'error';

/** Sessions are kept one document per day: { list: [{id, item, project, start, mins}] }. */
const sessionsToDays = (s: Docs) => {
  const days: Record<string, any[]> = {};
  for (const [id, x] of Object.entries(s)) (days[x.date] ||= []).push({ id, item: x.item || '', project: x.project || '', start: x.start || '', mins: x.mins });
  return days;
};

export function createStore(onChange: () => void) {
  const data: Data = { items: {}, projects: {}, settings: {}, notes: {}, sessions: {}, spiral: {} };
  let db: any = null;
  let mode: Mode = 'loading';
  let problem = '';
  const chains = new Map<string, Promise<void>>();
  const days: Record<string, Record<string, any>> = {};

  function absorb(col: Col, docs: Record<string, any>) {
    if (col !== 'sessions') { (data as any)[col] = docs; return; }
    const s: Docs = {};
    for (const k of Object.keys(days)) delete days[k];
    for (const [date, d] of Object.entries(docs)) { days[date] = d; for (const x of (d.list || [])) s[x.id] = { ...x, date }; }
    data.sessions = s;
  }

  async function connect() {
    const c = (window as any).claude;
    try { db = c && c.use ? await c.use('db') : null; } catch { db = null; }
    if (!db) { mode = 'memory'; onChange(); return; }
    const seen = new Set<Col>();
    const timer = setTimeout(() => { if (mode === 'loading') { mode = 'error'; problem = '数据 10 秒还没读到，可能是网络问题。稍等一下再刷新。'; onChange(); } }, 10000);
    for (const col of COLS) {
      db.collection(col).onSnapshot((snap: any) => {
        const m: Record<string, any> = {};
        snap.docs.forEach((d: any) => { if (d.exists) m[d.id] = structuredClone(d.data()); });
        absorb(col, m);
        if (!snap.metadata.fromCache) seen.add(col);
        if (seen.size === COLS.length && mode !== 'live') { clearTimeout(timer); mode = 'live'; problem = ''; }
        onChange();
      }, (e: any) => { clearTimeout(timer); mode = 'error'; problem = e?.code === 'revoked' ? '这个页面的数据权限被收回了。' : `数据连接断了（${e?.code || '未知'}）。刷新页面试试。`; onChange(); });
    }
  }

  /** One write at a time per document; later writes to the same document wait for earlier ones. */
  function queue(key: string, job: () => Promise<void>) {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(job).catch((e: any) => {
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
    if (!db) return Promise.resolve();
    const ref = db.collection(col).doc(id);
    return queue(col + '/' + id, () => body ? ref.set(body) : ref.delete());
  }

  /** Add one focus session; stored inside its day's document. */
  function addSession(id: string, s: { date: string; item: string; project: string; start: string; mins: number }) {
    data.sessions[id] = s;
    const day = days[s.date] = { list: [...(days[s.date]?.list || []), { id, item: s.item, project: s.project, start: s.start, mins: s.mins }] };
    onChange();
    if (!db) return Promise.resolve();
    return queue('sessions/' + s.date, () => db.collection('sessions').doc(s.date).set(day));
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
    if (!db) { progress(jobs.length, jobs.length); return; }
    let done = 0;
    const worker = async () => {
      while (jobs.length) {
        const [col, id, body] = jobs.shift()!;
        const ref = db.collection(col).doc(id);
        await queue(col + '/' + id, () => body ? ref.set(body) : ref.delete());
        progress(++done, done + jobs.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  return {
    data, connect, put, addSession, replaceAll,
    get mode() { return mode; },
    get problem() { return problem; },
    clearProblem() { problem = ''; },
  };
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
