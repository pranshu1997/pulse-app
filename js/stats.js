// Dashboard maths. Pure functions over plain rows, so tests run in node.
// Day status rule (context/decisions.md): items = REQUIRED metrics + the 3 medicine switches (from the first switch day).
import { localDate, MED_SLOTS, medOn } from './slots.js';

export const parseDay = ymd => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// n days ending today, oldest first, as YYYY-MM-DD.
export const lastDays = (n, today = new Date()) =>
  Array.from({ length: n }, (_, i) => localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i))));

const groupBy = (rows, key) => rows.reduce((m, r) => (m.get(r[key])?.push(r) ?? m.set(r[key], [r]), m), new Map());

// Index rows once; every per-day question below is then a map lookup.
// firstMed = first day any meds* switch row exists; medicine items count from that day on.
export function indexData({ readings, checks, firstMed }) {
  return {
    firstMed,
    readings: groupBy(readings.filter(r => !r.deleted_at), 'slot_date'),
    checks: groupBy(checks.filter(c => !c.deleted_at && c.kind.startsWith('meds')), 'day'),
  };
}

// The three switches for a day, [morning, afternoon, evening], as booleans.
export const switchesOn = (idx, ymd) => MED_SLOTS.map(([s]) => medOn(idx.checks.get(ymd) ?? [], ymd, s));
const tracked = (idx, ymd) => !!idx.firstMed && ymd >= idx.firstMed;

export function dayItems(idx, ymd, required) {
  const metrics = new Set((idx.readings.get(ymd) ?? []).map(r => r.metric));
  const meds = tracked(idx, ymd);
  const done = required.filter(m => metrics.has(m)).length + (meds ? switchesOn(idx, ymd).filter(Boolean).length : 0);
  return { done, total: required.length + (meds ? 3 : 0) };
}

// 'none' (grey) = outside tracking; 'skipped' (red) = nothing done; 'partial' (amber); 'done' (green).
export function dayStatus(idx, ymd, { firstDay, today, required }) {
  if (!firstDay || ymd < firstDay || ymd > today) return 'none';
  const { done, total } = dayItems(idx, ymd, required);
  if (done === 0) return ymd === today ? 'none' : 'skipped'; // today is not over yet
  return done === total ? 'done' : 'partial';
}

const mondayOf = ymd => {
  const d = parseDay(ymd);
  return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
};

// Per week (Monday start): switches on / 3 a day, from the first switch day up to yesterday (today is on the tile).
export function weeklyAdherence(idx, days, today) {
  const weeks = new Map();
  for (const ymd of days) {
    if (!tracked(idx, ymd)) continue;
    const w = weeks.get(mondayOf(ymd)) ?? { taken: 0, due: 0 };
    if (ymd < today) (w.due += 3), (w.taken += switchesOn(idx, ymd).filter(Boolean).length);
    weeks.set(mondayOf(ymd), w);
  }
  return [...weeks].map(([week, w]) => ({ week, ...w, pct: w.due ? Math.round((100 * w.taken) / w.due) : null }));
}
