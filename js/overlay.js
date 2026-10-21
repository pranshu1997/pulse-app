// Lay queued (offline) writes over server rows, so an entry shows the moment it is saved.
// Pure, so tests run in node. `key` = the columns the table upserts on.
export const KEYS = {
  readings: ['user_id', 'metric', 'slot_date', 'slot'],
  dose_log: ['schedule_id', 'dose_date'],
  meals: ['id'],
  tasks: ['id'],
  dose_schedule: ['id'],
  daily_check: ['user_id', 'day', 'kind'],
  med_plan: ['id'],
  day_note: ['user_id', 'day'],
};

export function overlay(rows, ops, table) {
  const key = r => KEYS[table].map(f => r[f]).join('|');
  const out = new Map(rows.map(r => [key(r), r]));
  for (const op of ops) {
    if (op.table !== table) continue;
    if (op.kind === 'upsert') out.set(key(op.row), { ...out.get(key(op.row)), ...op.row, pending: true });
    if (op.kind === 'patch')
      for (const [k, r] of out) if (r.id === op.id) out.set(k, { ...r, ...op.fields, pending: true });
  }
  return [...out.values()];
}
