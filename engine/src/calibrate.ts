// How far off estimates usually are: finished tasks that were timed, real time against the original estimate.
// It only reports; the schedule changes when the user chooses to re-estimate what is left.
import type { Day } from './dates';
import { add, r2 } from './dates';
import type { Store } from './model';

export interface CalSample {
  id: string;
  title: string;
  project: string;
  doneOn: Day;
  /** Original estimate, hours. */
  est: number;
  /** Timed hours. */
  real: number;
  ratio: number;
  /** So far off that the timer was probably left running or only part of the work was timed; not counted. */
  odd: boolean;
}

export interface Calibration {
  /** Real time ÷ estimate, typical case. null when there are too few samples to say. */
  factor: number | null;
  /** Samples counted. */
  n: number;
  samples: CalSample[];
}

/** Days looked back. */
export const CAL_DAYS = 30;
/** Fewer counted samples than this and no factor is given. */
export const CAL_MIN = 5;
/** Ratios beyond this many times either way are set aside as odd. */
const ODD = 6;

/** Finished tasks in the last `days` days that have both an estimate and timed hours. */
export function calSamples(store: Store, today: Day, days = CAL_DAYS): CalSample[] {
  const from = add(today, -(days - 1)), out: CalSample[] = [];
  for (const [id, it] of Object.entries(store.items)) {
    if (!it || it.old || !it.done || (it.kind || 'task') !== 'task') continue;
    const doneOn: Day = it.doneOn || it.date || '';
    if (!doneOn || doneOn < from || doneOn > today) continue;
    const est = Number(it.est) || 0;
    const logged = Object.values(it.log || {}).reduce<number>((s, h) => s + (Number(h) || 0), 0);
    const real = logged > 0 ? logged : (Number(it.actual) || 0);
    if (est <= 0 || real <= 0) continue;
    const ratio = real / est;
    out.push({ id, title: it.title || '未命名', project: it.project || '', doneOn, est, real: r2(real), ratio, odd: ratio > ODD || ratio < 1 / ODD });
  }
  return out.sort((a, b) => b.doneOn.localeCompare(a.doneOn) || a.title.localeCompare(b.title));
}

/**
 * The median ratio of the counted samples, pulled toward 1 while there are few of them,
 * rounded to 0.05. The median keeps one long or one rushed task from swinging it.
 */
export function calibrate(samples: CalSample[]): Calibration {
  const ok = samples.filter(s => !s.odd).map(s => s.ratio).sort((a, b) => a - b);
  const n = ok.length;
  if (n < CAL_MIN) return { factor: null, n, samples };
  const med = n % 2 ? ok[(n - 1) / 2] : (ok[n / 2 - 1] + ok[n / 2]) / 2;
  const f = 1 + (med - 1) * n / (n + 3);
  return { factor: Math.round(f * 20) / 20, n, samples };
}

/** One project's calibration, or every task's when the project has too few samples of its own. */
export function calibrationFor(store: Store, today: Day, project: string): Calibration & { own: boolean } {
  const all = calSamples(store, today);
  const own = calibrate(all.filter(s => s.project === project));
  if (own.factor != null) return { ...own, own: true };
  return { ...calibrate(all), own: false };
}
