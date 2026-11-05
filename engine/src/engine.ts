import type { Day } from './dates';
import { add, cnd, diff, fmtH, monIdx, r1, range, sum } from './dates';
import type { CountGoal, Item, Project, Settings, Store } from './model';
import { needsReest, normItem, normProj, normSettings } from './model';

export type Level = 'good' | 'mid' | 'bad' | 'flat';

export interface Allocation {
  /** projectId → day → planned hours */
  byProj: Record<string, Record<Day, number>>;
  /** day → projectId → planned hours */
  byDay: Record<Day, Record<string, number>>;
}

export interface CountStat {
  exp: number; got: number; debt: number; ahead: number; tT: number; tD: number;
  cur: number; next: { from: Day; n: number } | null; first: Day; avg7: number | null; total: number;
}

export interface ProjectStatus {
  rem: number; total: number; left: number; done: number;
  need: number; planEnd: Day;
  k?: Level; label?: string; text?: string; short?: string;
  reest?: number; press?: number; loadAvg?: number; speed?: number; forecast?: Day; early?: number;
  cnt?: CountStat;
}

export interface Derived {
  t: Day;
  items: Item[];
  projects: Project[];
  projMap: Map<string, Project>;
  byDate: Map<Day, Item[]>;
  /** projectId → day → planned-hours progress (hours retired that day) */
  progress: Map<string, Map<Day, number>>;
  /** projectId → day → hours worth of counted units */
  cprog: Map<string, Map<Day, number>>;
  /** day → real hours spent */
  effort: Map<Day, number>;
  doneCount: Map<Day, number>;
}

const KIND_RANK: Record<string, number> = { exam: 0, deadline: 1, event: 2, task: 3 };
export function sortItems(a: Item, b: Item) {
  const g = (i: Item) => !i.time && (i.kind === 'exam' || i.kind === 'deadline') ? 0 : i.time ? 1 : 2;
  return (Number(a.done) - Number(b.done)) || (g(a) - g(b)) || (a.time || '').localeCompare(b.time || '') || (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.order - b.order) || a.title.localeCompare(b.title);
}

/**
 * The planning engine for one snapshot of the store, as seen on `today`.
 * Everything is derived lazily and cached; build a new engine after the store changes.
 */
export function createEngine(store: Store, today: Day) {
  const settings: Settings = normSettings(store.settings.main || {});
  let dv: Derived | null = null;
  const allocMemo = new Map<Day, Allocation>();
  const cntMemo = new Map<string, CountStat>();

  function derive(): Derived {
    if (dv) return dv;
    const items = Object.entries(store.items).map(([id, it]) => normItem(id, it));
    const projects = Object.entries(store.projects).map(([id, p]) => normProj(id, p, today)).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const byDate = new Map<Day, Item[]>(), projMap = new Map(projects.map(p => [p.id, p]));
    for (const it of items) { if (it.date) { if (!byDate.has(it.date)) byDate.set(it.date, []); byDate.get(it.date)!.push(it); } }
    for (const arr of byDate.values()) arr.sort(sortItems);
    const progress = new Map<string, Map<Day, number>>();
    const effort = new Map<Day, number>();
    const doneCount = new Map<Day, number>();
    const cprog = new Map<string, Map<Day, number>>();
    const bump = (m: Map<Day, number>, k: Day, v: number) => m.set(k, (m.get(k) || 0) + v);
    for (const p of projects) {
      const pm = new Map<Day, number>(); progress.set(p.id, pm);
      for (const [d, h] of Object.entries(p.log)) { const v = Number(h) || 0; if (v) { bump(pm, d, v); bump(effort, d, v); } }
      if (p.count) {
        const cm = new Map<Day, number>(); cprog.set(p.id, cm);
        for (const [d, n] of Object.entries(p.count.log)) { const v = (Number(n) || 0) * p.count.mins / 60; if (v) { bump(cm, d, v); bump(effort, d, v); } }
      }
    }
    for (const it of items) {
      const hasLog = it.log && Object.keys(it.log).length > 0;
      if (hasLog) for (const [d, h] of Object.entries(it.log)) { const v = Number(h) || 0; if (v) bump(effort, d, v); }
      // progress = remaining hours retired, on the day they were retired (partial work counts the same day)
      if (it.burn && it.kind === 'task' && it.project && progress.has(it.project)) for (const [d, h] of Object.entries(it.burn)) { const v = Number(h) || 0; if (v) bump(progress.get(it.project)!, d, v); }
      if (!it.done || !it.doneOn) continue;
      bump(doneCount, it.doneOn, 1);
      if (it.kind !== 'task') continue;
      if (!hasLog) { const real = it.actual != null ? it.actual : it.est; bump(effort, it.doneOn, real); }
      if (!it.burn && it.project && progress.has(it.project)) bump(progress.get(it.project)!, it.doneOn, it.est);
    }
    dv = { t: today, items, projects, projMap, byDate, progress, cprog, effort, doneCount };
    return dv;
  }

  const itemsOn = (d: Day) => derive().byDate.get(d) || [];
  function capOf(d: Day) { if (settings.off[d] != null) return 0; return settings.over[d] != null ? Number(settings.over[d]) : Number(settings.cap[monIdx(d)]) || 0; }
  const projTasks = (pid: string) => derive().items.filter(i => i.project === pid && i.kind === 'task');
  const logSum = (p: Project) => sum(Object.values(p.log).map(Number));
  const remNow = (p: Project) => sum(projTasks(p.id).filter(i => !i.done).map(i => i.hours)) + Math.max(0, p.lump - logSum(p));
  const totalOf = (p: Project) => sum(projTasks(p.id).map(i => i.est)) + Math.max(p.lump, logSum(p));
  function progOn(pid: string, d: Day) { const m = derive().progress.get(pid), c = derive().cprog.get(pid); return (m ? (m.get(d) || 0) : 0) + (c ? (c.get(d) || 0) : 0); }
  function remStart(p: Project, D: Day) { let r = remNow(p); const m = derive().progress.get(p.id); if (m) for (const [d, h] of m) if (d >= D) r += h; return r; }
  function windowOf(p: Project, D: Day): [Day, Day] | null {
    const start = p.start > D ? p.start : D;
    let end = add(p.deadline, -1 - p.buffer);
    if (end < start) end = add(p.deadline, -1);
    if (end < start) return null;
    return [start, end];
  }

  /* ---------- count goals: a number per day (applications, problems…) instead of hours ---------- */
  const cntOf = (p: Project): CountGoal | null => p && p.count && p.count.plan.length ? p.count : null;
  function cntTgt(p: Project, d: Day) {
    const c = cntOf(p); if (!c || d < p.start || d >= p.deadline || capOf(d) <= 0) return 0;
    let n = 0; for (const x of c.plan) if (x.from <= d) n = x.n; return n;
  }
  const cntDone = (p: Project, d: Day) => Math.max(0, Number((cntOf(p)?.log || {})[d]) || 0);
  const cntN = (n: number, p: Project) => { const u = ((cntOf(p) || p.count || { unit: '' }).unit || '').trim(); return u ? `${n} ${u}` : String(n); };

  /**
   * Joint allocation as seen from day D: earliest deadline first; each project spreads its remaining
   * hours over its window, weighted by the capacity still free that day (balance) or by raw capacity.
   * Count goals are placed first since their daily numbers are fixed.
   */
  function allocate(D: Day): Allocation {
    const hit = allocMemo.get(D); if (hit) return hit;
    const { projects } = derive();
    const byProj: Allocation['byProj'] = {}, byDay: Allocation['byDay'] = {}, free: Record<Day, number> = {};
    for (const p of projects) {
      byProj[p.id] = {};
      if (!cntOf(p)) continue;
      for (let d = D, k = 0; d < p.deadline && k < 400; d = add(d, 1), k++) {
        const n = cntTgt(p, d); if (!n) continue;
        const h = n * p.count!.mins / 60;
        byProj[p.id][d] = h; (byDay[d] = byDay[d] || {})[p.id] = h;
        free[d] = (free[d] != null ? free[d] : capOf(d)) - h;
      }
    }
    for (const p of projects) {
      const rem = remStart(p, D);
      const w = windowOf(p, D);
      if (!w || rem <= 1e-6 || p.deadline <= D) continue;
      const days = range(w[0], w[1]);
      let wts = days.map(d => settings.balance ? Math.max(0, free[d] != null ? free[d] : capOf(d)) : capOf(d));
      if (sum(wts) < 1e-6) wts = days.map(d => capOf(d));
      if (sum(wts) < 1e-6) wts = days.map(() => 1);
      const tot = sum(wts);
      days.forEach((d, i) => {
        const h = rem * wts[i] / tot; if (h < 1e-6) return;
        byProj[p.id][d] = (byProj[p.id][d] || 0) + h; const bd = (byDay[d] = byDay[d] || {}); bd[p.id] = (bd[p.id] || 0) + h;
        free[d] = (free[d] != null ? free[d] : capOf(d)) - h;
      });
    }
    const res = { byProj, byDay };
    allocMemo.set(D, res);
    return res;
  }
  const quota = (pid: string, D: Day = today) => (allocate(D).byProj[pid] || {})[D] || 0;
  const dayNeed = (d: Day, D: Day = today) => sum(Object.values(allocate(D).byDay[d] || {}));
  const progDay = (d: Day) => sum(derive().projects.map(p => progOn(p.id, d)));
  function workdays(p: Project, D: Day) { const w = windowOf(p, D); return w ? range(w[0], w[1]).filter(d => capOf(d) > 0) : []; }

  function cntStat(p: Project, D: Day = today): CountStat {
    const key = p.id + D, hit = cntMemo.get(key); if (hit) return hit;
    const c = cntOf(p)!, first = c.plan[0].from;
    let exp = 0, got = 0, wk = 0, wkDays = 0;
    for (const [d, n] of Object.entries(c.log)) if (d < D && d >= p.start) got += Number(n) || 0;
    for (let d = first > p.start ? first : p.start, k = 0; d < D && k < 800; d = add(d, 1), k++) exp += cntTgt(p, d);
    for (let k = 1; k <= 7; k++) { const d = add(D, -k); if (d < p.start || d < first) break; wk += cntDone(p, d); wkDays++; }
    const tT = cntTgt(p, D), tD = cntDone(p, D);
    let cur = 0, next: CountStat['next'] = null; for (const x of c.plan) { if (x.from <= D) cur = x.n; else if (!next) next = x; }
    const r: CountStat = { exp, got, debt: Math.max(0, exp - got), ahead: Math.max(0, got - exp), tT, tD, cur, next, first, avg7: wkDays ? wk / wkDays : null, total: got + tD };
    cntMemo.set(key, r);
    return r;
  }

  function cntStatus(p: Project, D: Day, res: ProjectStatus): ProjectStatus {
    const cs = cntStat(p, D); res.cnt = cs;
    const plan = () => [cs.cur ? `每天 ${cntN(cs.cur, p)}` : '', cs.next ? `${cnd(cs.next.from)} 起每天 ${cs.next.n}` : ''].filter(Boolean).join(' · ');
    if (res.left <= 0) { res.k = 'flat'; res.label = '已结束'; res.text = res.short = `累计 ${cntN(cs.total, p)}`; return res; }
    if (D < cs.first && !cs.total) { res.k = 'flat'; res.label = '还没开始'; const n0 = cntOf(p)!.plan[0].n; res.text = res.short = `${cnd(cs.first)} 开始，每天 ${cntN(n0, p)}`; return res; }
    const w = windowOf(p, D), A = allocate(D).byDay, ds = w ? range(w[0], w[1]) : [];
    const load = sum(ds.map(d => sum(Object.values(A[d] || {})))), capW = sum(ds.map(capOf));
    const press = capW > 0 ? load / capW : 9; res.press = press;
    const day = Math.max(1, cs.tT || cs.cur);
    let k: Level, label: string;
    if (cs.debt > 0) { k = cs.debt > day ? 'bad' : 'mid'; label = `欠 ${cntN(cs.debt, p)}`; }
    else if (press > 1 + 1e-6) { k = 'bad'; label = '时间不够'; }
    else if (press > .7) { k = 'mid'; label = '有点赶'; }
    else { k = 'good'; label = '稳'; }
    res.k = k; res.label = label;
    const avg = cs.avg7 != null ? `最近 7 天平均 ${r1(cs.avg7)}/天` : '';
    res.short = [cs.exp ? `到昨天 ${cs.got} / 应有 ${cs.exp}` : plan(), avg, `负荷 ${Math.round(press * 100)}%`].filter(Boolean).join(' · ');
    res.text = `今天 ${cs.tD} / ${cntN(cs.tT, p)}。到昨天应有 ${cs.exp}，实际 ${cs.got}${cs.debt ? `，欠 ${cs.debt}` : cs.ahead ? `，多 ${cs.ahead}` : ''}。${plan()}，每个按 ${p.count!.mins} 分钟算进时间。截止前所有项目加起来占可用时间的 ${Math.round(press * 100)}%。`;
    return res;
  }

  /** How a project stands on day D: on track, tight, short of time, or late at the current pace. */
  function projStatus(p: Project, D: Day = today): ProjectStatus {
    const rem = remNow(p), total = totalOf(p);
    const left = diff(D, p.deadline);
    const wd = workdays(p, D);
    const avgCap = wd.length ? sum(wd.map(capOf)) / wd.length : 0;
    const res: ProjectStatus = { rem, total, left, done: Math.max(0, total - rem), need: wd.length ? remStart(p, D) / wd.length : rem, planEnd: add(p.deadline, -p.buffer) };
    if (cntOf(p)) return cntStatus(p, D, res);
    if (total < 1e-6) { res.k = 'flat'; res.label = '待加任务'; res.text = '还没有任务或工作量。点进项目添加任务，或填一个总工作量。'; return res; }
    const reestN = projTasks(p.id).filter(needsReest).length;
    res.reest = reestN;
    if (rem < 1e-3 && reestN) { res.k = 'mid'; res.label = '需要重新估时'; res.text = `还有 ${reestN} 件没完成，但剩余时间记成了 0。点任务旁的进度图标，填一下还需要多久。`; return res; }
    if (rem < 1e-3) { res.k = 'good'; res.label = '全部完成'; res.text = '全部任务已完成。'; return res; }
    if (left <= 0) { res.k = 'bad'; res.label = '已过 Deadline'; res.text = `已过 Deadline ${-left} 天，还剩 ${fmtH(rem)}。`; return res; }
    if (p.start > D) { res.k = 'flat'; res.label = '还没开始'; res.text = `${cnd(p.start)} 开始，还有 ${diff(D, p.start)} 天。`; return res; }
    // 1) shared-capacity pressure: everything every project plans to do inside this project's window,
    //    against the hours actually available in that window. Projects compete for the same day.
    const w = windowOf(p, D), A = allocate(D).byDay;
    const ds = w ? range(w[0], w[1]) : [];
    const load = sum(ds.map(d => sum(Object.values(A[d] || {}))));
    const capW = sum(ds.map(capOf));
    const press = capW > 0 ? load / capW : 9;
    res.press = press; res.loadAvg = wd.length ? load / wd.length : 0;
    const pk: Level = press > 1 + 1e-6 ? 'bad' : press > .7 ? 'mid' : 'good';
    const pText = `截止前所有项目加起来每个可用日要 ${fmtH(res.loadAvg)}，你平均每天能投入 ${fmtH(avgCap)}（占 ${Math.round(press * 100)}%）。`;
    // 2) recent pace per working day over the last two weeks (days off don't drag it down),
    //    walked forward over the working days ahead
    const pm = derive().progress.get(p.id) || new Map<Day, number>();
    let recent = 0, activeDays = 0, workN = 0;
    for (let k = 0; k < 14; k++) { const d = add(D, -k); if (d < p.start) break; const v = pm.get(d) || 0; recent += v; if (v > 0) activeDays++; if (capOf(d) > 0 || v > 0) workN++; }
    const speed = workN > 0 ? recent / workN : 0;
    res.speed = speed;
    let sk: Level | null = null, sText = '';
    if (activeDays >= 2 && speed > 0.02) {
      let remaining = rem, fd = D;
      for (let k = 0; k < 730; k++) { if (capOf(fd) > 0) remaining -= speed; if (remaining <= 1e-6) break; fd = add(fd, 1); }
      res.forecast = fd;
      const early = diff(fd, p.deadline) - 1;
      res.early = early;
      sk = early < 0 ? 'bad' : early < p.buffer ? 'mid' : 'good';
      sText = early < 0 ? `按最近两周的速度，预计 ${cnd(fd)} 完成，会晚 ${-early} 天。` : `按最近两周的速度，预计 ${cnd(fd)} 完成，提前 ${early} 天。`;
    }
    // the worse of the two decides
    const k: Level = pk === 'bad' ? 'bad' : (sk || pk);
    res.k = k;
    res.label = k === 'good' ? '稳' : k === 'mid' ? '有点赶' : (pk === 'bad' ? '时间不够' : '会晚');
    res.text = (sText ? sText + ' ' : '') + pText;
    const fd = res.forecast ? (res.forecast.slice(0, 4) !== D.slice(0, 4) ? `${res.forecast.slice(0, 4)}年${cnd(res.forecast)}` : cnd(res.forecast)) : '';
    res.short = res.forecast ? (res.early! < 0 ? `按现在的速度 ${fd} 完成，晚 ${-res.early!} 天` : `按现在的速度 ${fd} 完成，提前 ${res.early} 天`) + ` · 负荷 ${Math.round(press * 100)}%` : `负荷 ${Math.round(press * 100)}%`;
    return res;
  }

  return {
    today, settings, derive, itemsOn, capOf, projTasks, remNow, totalOf, progOn, remStart, windowOf,
    allocate, quota, dayNeed, progDay, workdays, cntOf, cntTgt, cntDone, cntStat, projStatus,
  };
}

export type Engine = ReturnType<typeof createEngine>;
