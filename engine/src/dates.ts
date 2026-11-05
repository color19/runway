// Dates are plain 'YYYY-MM-DD' strings in local time, exactly as the legacy page stores them.
export type Day = string;

export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date): Day => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: Day) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const add = (s: Day, n: number): Day => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diff = (a: Day, b: Day) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
/** 0 = Monday … 6 = Sunday */
export const monIdx = (s: Day) => (parse(s).getDay() + 6) % 7;
export const range = (a: Day, b: Day): Day[] => { const out: Day[] = []; for (let d = a; d <= b; d = add(d, 1)) out.push(d); return out; };
/** 11月4日 */
export const cnd = (s: Day) => { const d = parse(s); return `${d.getMonth() + 1}月${d.getDate()}日`; };
/** The planning day, shifted back by `dayStart` hours so late-night work counts toward the previous day. */
export const todayOf = (now: number, dayStart = 0): Day => ymd(new Date(now - dayStart * 3600e3));

export const r1 = (x: number) => Math.round(x * 10) / 10;
export const r2 = (x: number) => Math.round(x * 100) / 100;
export const sum = (arr: Array<number | null | undefined>) => arr.reduce<number>((s, x) => s + (x || 0), 0);
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** 45m, 2h, 2h45m */
export const fmtH = (h: number) => {
  h = Math.max(0, h || 0);
  if (h < 0.995) return Math.round(h * 60) + 'm';
  const H = Math.floor(h + 1e-9), M = Math.round((h - H) * 60);
  return M ? (M === 60 ? (H + 1) + 'h' : `${H}h${M}m`) : H + 'h';
};
