import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Sign-in persists: the session lives in localStorage and refreshes itself in the background.
// A refresh that fails offline keeps the session (supabase-js retries), so he is never signed out by the network.
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // Default storage key on purpose: changing it would sign out every phone already signed in.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
// Ask the browser to keep this app's storage under disk pressure (honoured by Chrome for installed apps).
navigator.storage?.persist?.().catch(() => {});

export const isOffline = e =>
  !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed|fetch failed|network timeout/i.test(e?.message ?? '');

// Offline, supabase-js waits on a token refresh that never ends, so every call needs a deadline.
const deadline = (p, ms = 8000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('network timeout')), ms))]);

export async function rows(query) {
  if (!navigator.onLine) throw new Error('Failed to fetch: offline');
  const { data, error } = await deadline(query);
  if (error) throw error;
  return data;
}

// Reads: last good answer is kept in localStorage and served when the network is gone.
// `cacheOnly` = paint first: return the stored answer at once (no network), or throw 'nocache'.
export const peek = key => {
  try { const hit = localStorage.getItem(`pulse:${key}`); return hit == null ? undefined : JSON.parse(hit); } catch { return undefined; }
};
export async function cachedRows(key, query, cacheOnly = false) {
  if (cacheOnly) {
    const hit = peek(key);
    if (hit === undefined) throw new Error('nocache');
    return hit;
  }
  try {
    const data = await rows(query);
    try { localStorage.setItem(`pulse:${key}`, JSON.stringify(data)); } catch {}
    return data;
  } catch (e) {
    const hit = peek(key);
    if (!isOffline(e) || hit === undefined) throw e;
    return hit;
  }
}

export function clearCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith('pulse:')).forEach(k => localStorage.removeItem(k)); } catch {}
}

// ── Offline write queue (IndexedDB) ───────────────────────────────────────
// FIFO. Every op is idempotent (upsert keys, client UUIDs, upload upsert), so a replay is safe.
const STORE = 'queue';
let dbp;
const idb = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('pulse', 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
async function tx(mode, fn) {
  const t = (await idb()).transaction(STORE, mode);
  const req = fn(t.objectStore(STORE));
  return new Promise((res, rej) => ((t.oncomplete = () => res(req.result)), (t.onerror = () => rej(t.error))));
}
export const pending = () => tx('readonly', s => s.getAll());
export const clearQueue = async () => (await tx('readwrite', s => s.clear()), notify());
const notify = async () => dispatchEvent(new CustomEvent('pulse:queue', { detail: (await pending()).length }));

async function run(op) {
  const { error } = await deadline(runRaw(op));
  if (error) throw error;
}
const runRaw = op =>
  op.kind === 'upsert' ? sb.from(op.table).upsert(op.row, { onConflict: op.onConflict })
  : op.kind === 'patch' ? sb.from(op.table).update(op.fields).eq('id', op.id)
  : sb.storage.from('photos').upload(op.path, op.blob, { contentType: (op.blob.type || 'image/jpeg').split(';')[0], upsert: true });

// Send now if online and nothing is waiting (keeps order); otherwise queue.
async function write(op) {
  if (navigator.onLine && !(await pending()).length) {
    try {
      await run(op);
      return 'sent';
    } catch (e) {
      if (!isOffline(e)) throw e;
    }
  }
  await tx('readwrite', s => s.add(op));
  notify();
  return 'queued';
}

export const upsert = (table, row, onConflict = 'id') => write({ kind: 'upsert', table, row, onConflict });
export const patch = (table, id, fields) => write({ kind: 'patch', table, id, fields });
export const uploadPhoto = (path, blob) => write({ kind: 'upload', path, blob });
export const uploadFile = uploadPhoto; // photos and voice notes share the private bucket

let flushing = false;
export async function flush() {
  if (!navigator.onLine) return notify(); // still show what is waiting, e.g. after an offline restart
  if (flushing) return;
  flushing = true;
  let sent = 0;
  try {
    for (const op of await pending()) {
      try {
        await run(op);
        sent++;
      } catch (e) {
        // Network or auth trouble: stop and retry later. A rejected row would block the queue forever,
        // so it is dropped and reported instead.
        if (isOffline(e) || /jwt|token|401|5\d\d/i.test(`${e.message} ${e.status ?? e.statusCode ?? ''}`)) break;
        dispatchEvent(new CustomEvent('pulse:dropped', { detail: e.message }));
      }
      await tx('readwrite', s => s.delete(op.seq));
    }
  } finally {
    flushing = false;
    await notify();
    if (sent) dispatchEvent(new Event('pulse:synced'));
  }
}

const signed = new Map();
export async function photoUrl(path) {
  // A photo still in the queue is shown from the phone itself.
  const queued = (await pending()).find(op => op.kind === 'upload' && op.path === path);
  if (queued) return URL.createObjectURL(queued.blob);
  if (!signed.has(path)) {
    // Offline or expired: an empty src leaves the grey placeholder instead of an error.
    if (!navigator.onLine) return '';
    const { data, error } = await deadline(sb.storage.from('photos').createSignedUrl(path, 3600)).catch(e => ({ error: e }));
    if (error) return '';
    signed.set(path, data.signedUrl);
  }
  return signed.get(path);
}
