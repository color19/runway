// What the d-day counts down to. The page header and the Mac float both read it from here, so they always agree.
// settings.main.countTo holds the picked id ('' = the nearest exam); settings.main.countName an optional short label.
type Docs = Record<string, Record<string, any>>;
export interface CountTarget { id: string; title: string; date: string; kind: 'exam' | 'deadline' | 'project' }

/** "CFA Level 1" → "CFA", "643 Economics…" → "643", "求职2027NG" → "求职". */
export const shortLabel = (name: string) => (name.match(/^([A-Za-z]+|\d+|[一-鿿]{1,4})/) || [name.slice(0, 4)])[0];

/** Every date still ahead: exams and deadlines, then project deadlines that no exam or deadline already marks. */
export function countTargets(items: Docs, projects: Docs, today: string): CountTarget[] {
  const out: CountTarget[] = [];
  for (const [id, x] of Object.entries(items))
    if ((x.kind === 'exam' || x.kind === 'deadline') && x.date && x.date >= today && !x.done && !x.old) out.push({ id, title: x.title || '', date: x.date, kind: x.kind });
  for (const [id, p] of Object.entries(projects))
    if (p.deadline && p.deadline >= today && !p.archived && !out.some(x => x.date === p.deadline)) out.push({ id: 'p:' + id, title: (p.name || id) + ' 截止', date: p.deadline, kind: 'project' });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** The picked date while it is still ahead, else the nearest exam, else the nearest date of any kind. */
export function countTo(items: Docs, projects: Docs, main: Record<string, any>, today: string) {
  const ts = countTargets(items, projects, today), pick = String(main.countTo || '');
  const t = (pick && ts.find(x => x.id === pick)) || ts.find(x => x.kind === 'exam') || ts[0];
  if (!t) return null;
  const picked = !!pick && t.id === pick;
  return { ...t, picked, label: (picked && String(main.countName || '').trim()) || shortLabel(t.title) };
}
