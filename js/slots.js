// Dedupe keys and day logic. Pure functions, so tests run in node.
// The slot rules are in context/decisions.md; the DB enforces uniqueness on them.

const pad = n => String(n).padStart(2, '0');

// YYYY-MM-DD in the phone's local time, not UTC.
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Value for <input type="datetime-local">.
export const toLocalInput = d => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const bucket = d => (d.getHours() < 12 ? 'morning' : d.getHours() < 17 ? 'afternoon' : 'evening');

export function slotFor(metric, d, sugarContext) {
  if (metric === 'bp') return bucket(d);
  if (metric === 'sugar') return `${sugarContext}:${bucket(d)}`;
  return 'day';
}

export const mealFor = d => {
  const h = d.getHours();
  return h < 5 ? 'snack' : h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 18 ? 'snack' : h < 23 ? 'dinner' : 'snack';
};

// Medicines: three switches a day. A day saved with the old single switch counts as all three taken.
export const MED_SLOTS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
export const medOn = (checks, day, slot) => {
  const own = checks.find(c => c.day === day && c.kind === `meds_${slot}`);
  return own ? !!own.done : checks.some(c => c.day === day && c.kind === 'meds' && c.done);
};

// GLP-1 is taken once a week: next dose is 7 days after the last. `days` is days until due (negative = overdue).
export function glp1Due(lastDay, today) {
  const ms = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const days = Math.round((ms(lastDay) + 7 * 86_400_000 - ms(today)) / 86_400_000);
  const due = new Date(ms(lastDay) + 7 * 86_400_000).toISOString().slice(0, 10);
  return { due, days, state: days < 0 ? 'overdue' : days === 0 ? 'due' : 'ok' };
}
