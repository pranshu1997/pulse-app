// One-time tasks, one screen for both phones: short rows (tap one to enter a result in a sheet with the shared keypad),
// plus a detail sheet per test with its result history and chart. A retest is a new row with retest_of, so every lab result stays.
import { sb, upsert, patch, cachedRows, pending, uploadPhoto, photoUrl } from './db.js';
import { overlay } from './overlay.js';
import { localDate } from './slots.js';
import { esc, toast, shrink, buzz, busy, hideToast } from './ui.js';
import { field, pad, setActive, bindKeypad, fieldProblem } from './keypad.js';

export const TESTS = {
  cortisol: { title: 'S. cortisol', unit: 'µg/dL' },
  vit_d3: { title: 'Vitamin D3', unit: 'ng/mL' },
  iron: { title: 'Iron', unit: 'µg/dL' },
  b12: { title: 'Vitamin B12', unit: 'pg/mL' },
};

let root, uid, list = [], channel, poll, loads = 0, openId = null;
// A tick or a new test shows before the network answers; the next load replaces it (or undoes it if the save failed).
const inflight = new Set();
let saving = Promise.resolve(); // one write at a time, so quick taps land in tap order

const byId = id => list.find(t => t.id === id);
const fmtDay = ymd => new Date(`${ymd}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const CHEV = '<svg class="chev" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const addRow = (act, label) => `<button type="button" class="tl-add" data-act="${act}">${PLUS}<span>${label}</span></button>`;
const photos = t => t.photo_paths ?? [];
const thumbs = t => photos(t).map(p => `<a target="_blank" rel="noopener" data-path="${esc(p)}"><img alt="Report photo"></a>`).join('');

export async function mountTasks(el, profile) {
  root = el;
  uid = profile.owner;
  root.innerHTML = `
    <header class="large-title"><h1>Tasks</h1></header>
    <section class="tl-sec" data-out="due-sec" hidden><h2 class="tl-h">Due</h2><div class="tl-list" data-out="due"></div></section>
    <section class="tl-sec"><h2 class="tl-h">Lab results</h2><div class="tl-list" data-out="tests"></div></section>
    <section class="tl-sec"><h2 class="tl-h">Questions for the doctor</h2><div class="tl-list" data-out="questions"></div>
      <details class="tl-list tl-fold"><summary><span>Asked</span><span class="tl-fold-n muted" data-out="asked-count"></span>${CHEV}</summary><div data-out="asked"></div></details></section>
    <section class="tl-sec"><h2 class="tl-h">To do</h2><div class="tl-list" data-out="open"></div>
      <details class="tl-list tl-fold"><summary><span>Done</span><span class="tl-fold-n muted" data-out="done-count"></span>${CHEV}</summary><div data-out="done"></div></details></section>

    <dialog class="sheet tl" data-sheet="history">
      <div class="sheet-head"><h2 data-out="history-title"></h2><button type="button" class="link" data-act="close">Close</button></div>
      <div data-out="history"></div>
      <button type="button" class="btn save" data-act="add-result">Add result</button>
    </dialog>

    <dialog class="sheet tl" data-sheet="pick"><form method="dialog">
      <div class="sheet-head"><h2>Which test?</h2><button class="link" value="">Close</button></div>
      <div class="tl-list tl-pick">${Object.entries(TESTS).map(([code, t]) => `<button value="${code}"><span>${t.title}</span><small>${t.unit}</small>${CHEV}</button>`).join('')}<button value="other"><span>Other test</span>${CHEV}</button></div>
    </form></dialog>

    <dialog class="sheet tl" data-sheet="newtest"><form data-act="new-test">
      <div class="sheet-head"><h2>New test</h2><button type="button" class="link" data-act="close">Close</button></div>
      <label>Name<input name="title" required maxlength="80" autocomplete="off"></label>
      <label>Unit (optional)<input name="unit" maxlength="20" placeholder="mg/dL" autocomplete="off"></label>
      <button class="save">Add test</button>
    </form></dialog>

    <dialog class="sheet tl" data-sheet="new"><form data-act="new-task">
      <div class="sheet-head"><h2>New task</h2><button type="button" class="link" data-act="close">Close</button></div>
      <label>Task<input name="title" required autocomplete="off"></label>
      <label>Notes (optional)<textarea name="notes" rows="2"></textarea></label>
      <button class="save">Add task</button>
    </form></dialog>

    <dialog class="sheet tl" data-sheet="newq"><form data-act="new-question" novalidate>
      <div class="sheet-head"><h2>New question</h2><button type="button" class="link" data-act="close">Close</button></div>
      <label>Question<input name="title" autocomplete="off" aria-required="true"></label>
      <button class="save">Add question</button>
    </form></dialog>

    <dialog class="sheet tl" data-sheet="task"><form novalidate></form></dialog>`;
  wire();
  await load(true); // paint from the phone's copy first
  load();

  channel?.unsubscribe();
  channel = sb.channel('tasks').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
    .subscribe(st => st === 'SUBSCRIBED' && load());
  // Realtime is best effort: reload when the channel (re)joins, and poll while the screen is open.
  clearInterval(poll);
  poll = setInterval(() => document.visibilityState === 'visible' && !root.hidden && navigator.onLine && load(), 15_000);
  addEventListener('pulse:synced', () => load());
  addEventListener('pulse:refresh', () => load());
}

async function load(first = false) {
  const mine = ++loads; // only the newest reload may paint
  try {
    const [server, ops] = await Promise.all([cachedRows('tasks', sb.from('tasks').select('*').is('deleted_at', null), first), pending()]);
    if (mine !== loads) return;
    list = overlay(server, [...ops, ...inflight], 'tasks').filter(t => !t.deleted_at).sort((a, b) => (a.created_at ?? '~').localeCompare(b.created_at ?? '~'));
    paintEntry();
    paintResults();
  } catch (e) {
    if (!(first && e.message === 'nocache')) toast(e.message, 'bad');
  }
}

const fillPhotos = scope =>
  scope.querySelectorAll('a[data-path]:not([href])').forEach(async a => {
    const url = await photoUrl(a.dataset.path);
    if (!url) return;
    a.href = url;
    a.querySelector('img').src = url;
  });

// ── To do list ───────────────────────────────────────────────────
function row(t) {
  const done = t.status === 'done';
  const sub = t.notes ? `<small>${esc(t.notes)}</small>` : '';
  return `<div class="tl-row${done ? ' done' : ''}" data-id="${t.id}">
    <label class="tl-tick"><input type="checkbox" data-act="toggle" ${done ? 'checked' : ''} aria-label="${esc(t.title)} ${t.kind === 'question' ? 'asked' : 'done'}"></label>
    <button type="button" class="tl-body" data-act="open"><span class="tl-main"><span class="tl-name">${esc(t.title)}</span>${sub}</span>${CHEV}</button></div>`;
}

const nothing = text => `<p class="tl-empty">${text}</p>`;

function paintEntry() {
  const open = list.filter(t => t.status === 'open' && t.kind === 'generic');
  const done = list.filter(t => t.status === 'done' && t.kind === 'generic').reverse();
  const qs = list.filter(t => t.kind === 'question');
  const asked = qs.filter(t => t.status === 'done').reverse();
  const openQs = qs.filter(t => t.status === 'open');
  const out = n => root.querySelector(`[data-out=${n}]`);
  out('questions').innerHTML = (openQs.map(row).join('') || nothing('No questions yet. Add one anytime.')) + addRow('add-question', 'Add question');
  out('asked').innerHTML = asked.map(row).join('');
  out('asked-count').textContent = asked.length || '';
  out('asked').closest('details').hidden = !asked.length;
  out('open').innerHTML = (open.map(row).join('') || nothing('Nothing to do. All caught up.')) + addRow('add-task', 'Add task');
  out('done').innerHTML = done.map(row).join('');
  out('done-count').textContent = done.length || '';
  out('done').closest('details').hidden = !done.length;
}

async function save({ pending, ...row }) { // `pending` is only a display flag from overlay()
  await upsert('tasks', { user_id: uid, ...row });
  await load();
}

async function paintAndSave({ pending, ...row }) {
  const op = { kind: 'upsert', table: 'tasks', row: { user_id: uid, status: 'open', ...row } };
  inflight.add(op);
  list = overlay(list, [op], 'tasks');
  loads++; // a reload already in flight read the old state
  paintEntry();
  paintResults();
  buzz();
  saving = saving.catch(() => {}).then(() => upsert('tasks', op.row));
  try {
    await saving;
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    inflight.delete(op);
    load();
  }
}

function openTask(id) {
  const t = byId(id);
  if (!t) return;
  openId = id;
  const dlg = root.querySelector('[data-sheet=task]');
  const form = dlg.querySelector('form');
  const done = t.status === 'done';
  const today = localDate(new Date());
  form.innerHTML = t.kind === 'question' ? `
    <div class="sheet-head"><h2>Question</h2><button type="button" class="link" data-act="close">Close</button></div>
    <label>Question<input name="title" value="${esc(t.title)}" autocomplete="off"></label>
    <label>Answer<textarea name="notes" rows="4">${esc(t.notes)}</textarea></label>
    <button class="save">Save</button>
    <label class="asked-toggle"><span>Asked the doctor</span><input type="checkbox" data-act="asked" ${done ? 'checked' : ''}></label>
    <button type="button" class="link bad" data-act="remove">Delete</button>`
  : t.kind === 'test' ? `
    <div class="sheet-head"><h2>${esc(t.title)}</h2><button type="button" class="link" data-act="close">Close</button></div>
    ${t.retest_of ? '<p class="muted">Retest. The earlier result stays in the history.</p>' : ''}
    <div class="fields">${field('value', `Result (${esc(t.unit) || 'value'})`, 'min="0" max="100000" maxlength="8"')}</div>
    ${pad(true)}
    <label class="when"><span>Test date</span><input type="date" name="test_date" max="${today}" value="${t.test_date ?? today}"></label>
    <div class="thumbs">${thumbs(t)}</div>
    <label class="btn ghost"><input type="file" name="photo" accept="image/*" multiple hidden>Add report photo</label>
    <details class="more-fields"${t.notes ? ' open' : ''}><summary>Unit and notes</summary>
      <label>Unit<input name="unit" value="${esc(t.unit)}" autocomplete="off"></label>
      <label>Notes<textarea name="notes" rows="2">${esc(t.notes)}</textarea></label></details>
    <button class="save">Save result</button>
    <button type="button" class="link bad" data-act="remove">Remove</button>`
  : `
    <div class="sheet-head"><h2>${esc(t.title)}</h2><button type="button" class="link" data-act="close">Close</button></div>
    <label>Notes<textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
    <button class="save">Save</button>
    <button type="button" class="link bad" data-act="remove">Remove task</button>`;
  const value = form.querySelector('[name=value]');
  if (value) value.value = t.value != null ? Number(t.value) : '';
  setActive(form, value);
  fillPhotos(form);
  dlg.showModal();
}

async function saveTask(form, dlg) {
  const t = byId(openId);
  const f = new FormData(form);
  try {
    if (t.kind === 'question') {
      const title = f.get('title').trim();
      if (!title) return toast('Write the question first', 'bad');
      await save({ ...t, title, notes: f.get('notes').trim() || null });
      buzz();
      const btn = form.querySelector('.save');
      btn.textContent = 'Saved ✓';
      setTimeout(() => (btn.textContent = 'Save'), 2000);
      return;
    }
    if (t.kind === 'generic') {
      await save({ ...t, notes: f.get('notes').trim() || null });
    } else {
      const problem = fieldProblem(form);
      if (problem) return toast(problem, 'bad');
      const value = f.get('value') === '' ? null : Number(f.get('value'));
      // A result means the test is done; he should not have to tick it as well.
      await save({ ...t, value, test_date: f.get('test_date') || null, unit: f.get('unit').trim() || null,
        notes: f.get('notes').trim() || null, status: value == null ? t.status : 'done' });
    }
    dlg.close();
    buzz();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function wire() {
  const sheet = name => root.querySelector(`[data-sheet=${name}]`);
  const pick = sheet('pick');
  pick.onclose = () => {
    const code = pick.returnValue;
    pick.returnValue = '';
    if (code === 'other') return newTest.reset(), sheet('newtest').showModal(), newTest.elements.title.focus();
    if (code) paintAndSave({ id: crypto.randomUUID(), kind: 'test', test_code: code, ...TESTS[code] });
  };
  const newTest = sheet('newtest').querySelector('form');
  newTest.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(newTest);
    const title = f.get('title').trim();
    if (!title) return toast('Write the test name first', 'bad');
    sheet('newtest').close();
    paintAndSave({ id: crypto.randomUUID(), kind: 'test', test_code: null, title, unit: f.get('unit').trim() || null });
  };
  const newTask = sheet('new').querySelector('form');
  newTask.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(newTask);
    busy(newTask.querySelector('.save'), async () => {
      try {
        await save({ id: crypto.randomUUID(), kind: 'generic', title: f.get('title').trim(), notes: f.get('notes').trim() || null });
        sheet('new').close();
        buzz();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  };

  const newQ = sheet('newq').querySelector('form');
  newQ.onsubmit = e => {
    e.preventDefault();
    const title = new FormData(newQ).get('title').trim();
    if (!title) return toast('Write the question first', 'bad');
    sheet('newq').close();
    paintAndSave({ id: crypto.randomUUID(), kind: 'question', title, notes: null });
  };

  const taskForm = sheet('task').querySelector('form');
  taskForm.onsubmit = e => (e.preventDefault(), busy(taskForm.querySelector('.save'), () => saveTask(taskForm, sheet('task'))));
  bindKeypad(taskForm);
  taskForm.addEventListener('change', async e => {
    if (e.target.name !== 'photo' || !e.target.files.length) return;
    const t = byId(openId);
    try {
      toast('Saving photo…');
      const paths = [];
      for (const file of e.target.files) {
        const path = `${uid}/tasks/${t.id}/${crypto.randomUUID()}.jpg`;
        await uploadPhoto(path, await shrink(file, 2000)); // reports need readable text
        paths.push(path);
      }
      await save({ ...byId(t.id), photo_paths: [...photos(byId(t.id)), ...paths] });
      taskForm.querySelector('.thumbs').innerHTML = thumbs(byId(t.id));
      fillPhotos(taskForm);
      hideToast(); // the thumbnails appearing say it is saved
      buzz();
    } catch (err) {
      toast(err.message, 'bad');
    }
    e.target.value = '';
  });

  root.addEventListener('change', async e => {
    if (e.target.dataset.act === 'asked') return paintAndSave({ ...byId(openId), status: e.target.checked ? 'done' : 'open' });
    if (e.target.dataset.act !== 'toggle') return;
    paintAndSave({ ...byId(e.target.closest('[data-id]').dataset.id), status: e.target.checked ? 'done' : 'open' });
  });

  root.addEventListener('click', async e => {
    const tile = e.target.closest('[data-test]');
    if (tile) return showHistory(tile.dataset.test); // detail sheet: history and Add result
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-test') return pick.showModal();
    if (act === 'add-question') return newQ.reset(), sheet('newq').showModal(), newQ.elements.title.focus();
    if (act === 'add-task') return newTask.reset(), sheet('new').showModal(), newTask.elements.title.focus();
    if (act === 'add-result') { // a due test already has its open row; a finished one starts a retest row
      const g = list.filter(t => t.kind === 'test' && groupKey(t) === sheet('history').dataset.code).sort(newestFirst);
      const due = g.find(t => t.status === 'open');
      if (due) return openTask(due.id);
      const last = g[0];
      const id = crypto.randomUUID();
      paintAndSave({ id, kind: 'test', title: last.title, test_code: last.test_code, unit: last.unit, retest_of: last.id });
      return openTask(id);
    }
    if (act === 'close') return e.target.closest('dialog').close();
    if (act === 'open') return openTask(e.target.closest('[data-id]').dataset.id);
    const t = openId && byId(openId);
    if (!t || !sheet('task').open) return;
    const btn = e.target.closest('button');
    const run = fn => busy(btn, async () => {
      try {
        await fn();
        sheet('task').close();
        buzz();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    if (act === 'remove' && confirm(`Remove “${t.title}”?`)) run(async () => {
      await patch('tasks', t.id, { deleted_at: new Date().toISOString() });
      await load();
    });
  });
}

// ── Results: one row per test, history in a detail sheet ───────────────────────
const groupKey = t => t.test_code ?? t.title;
const newestFirst = (a, b) => (b.test_date ?? '9999').localeCompare(a.test_date ?? '9999') || (b.created_at ?? '~').localeCompare(a.created_at ?? '~');
const shortDay = ymd => new Date(`${ymd}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
const withUnit = (v, unit) => `${Number(v)}${unit ? `<small> ${esc(unit)}</small>` : ''}`;
const hasResult = t => t.value != null;

// "↑ 3 since 3 Aug" against the result before this one.
function change(last, prev) {
  if (!prev) return '';
  const diff = Math.round((last.value - prev.value) * 100) / 100;
  return diff === 0 ? 'same as before' : `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)} since ${prev.test_date ? shortDay(prev.test_date) : 'last time'}`;
}

function testRow(code) {
  const g = list.filter(t => t.kind === 'test' && groupKey(t) === code).sort(newestFirst);
  const [last, prev] = g.filter(hasResult);
  const due = g.some(t => t.status === 'open');
  const when = last?.test_date ? fmtDay(last.test_date) : '';
  const sub = due ? `<span class="tl-due">Due</span>${last ? ` · last done ${last.test_date ? shortDay(last.test_date) : 'before'}` : ' · add the first result'}`
    : last ? [when, change(last, prev)].filter(Boolean).join(' · ') || 'Done' : 'Done';
  return { due, html: `<button type="button" class="tl-line" data-test="${esc(code)}">
    <span class="tl-main"><span class="tl-name">${esc(g[0].title)}</span><small>${sub}</small></span>
    ${last ? `<span class="tl-val num-r">${withUnit(last.value, last.unit)}</span>` : ''}${CHEV}</button>` };
}

function paintResults() {
  const rows = [...new Set(list.filter(t => t.kind === 'test').map(groupKey))].map(testRow);
  const dueRows = rows.filter(r => r.due), rest = rows.filter(r => !r.due);
  const out = n => root.querySelector(`[data-out=${n}]`);
  out('due-sec').hidden = !dueRows.length;
  out('due').innerHTML = dueRows.map(r => r.html).join('');
  out('tests').innerHTML = (rest.map(r => r.html).join('') || nothing('No results yet. A finished test shows here.')) + addRow('add-test', 'Add test');
  const dlg = root.querySelector('[data-sheet=history]');
  if (dlg.open) showHistory(dlg.dataset.code);
}

// Result history as an inline SVG: one thin line, small points, first and last value labelled, dates under the ends.
function chart(results) { // oldest first, at least two
  const W = 326, H = 140, L = 8, R = W - 8, top = 36, bot = 96;
  const t = ymd => new Date(`${ymd}T00:00`).getTime();
  const dated = results.every(r => r.test_date);
  const xs = results.map((r, i) => dated ? t(r.test_date) : i);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const vs = results.map(r => Number(r.value));
  const [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  const px = (x, i) => L + (x1 === x0 ? (R - L) * (i / Math.max(1, xs.length - 1)) : ((x - x0) / (x1 - x0)) * (R - L));
  const py = v => hi === lo ? (top + bot) / 2 : bot - ((v - lo) / (hi - lo)) * (bot - top);
  const pts = results.map((r, i) => [px(xs[i], i), py(vs[i])]);
  const [first, last] = [pts[0], pts.at(-1)];
  const yr = d => new Date(`${d}T00:00`).getFullYear();
  const day = r => !r.test_date ? '' : yr(results[0].test_date) === yr(results.at(-1).test_date) ? shortDay(r.test_date) : fmtDay(r.test_date);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Results over time: ${vs.join(', ')}">
    <line x1="${L}" x2="${R}" y1="${bot + 8}" y2="${bot + 8}" class="axis"/>
    <polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" class="ln"/>
    ${pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="pt"/>`).join('')}
    <text x="${first[0]}" y="${first[1] - 12}" class="val">${vs[0]}</text>
    <text x="${last[0]}" y="${last[1] - 12}" class="val" text-anchor="end">${vs.at(-1)}</text>
    <text x="${L}" y="${H - 8}">${day(results[0])}</text><text x="${R}" y="${H - 8}" text-anchor="end">${day(results.at(-1))}</text></svg>`;
}

// Full history of one test, newest first, with report photos.
function showHistory(code) {
  const g = list.filter(t => t.kind === 'test' && groupKey(t) === code).sort(newestFirst);
  if (!g.length) return;
  const dlg = root.querySelector('[data-sheet=history]');
  dlg.dataset.code = code;
  root.querySelector('[data-out=history-title]').textContent = g[0].title;
  const results = g.filter(t => hasResult(t) || t.status === 'done');
  const [last, prev] = results.filter(hasResult);
  const due = g.some(t => t.status === 'open');
  const hero = last ? `<div class="tl-hero"><div class="tl-big num-r">${withUnit(last.value, last.unit)}</div>
    <p class="tl-sub">${due ? '<span class="tl-due">Due</span> · ' : ''}${[last.test_date ? fmtDay(last.test_date) : '', change(last, prev)].filter(Boolean).join(' · ')}</p></div>` : '';
  const plot = results.filter(hasResult);
  const pic = plot.length > 1 ? `<div class="tl-chart">${chart([...plot].reverse())}</div>` : '';
  const hist = results.length ? `<h3 class="tl-h">History</h3><div class="tl-list">${results.map(t => `<div class="tl-item">
    <button type="button" class="tl-line" data-act="open" data-id="${t.id}">
      <span class="tl-main"><span class="tl-name">${t.test_date ? fmtDay(t.test_date) : 'Date not set'}</span>${t.notes ? `<small>${esc(t.notes)}</small>` : ''}</span>
      ${hasResult(t) ? `<span class="tl-val num-r">${withUnit(t.value, t.unit)}</span>` : ''}${CHEV}</button>
    ${photos(t).length ? `<div class="thumbs tl-photos">${thumbs(t)}</div>` : ''}</div>`).join('')}</div>`
    : `<div class="tl-list">${nothing('No results yet. Add the first one below.')}</div>`;
  root.querySelector('[data-out=history]').innerHTML = hero + pic + hist;
  fillPhotos(dlg);
  if (!dlg.open) dlg.showModal();
}
