// Father's "Today" screen: four vital tiles, medicines, meal photos. Entry happens in sheets that are
// built once; load() repaints only [data-out] regions, so a realtime update never wipes a half-typed number.
import { sb, upsert, patch, cachedRows, pending, uploadFile, photoUrl } from './db.js';
import { voiceSupported, startRecording, audioExt } from './voice.js';
import { overlay } from './overlay.js';
import { localDate, toLocalInput, slotFor, mealFor, MED_SLOTS, medOn } from './slots.js';
import { bpLevel, sugarLevel, LEVEL_WORD } from './ranges.js';
import { STEPS_TARGET, REQUIRED_METRICS, STOOL_MAX, INSULIN_DEFAULT } from './config.js';
import { esc, hhmm, toast, shrink, buzz, busy } from './ui.js';
import { field, pad, setActive, bindKeypad, fieldProblem } from './keypad.js';
import { ICONS } from './icons.js';

let uid, names = {}, root, state, channel, poll, loads = 0;
let ready = false; // true once a load (phone copy or network) has painted; counters and ticks wait for it
// Taps paint before the network answers; these writes lie over every load until they land.
const inflight = new Set();
let saving = Promise.resolve(); // one write at a time, so a double tap lands in tap order
let viewDay = null; // YYYY-MM-DD being shown; null = today (follows the clock past midnight)
const dayOf = () => viewDay ?? localDate(new Date());
const parseDay = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };

// Time only (date = today): a datetime field is too wide for small phones and rarely needed.
const when = () => `<label class="when"><span>Time</span><input name="time" type="time" required></label>`;

const SHEETS = {
  bp: { title: 'Blood pressure', save: 'Save BP', decimal: false, time: true, body:
    field('systolic', 'Upper', 'min="50" max="260" maxlength="3" required') +
    field('diastolic', 'Lower', 'min="30" max="180" maxlength="3" required') +
    field('pulse', 'Pulse', 'min="20" max="250" maxlength="3"') },
  sugar: { title: 'Sugar', save: 'Save sugar', decimal: false, time: true, body:
    field('value', 'mg/dL', 'min="20" max="600" maxlength="3" required'),
    after: `<div class="seg wide" role="radiogroup" aria-label="When">
      <label><input type="radio" name="context" value="fasting" required>Fasting</label>
      <label><input type="radio" name="context" value="post_meal">After meal</label>
      <label><input type="radio" name="context" value="random">Random</label></div>` },
  weight: { title: 'Weight', save: 'Save weight', decimal: true, body: field('value', 'kg', 'min="20" max="250" maxlength="5" required') +
    '<button type="button" class="ghost quick" data-act="same-weight" hidden></button>' },
  steps: { title: 'Steps', save: 'Save steps', decimal: false, body: field('value', 'Steps today', 'min="0" max="100000" maxlength="6" required') },
};
const TILES = [['bp', 'Blood pressure'], ['sugar', 'Sugar'], ['steps', 'Steps'], ['weight', 'Weight']];
const UNITS = { bp: 'mmHg', sugar: 'mg/dL', steps: '', weight: 'kg' };
// Daily counters, stored as readings (slot 'day', value = count). Stool above STOOL_MAX a day is flagged.
const COUNTERS = [['stool', 'Stool', `max ${STOOL_MAX} a day`], ['urine_night', 'Night urine', 'times up at night'], ['insulin', 'Insulin', 'units']];
const COUNT_MAX = { insulin: 100 }; // everything else counts 0..20
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['snack', 'Snack'], ['dinner', 'Dinner']];

const SHELL = `
  <header class="today-head">
    <button type="button" class="nav" data-step="-1" aria-label="Previous day">‹</button>
    <label class="day-pick"><h1 data-out="title">Today</h1><span class="muted" data-out="date"></span>
      <input type="date" name="day" aria-label="Choose a day"></label>
    <button type="button" class="nav" data-step="1" aria-label="Next day">›</button>
  </header>
  <button type="button" class="back-today" data-act="today" hidden>Back to today</button>

  <h2 class="sec-h">Readings</h2>
  <section class="vlist">${TILES.map(([k, name]) => `
    <button type="button" class="vrow" data-open="${k}">
      <span class="vic vic-${k}" aria-hidden="true">${ICONS[k]}</span>
      <span class="vtx"><span class="vname">${name}</span><span class="vnote" data-out="${k}-note"></span></span>
      <span class="vval"><b class="num" data-out="${k}"></b>${UNITS[k] ? `<small>${UNITS[k]}</small>` : ''}</span>
    </button>`).join('')}
  </section>

  <h2 class="sec-h">Medicines <span>Tap after you take them</span></h2>
  <section class="meds3" role="group" aria-label="Medicines taken">${MED_SLOTS.map(([k, n]) => `
    <button type="button" class="med" data-med="${k}" aria-pressed="false" aria-label="${n} medicines">
      <span class="med-ic" aria-hidden="true">${ICONS[k]}</span><span class="med-name">${n}</span>
      <span class="med-state">Not yet</span></button>`).join('')}
  </section>

  <h2 class="sec-h">Meals</h2>
  <section class="vlist checks">
    <div class="mrows" data-out="meal-rows"></div>
    <button type="button" class="vrow" data-act="diet">
      <span class="vic vic-diet" aria-hidden="true">${ICONS.camera}</span>
      <span class="vtx"><span class="vname">Add meal</span><span class="vnote">Photo, voice note or just ate</span></span>
      <span class="vadd" aria-hidden="true">+</span>
    </button>
  </section>

  <h2 class="sec-h">Daily counts</h2>
  <section class="vlist">${COUNTERS.map(([k, name, note]) => `
    <div class="vrow counter" data-counter="${k}">
      <span class="vic vic-${k}" aria-hidden="true">${ICONS[k]}</span>
      <span class="vtx"><span class="vname">${name}</span><span class="vnote" data-out="${k}-note">${note}</span></span>
      <span class="stepper"><button type="button" data-count="${k}" data-by="-1" aria-label="One less ${name}">−</button>
        <b class="num" data-out="${k}">0</b>
        <button type="button" data-count="${k}" data-by="1" aria-label="One more ${name}">+</button></span>
    </div>`).join('')}
  </section>

  <h2 class="sec-h">Remarks</h2>
  <section class="remarks">
    <textarea name="remark" rows="3" maxlength="2000" placeholder="Anything about this day" aria-label="Remarks for this day"></textarea>
    <button type="button" class="save" data-act="save-remark" disabled>Save</button>
  </section>

  ${Object.entries(SHEETS).map(([k, s]) => `
  <dialog class="sheet" data-sheet="${k}">
    <form data-metric="${k}" novalidate>
      <div class="sheet-head"><span></span><h2>${s.title}</h2><button type="button" class="link" data-act="close">Close</button></div>
      <div class="entries" data-out="entries" hidden></div>
      <div class="fields">${s.body}</div>
      ${s.after ?? ''}
      ${s.time ? when() : ''}
      ${pad(s.decimal)}
      <button class="save">${s.save}</button>
    </form>
  </dialog>`).join('')}

  <dialog id="meal-sheet" class="sheet">
    <div class="sheet-head"><span></span><h2 data-out="meal-title"></h2><button type="button" class="link" data-act="meal-close">Close</button></div>
    <div class="meal-items" data-out="meal-items"></div>
    <div class="recorder" hidden>
      <p class="rec-state"><span class="rec-dot"></span><span data-out="rec-time">Recording 0:00</span></p>
      <button type="button" data-act="rec-stop">Stop</button>
      <audio controls hidden></audio>
      <div class="row2" hidden><button type="button" class="ghost" data-act="rec-discard">Discard</button><button type="button" data-act="rec-save">Save voice note</button></div>
    </div>
    <div class="group meal-actions">
      <label class="row action"><span class="ric">${ICONS.camera}</span>Take photo<input type="file" name="camera" accept="image/*" capture="environment" hidden></label>
      <label class="row action"><span class="ric">${ICONS.library}</span>Choose from photos<input type="file" name="library" accept="image/*" hidden></label>
      <button type="button" class="row action" data-act="voice"><span class="ric">${ICONS.mic}</span>Record voice note</button>
      <button type="button" class="row action" data-act="eaten"><span class="ric">${ICONS.tick}</span>Ate it, no photo</button>
    </div>
  </dialog>

  <dialog id="photo-viewer" class="pv" aria-label="Meal photo">
    <div class="pv-top"><span></span><h2 data-out="pv-title"></h2><button type="button" class="link" data-act="pv-close">Close</button></div>
    <div class="pv-img"><img alt=""></div>
    <div class="pv-foot"><button type="button" class="pv-del" data-act="pv-del">Delete photo</button></div>
  </dialog>`;

export async function mountToday(el, profile) {
  uid = profile.owner; // every reading belongs to Papa, whichever phone types it
  names = profile.names ?? {};
  root = el;
  root.innerHTML = SHELL;
  resetTimes();
  root.querySelectorAll('form[data-metric]').forEach(wireSheet);
  root.querySelectorAll('[data-open]').forEach(t => (t.onclick = () => openSheet(t.dataset.open)));
  root.querySelectorAll('[data-step]').forEach(b => (b.onclick = () => {
    const d = parseDay(dayOf());
    d.setDate(d.getDate() + Number(b.dataset.step));
    goTo(localDate(d));
  }));
  root.querySelector('[name=day]').onchange = e => e.target.value && goTo(e.target.value);
  root.querySelector('[data-act=today]').onclick = () => goTo(null);
  addEventListener('pulse:open-day', e => goTo(e.detail)); // Summary: a calendar day or alert opens that day here
  wireMealSheet();
  root.querySelectorAll('[data-med]').forEach(b => (b.onclick = () => toggleMed(b.dataset.med)));
  root.querySelectorAll('[data-count]').forEach(b => (b.onclick = () => bumpCount(b.dataset.count, Number(b.dataset.by))));
  const remark = root.querySelector('[name=remark]');
  remark.oninput = paintRemark;
  root.querySelector('[data-act=save-remark]').onclick = e => busy(e.currentTarget, saveRemark);
  root.querySelector('[data-act=diet]').onclick = () => openMeal(mealFor(new Date()));
  wireMealRows();
  state = { day: dayOf(), readings: [], meals: [], checks: [], notes: [], insulinBefore: [] };
  paint(); // empty shell at once, so a tap before the first load cannot hit an undefined state
  root.classList.add('loading'); // rows are dimmed and locked until a load (phone copy or network) arrives
  await load(true); // paint from the phone's copy first; the network answer follows
  load();

  // Both phones subscribe, so a save on one repaints the other.
  channel?.unsubscribe();
  channel = sb.channel('today');
  for (const table of ['readings', 'meals', 'daily_check', 'day_note'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => load());
  channel.subscribe(st => st === 'SUBSCRIBED' && load());
  // Realtime is best effort: reload when the channel (re)joins, and poll while the screen is open.
  clearInterval(poll);
  poll = setInterval(() => document.visibilityState === 'visible' && !root.hidden && navigator.onLine && load(), 15_000);
  // A sleeping phone misses realtime events; reload when it wakes.
  document.onvisibilitychange = () => document.visibilityState === 'visible' && (resetTimes(), load());
  // Queue changes (offline save, sync done) repaint at once.
  addEventListener('pulse:queue', () => load());
  addEventListener('pulse:synced', () => load());
  addEventListener('pulse:refresh', () => load());
}

function resetTimes() {
  const now = new Date();
  root.querySelectorAll('[name=time]').forEach(i => (i.value = toLocalInput(now).slice(11)));
}

function goTo(ymd) {
  const today = localDate(new Date());
  viewDay = !ymd || ymd >= today ? null : ymd;
  scrollTo(0, 0);
  paintHead(dayOf());
  root.classList.add('loading'); // dims and locks the old day's rows until the new day arrives
  load();
}

// A day never opened on this phone has no stored copy; show nothing for it instead of failing the whole paint.
const softRows = (key, query, first) => cachedRows(key, query, first).catch(e => { if (e.message === 'nocache') return []; throw e; });

async function load(first = false) {
  const day = dayOf();
  const mine = ++loads; // reloads can finish out of order; only the newest may paint
  try {
    const [readings, meals, queued, lastWeight, checks, insulinBefore, notes] = await Promise.all([
      cachedRows('today:readings', sb.from('readings').select('*').eq('slot_date', day).is('deleted_at', null), first),
      cachedRows('today:meals', sb.from('meals').select('*').eq('slot_date', day).is('deleted_at', null), first),
      pending(),
      cachedRows('today:lastweight', sb.from('readings').select('value').eq('metric', 'weight').is('deleted_at', null)
        .order('taken_at', { ascending: false }).limit(1), first),
      cachedRows('today:checks', sb.from('daily_check').select('*').eq('day', day).is('deleted_at', null), first),
      // Insulin carries forward: the latest dose on or before the shown day (the day's own row included).
      cachedRows(`today:insulin:${day}`, sb.from('readings').select('*').eq('metric', 'insulin').is('deleted_at', null)
        .lte('slot_date', day).order('slot_date', { ascending: false }).limit(1), first)
        .catch(e => { if (e.message === 'nocache') return null; throw e; }),  // unknown, never "16"
      softRows(`today:note:${day}`, sb.from('day_note').select('*').eq('day', day).is('deleted_at', null), first),
    ]);
    if (mine !== loads) return;
    ready = true;
    const ops = [...queued, ...inflight];
    const live = r => !r.deleted_at && (r.slot_date ?? day) === day; // cache may hold yesterday
    const by = k => (a, b) => a[k].localeCompare(b[k]);
    state = {
      day,
      readings: overlay(readings, ops, 'readings').filter(live).sort(by('taken_at')),
      meals: overlay(meals, ops, 'meals').filter(live).sort(by('eaten_at')),
      lastWeight: lastWeight[0]?.value,
      checks: overlay(checks, ops, 'daily_check').filter(c => c.day === day),
      notes: overlay(notes, ops, 'day_note').filter(n => n.day === day && !n.deleted_at),
      insulinBefore: insulinBefore && overlay(insulinBefore, ops, 'readings').filter(r => r.metric === 'insulin' && !r.deleted_at && r.slot_date <= day),
    };
    paint();
  } catch (e) {
    console.error(e);
    if (state && state.day !== dayOf()) (viewDay = state.day >= localDate(new Date()) ? null : state.day), paintHead(state.day); // still showing that day
    if (!(first && e.message === 'nocache')) toast(e.message, 'bad');
  } finally {
    if (mine === loads && (ready || !first)) root.classList.remove('loading');
  }
}

// The day title, date and nav state. Called at once on a day change; the rows follow when the day loads.
function paintHead(day) {
  const out = k => root.querySelector(`[data-out=${k}]`);
  const now = new Date();
  const shown = parseDay(day);
  const isToday = !viewDay;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  out('title').textContent = isToday ? 'Today' : localDate(yesterday) === day ? 'Yesterday'
    : shown.toLocaleDateString([], { weekday: 'long' });
  out('date').textContent = shown.toLocaleDateString([], { day: 'numeric', month: 'long', ...(shown.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
  const picker = root.querySelector('[name=day]');
  picker.max = localDate(now);
  picker.value = day;
  root.querySelector('[data-step="1"]').disabled = isToday;
  root.querySelector('[data-act=today]').hidden = isToday;
  root.classList.toggle('past', !isToday);
}

function paint() {
  const { readings, meals } = state;
  const out = k => root.querySelector(`[data-out=${k}]`);
  const of = m => readings.filter(r => r.metric === m);
  const tile = k => root.querySelector(`[data-open=${k}]`);
  const isToday = !viewDay;
  paintHead(state.day);

  // Each vital tile: latest value big, the rest of today small, colour by level.
  const show = (k, list, value, level, note) => {
    const last = list.at(-1);
    tile(k).className = `vrow${last ? ' done' : ''}${last?.pending ? ' pending' : ''}${level ? ` lvl-${level}` : ''}`;
    out(k).textContent = last ? value(last) : 'Add';
    out(`${k}-note`).textContent = last ? note(last, list) : isToday ? 'Not yet today' : 'Nothing saved';
  };
  const earlier = (list, fmt) => (list.length > 1 ? ` · earlier ${list.slice(0, -1).map(fmt).join(', ')}` : '');
  const pend = r => (r.pending ? ' · waiting to send' : '') + by(r);
  const bps = of('bp');
  const lastBp = bps.at(-1);
  show('bp', bps, r => `${r.systolic}/${r.diastolic}`, lastBp && bpLevel(lastBp.systolic, lastBp.diastolic),
    r => `${LEVEL_WORD[bpLevel(r.systolic, r.diastolic)]} · ${hhmm(r.taken_at)}${pend(r)}${earlier(bps, x => `${x.systolic}/${x.diastolic}`)}`);
  const sugars = of('sugar');
  const lastSugar = sugars.at(-1);
  show('sugar', sugars, r => Number(r.value), lastSugar && sugarLevel(lastSugar.value, lastSugar.sugar_context),
    r => `${LEVEL_WORD[sugarLevel(r.value, r.sugar_context)]} · ${r.sugar_context.replace('_', ' ')} · ${hhmm(r.taken_at)}${pend(r)}${earlier(sugars, x => Number(x.value))}`);
  show('weight', of('weight'), r => Number(r.value), null, r => `${hhmm(r.taken_at)}${pend(r)}`);
  const steps = Number(of('steps').at(-1)?.value ?? 0);
  show('steps', of('steps'), r => Number(r.value).toLocaleString(), steps >= STEPS_TARGET ? 'ok' : null,
    r => `of ${STEPS_TARGET.toLocaleString()}${pend(r)}`);
  tile('steps').style.setProperty('--progress', `${Math.min(100, (steps / STEPS_TARGET) * 100)}%`);

  // Daily counters: a number and − / + buttons. Stool above the daily maximum turns red.
  for (const [k, , note] of COUNTERS) {
    if (k === 'insulin') continue;
    const n = Number(of(k).at(-1)?.value ?? 0);
    const over = k === 'stool' && n > STOOL_MAX;
    out(k).textContent = n;
    out(`${k}-note`).textContent = over ? `Above ${STOOL_MAX} today` : note;
    root.querySelector(`[data-counter=${k}]`).className = `vrow counter${n ? ' done' : ''}${over ? ' lvl-high' : ''}`;
  }

  const dose = insulinNow();
  out('insulin').textContent = dose.value ?? '–';
  out('insulin-note').textContent = dose.value == null ? 'units · loading' : `units · ${dose.set ? 'set today' : 'as before'}`;
  root.querySelector('[data-counter=insulin]').className = `vrow counter${dose.set ? ' done' : ''}`;
  paintRemark(true);

  // Medicines: morning, afternoon, evening switches.
  root.querySelectorAll('[data-med]').forEach(b => {
    const on = medOn(state.checks, state.day, b.dataset.med);
    b.classList.toggle('done', on);
    b.setAttribute('aria-pressed', on);
    b.querySelector('.med-state').textContent = on ? 'Taken ✓' : 'Not yet';
  });
  paintMealRows();
  if (root.querySelector('#meal-sheet').open) paintMealSheet();
  paintEntries();

}

// Insulin shown for the day: its own row, else the latest earlier dose, else the default.
function insulinNow() {
  const own = state.readings.filter(r => r.metric === 'insulin').at(-1);
  if (own) return { value: Number(own.value), set: true };
  // Earlier doses not loaded yet: no number, and − / + wait. A guessed 16 would be saved over the real dose.
  if (!state.insulinBefore) return { value: null, set: false };
  const last = state.insulinBefore.filter(r => r.slot_date < state.day).sort((a, b) => a.slot_date.localeCompare(b.slot_date)).at(-1);
  return { value: last ? Number(last.value) : INSULIN_DEFAULT, set: false };
}

// Remarks: the box is built once so a reload never wipes typing. It follows the stored text only while it is unedited.
let remarkDay = null, remarkStored = '';
function paintRemark(fromLoad) {
  const ta = root.querySelector('[name=remark]');
  const btn = root.querySelector('[data-act=save-remark]');
  if (fromLoad === true) {
    const stored = state.notes[0]?.body ?? '';
    // The day changed (arrows, date picker, midnight) with typed text not saved: keep it on the day it was typed for.
    if (remarkDay && remarkDay !== state.day && ta.value !== remarkStored) keepRemark(remarkDay, ta.value.trim());
    if (remarkDay !== state.day || ta.value === remarkStored) ta.value = stored;
    remarkDay = state.day;
    remarkStored = stored;
  }
  if (!btn.classList.contains('saved')) btn.textContent = 'Save';
  btn.disabled = ta.value === remarkStored && !btn.classList.contains('saved');
}

function keepRemark(day, body) {
  const op = { kind: 'upsert', table: 'day_note', row: { user_id: uid, day, body, deleted_at: null } };
  const name = parseDay(day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  inflight.add(op); // coming back to that day before the save lands still shows the text
  saving = saving.catch(() => {}).then(() => upsert('day_note', op.row, 'user_id,day'));
  saving.then(() => (buzz(), toast(`Remark saved for ${name}`)),
              e => toast(`Remark for ${name} not saved: ${e.message}`, 'bad'))
    .finally(() => inflight.delete(op));
}

async function saveRemark() {
  if (!ready || state.day !== dayOf()) return;
  const ta = root.querySelector('[name=remark]');
  const btn = root.querySelector('[data-act=save-remark]');
  const body = ta.value.trim();
  const op = { kind: 'upsert', table: 'day_note', row: { user_id: uid, day: state.day, body, deleted_at: null } };
  btn.textContent = 'Saving…';
  buzz();
  inflight.add(op);
  state.notes = overlay(state.notes, [op], 'day_note');
  loads++; // a load already in flight read the old text
  saving = saving.catch(() => {}).then(() => upsert('day_note', op.row, 'user_id,day'));
  try {
    await saving;
    ta.value = body;
    remarkStored = body;
    btn.classList.add('saved');
    btn.textContent = 'Saved ✓';
    setTimeout(() => (btn.classList.remove('saved'), paintRemark()), 2000);
  } catch (e) {
    toast(`Not saved: ${e.message}`, 'bad');
    btn.textContent = 'Save';
  } finally {
    inflight.delete(op);
    load();
  }
}

// "· by Pranshu" on an entry the other phone typed. Papa's own entries (and older ones, with no stamp) say nothing.
const by = r => (r.logged_by && r.logged_by !== uid ? ` · by ${names[r.logged_by] ?? 'family'}` : '');

// ── Entry sheets with the in-app keypad ─────────────────────────
function openSheet(k) {
  const dlg = root.querySelector(`[data-sheet=${k}]`);
  const form = dlg.querySelector('form');
  form.reset();
  resetTimes();
  setActive(form, form.querySelector('.field input'));
  form.dataset.editing = '';
  // Smart defaults: a morning sugar test is almost always fasting; weight rarely changes.
  if (k === 'sugar' && new Date().getHours() < 10) form.querySelector('[value=fasting]').checked = true;
  const same = form.querySelector('[data-act=same-weight]');
  if (same) {
    same.hidden = state.lastWeight == null;
    same.textContent = `Same as last time: ${Number(state.lastWeight)} kg`;
  }
  dlg.showModal();
  paintEntries(dlg);
}

function wireSheet(form) {
  form.onsubmit = e => (e.preventDefault(), saveReading(form));
  form.addEventListener('click', e => {
    if (e.target.dataset.act === 'close') form.closest('dialog').close();
    if (e.target.dataset.act === 'same-weight') form.querySelector('[name=value]').value = Number(state.lastWeight);
    const slotOf = el => state.readings.find(r => r.metric === form.dataset.metric && r.slot === el?.dataset.slot);
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del-slot]');
    if (edit) editEntry(form, slotOf(edit));
    if (del) deleteReading(slotOf(del));
  });
  // BP: a number starting with 1 or 2 has 3 digits, any other has 2; when it is complete, move on.
  bindKeypad(form, input => {
    const next = { systolic: 'diastolic', diastolic: 'pulse' }[input.name];
    return next && input.value.length === (/^[12]/.test(input.value) ? 3 : 2) && form.querySelector(`[name=${next}]`);
  });
}

function invalid(form) {
  const problem = fieldProblem(form);
  if (problem) return problem;
  if (form.dataset.metric === 'sugar' && !new FormData(form).get('context')) return 'Choose fasting, after meal or random';
  return null;
}

// The moment to record: the shown day at the typed time (or now / midday when no time is asked).
function whenOn(time) {
  const at = viewDay ? parseDay(viewDay) : new Date();
  if (time) {
    const [h, m] = time.split(':').map(Number);
    at.setHours(h, m, 0, 0);
    // Between midnight and 6 am, a late-evening time (e.g. 11 pm) means last night.
    if (!viewDay && new Date().getHours() < 6 && h >= 18) at.setDate(at.getDate() - 1);
  } else if (viewDay) at.setHours(12, 0, 0, 0);
  return at;
}

async function saveReading(form) {
  const problem = invalid(form);
  if (problem) return toast(problem, 'bad');
  const f = new FormData(form);
  const metric = form.dataset.metric;
  const old = form.dataset.editing && state.readings.find(r => r.metric === metric && r.slot === form.dataset.editing);
  const at = f.get('time') || !old ? whenOn(f.get('time')) : new Date(old.taken_at); // editing a one-a-day reading keeps its time
  const n = k => (f.get(k) ? Number(f.get(k)) : null);
  const context = metric === 'sugar' ? f.get('context') : null;
  const row = {
    user_id: uid, metric, slot_date: localDate(at), slot: slotFor(metric, at, context), taken_at: at.toISOString(),
    systolic: n('systolic'), diastolic: n('diastolic'), pulse: n('pulse'), value: n('value'), sugar_context: context,
    deleted_at: null, // re-entering a soft-deleted slot brings it back
  };
  form.closest('dialog').close(); // closes on the tap; the row below changes at once
  buzz();
  await saveRow(row);
  if (old && old.slot !== row.slot) await saveRow(removal(old)); // the time moved to another part of the day: the old entry goes
}

// ── Saved entries inside a reading sheet: see what was entered, fix it or delete it ──
const READ_COLS = ['user_id', 'metric', 'slot_date', 'slot', 'taken_at', 'systolic', 'diastolic', 'pulse', 'value', 'sugar_context'];
const removal = r => ({ ...Object.fromEntries(READ_COLS.map(c => [c, r[c] ?? null])), deleted_at: new Date().toISOString() });
const CONTEXT_WORD = { fasting: 'fasting', post_meal: 'after meal', random: 'random' };

function entryParts(r) {
  if (r.metric === 'bp') return { val: `${r.systolic}/${r.diastolic}`, unit: 'mmHg', extra: r.pulse ? `pulse ${r.pulse}` : '' };
  if (r.metric === 'sugar') return { val: Number(r.value), unit: 'mg/dL', extra: CONTEXT_WORD[r.sugar_context] ?? '' };
  if (r.metric === 'steps') return { val: Number(r.value).toLocaleString(), unit: 'steps', extra: '' };
  return { val: Number(r.value), unit: UNITS[r.metric], extra: '' };
}

function paintEntries(dlg = root.querySelector('dialog[data-sheet][open]')) {
  if (!dlg) return;
  const k = dlg.dataset.sheet;
  const box = dlg.querySelector('[data-out=entries]');
  const editing = dlg.querySelector('form').dataset.editing;
  const list = state.readings.filter(r => r.metric === k);
  box.hidden = !list.length;
  box.innerHTML = list.map(r => {
    const { val, unit, extra } = entryParts(r);
    const sub = [extra, by(r).slice(3), r.pending ? 'waiting to send' : ''].filter(Boolean).join(' · ');
    return `<div class="ent${r.slot === editing ? ' editing' : ''}">
      <button type="button" class="ent-main" data-edit data-slot="${esc(r.slot)}" aria-label="Edit ${esc(entryLabel(r))}">
        <span class="ent-when"><span>${hhmm(r.taken_at)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="ent-val num">${esc(val)}<small>${esc(unit)}</small></span></button>
      <button type="button" class="ent-del" data-del-slot data-slot="${esc(r.slot)}" aria-label="Delete ${esc(entryLabel(r))}">${ICONS.trash}</button></div>`;
  }).join('');
  if (list.length) box.insertAdjacentHTML('afterbegin', `<p class="ent-title">${viewDay ? 'Saved this day' : 'Saved today'}</p>`);
}
const entryLabel = r => `${entryParts(r).val} at ${hhmm(r.taken_at)}`;

function editEntry(form, r) {
  if (!r) return;
  const set = (name, v) => form.elements[name] && (form.elements[name].value = v ?? '');
  ['systolic', 'diastolic', 'pulse', 'value'].forEach(c => set(c, r[c]));
  const ctx = r.sugar_context && form.querySelector(`[name=context][value=${r.sugar_context}]`);
  if (ctx) ctx.checked = true;
  if (form.elements.time) form.elements.time.value = toLocalInput(new Date(r.taken_at)).slice(11);
  form.dataset.editing = r.slot;
  setActive(form, form.querySelector('.field input'));
  paintEntries(form.closest('dialog'));
}

function deleteReading(r) {
  if (!r || !confirm(`Delete ${entryLabel(r)}?`)) return;
  buzz();
  return saveRow(removal(r));
}

// Optimistic write: the row paints now, the save runs behind (one at a time, in tap order). If the save is
// refused, the next load puts the old value back and a toast says why. Offline, db.js queues it instead.
async function saveRow(row) {
  const op = { kind: 'upsert', table: 'readings', row };
  inflight.add(op);
  state.readings = overlay(state.readings, [op], 'readings').filter(r => !r.deleted_at && r.slot_date === state.day)
    .sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  loads++; // a load already in flight read the old state
  paint();
  saving = saving.catch(() => {}).then(() => upsert('readings', row, 'user_id,metric,slot_date,slot'));
  try {
    await saving;
  } catch (e) {
    toast(`Not saved: ${e.message}`, 'bad');
  } finally {
    inflight.delete(op);
    load();
  }
}

function bumpCount(metric, by) {
  if (!ready) return toast('Loading, try again in a moment', 'bad');
  if (state.day !== dayOf()) return; // a day change is still loading; the count would land on the old day
  if (metric === 'insulin' && insulinNow().value == null) return toast('Loading, try again in a moment', 'bad');
  const now = metric === 'insulin' ? insulinNow().value : Number(state.readings.filter(r => r.metric === metric).at(-1)?.value ?? 0);
  const value = Math.max(0, Math.min(COUNT_MAX[metric] ?? 20, now + by));
  if (value === now) return;
  const at = whenOn(null);
  buzz();
  return saveRow({ user_id: uid, metric, slot_date: localDate(at), slot: 'day', taken_at: at.toISOString(), value, deleted_at: null });
}

async function toggleMed(slot) {
  if (!ready) return toast('Loading, try again in a moment', 'bad');
  if (state.day !== dayOf()) return; // a day change is still loading; the switch would write the old day
  const done = !medOn(state.checks, state.day, slot);
  const op = { kind: 'upsert', table: 'daily_check', row: { user_id: uid, day: state.day, kind: `meds_${slot}`, done, deleted_at: null } };
  inflight.add(op);
  state.checks = overlay(state.checks, [op], 'daily_check');
  loads++; // a load already in flight read the old value
  paint();
  buzz();
  saving = saving.catch(() => {}).then(() => upsert(op.table, op.row, 'user_id,day,kind'));
  try {
    await saving;
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    inflight.delete(op);
    load();
  }
}

// ── Meal sheet: photo (camera or gallery), voice note, or "ate it" ─────────
const MEAL_NAME = Object.fromEntries(MEALS);
const local = new Map(); // path → object URL, so a new photo or voice note shows before the upload ends
const urls = new Map(); // path → signed URL, kept so a repaint shows the picture at once instead of flashing grey
const srcOf = path => local.get(path) ?? urls.get(path) ?? '';
async function mediaUrl(path) {
  if (!srcOf(path)) {
    const u = await photoUrl(path);
    if (u) urls.set(path, u);
  }
  return srcOf(path);
}
let mealType = null, stopRec = null, recBlob = null;

function openMeal(k) {
  mealType = k;
  resetRecorder();
  paintMealSheet();
  root.querySelector('#meal-sheet').showModal();
}

function paintMealSheet() {
  const sheet = root.querySelector('#meal-sheet');
  root.querySelector('[data-out=meal-title]').textContent = MEAL_NAME[mealType];
  const list = state.meals.filter(m => m.meal_type === mealType);
  const box = sheet.querySelector('[data-out=meal-items]');
  box.innerHTML = list.map(m => `<div class="meal-item" data-id="${m.id}">
      ${m.photo_path ? `<img alt="${esc(MEAL_NAME[mealType])} photo" data-path="${esc(m.photo_path)}">` : ''}
      ${m.voice_path ? `<audio controls preload="metadata" data-path="${esc(m.voice_path)}"></audio>` : ''}
      <div class="meal-item-foot"><span class="muted">${m.photo_path ? 'Photo' : m.voice_path ? 'Voice note' : 'Ate it, no photo'} · ${hhmm(m.eaten_at)}${m.pending ? ' · saving…' : ''}${by(m)}</span>
        <button type="button" class="link bad" data-del="${m.id}">Delete</button></div></div>`).join('');
  box.querySelectorAll('[data-path]').forEach(async el => (el.src = await mediaUrl(el.dataset.path)));
  sheet.querySelector('.meal-actions [data-act=voice]').hidden = !voiceSupported();
}

async function addMealEntry({ photo, voice }) {
  buzz();
  const at = whenOn(null);
  const id = crypto.randomUUID();
  const day = localDate(at);
  const row = { id, user_id: uid, meal_type: mealType, slot_date: day, eaten_at: at.toISOString(), photo_path: null, voice_path: null };
  let blob;
  if (photo) {
    blob = await shrink(photo);
    row.photo_path = `${uid}/${day}/${id}.jpg`;
  }
  if (voice) row.voice_path = `${uid}/${day}/${id}.${audioExt(voice.type)}`;
  // Show it at once; the real row replaces this on the next load.
  for (const [path, b] of [[row.photo_path, blob], [row.voice_path, voice]]) if (path) local.set(path, URL.createObjectURL(b));
  state.meals.push({ ...row, pending: true });
  paint();
  try {
    if (photo) await uploadFile(row.photo_path, blob);
    if (voice) await uploadFile(row.voice_path, voice);
    await upsert('meals', row); // the entry's "saving…" label going away says it is saved
  } catch (e) {
    toast(e.message, 'bad');
  }
  load();
}

function resetRecorder() {
  stopRec?.();
  stopRec = null;
  recBlob = null;
  const r = root.querySelector('#meal-sheet .recorder');
  r.hidden = true;
  r.querySelector('audio').hidden = true;
  r.querySelector('.row2').hidden = true;
  r.querySelector('[data-act=rec-stop]').hidden = false;
  r.querySelector('.rec-state').hidden = false;
  root.querySelector('#meal-sheet .meal-actions').hidden = false;
}

function wireMealSheet() {
  const sheet = root.querySelector('#meal-sheet');
  const rec = sheet.querySelector('.recorder');
  sheet.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) addMealEntry({ photo: file });
    e.target.value = '';
  });
  sheet.addEventListener('close', resetRecorder);
  sheet.addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act;
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (act === 'meal-close') sheet.close();
    if (act === 'eaten') addMealEntry({});
    if (del) deleteMeal(del, e.target.closest('.meal-item'));
    if (act === 'voice') {
      try {
        stopRec = await startRecording(sec => (rec.querySelector('[data-out=rec-time]').textContent = `Recording ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`));
        rec.querySelector('[data-out=rec-time]').textContent = 'Recording 0:00';
        rec.hidden = false;
        sheet.querySelector('.meal-actions').hidden = true;
      } catch {
        toast('Allow the microphone for Pulse in the phone’s settings', 'bad');
      }
    }
    if (act === 'rec-stop') {
      recBlob = await stopRec();
      stopRec = null;
      const audio = rec.querySelector('audio');
      audio.src = URL.createObjectURL(recBlob);
      audio.hidden = false;
      rec.querySelector('.row2').hidden = false;
      rec.querySelector('[data-act=rec-stop]').hidden = true;
      rec.querySelector('.rec-state').hidden = true;
    }
    if (act === 'rec-discard') resetRecorder();
    if (act === 'rec-save') {
      const voice = recBlob;
      resetRecorder();
      await addMealEntry({ voice });
    }
  });
}

// The next load removes the entry, or brings it back if the delete failed.
async function deleteMeal(id, el) {
  if (!confirm('Delete this entry?')) return false;
  buzz();
  el?.classList.add('busy');
  state.meals = state.meals.filter(m => m.id !== id);
  loads++;
  paint();
  try {
    await patch('meals', id, { deleted_at: new Date().toISOString() });
  } catch (err) {
    toast(err.message, 'bad');
  }
  load();
  return true;
}

// ── Meals on Today: one row per meal logged, photo thumbnails (tap = full screen), voice note play button ──
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function paintMealRows() {
  const box = root.querySelector('[data-out=meal-rows]');
  const html = MEALS.map(([k, name]) => {
    const list = state.meals.filter(m => m.meal_type === k);
    if (!list.length) return '';
    const photos = list.filter(m => m.photo_path).length, voices = list.filter(m => m.voice_path).length;
    const note = [hhmm(list[0].eaten_at), photos && `${photos} photo${photos > 1 ? 's' : ''}`, voices && `${voices} voice note${voices > 1 ? 's' : ''}`,
      !photos && !voices && 'no photo', list.some(m => m.pending) && 'waiting to send'].filter(Boolean).join(' · ')
      + [...new Set(list.map(by).filter(Boolean))].join('');
    const thumbs = list.flatMap(m => [
      m.photo_path && `<button type="button" class="thumb" data-photo="${esc(m.id)}" aria-label="Open ${name} photo, ${hhmm(m.eaten_at)}"><img alt="" data-path="${esc(m.photo_path)}" ${srcOf(m.photo_path) ? `src="${esc(srcOf(m.photo_path))}"` : ''}></button>`,
      m.voice_path && `<button type="button" class="vplay" data-play="${esc(m.voice_path)}" aria-label="Play ${name} voice note, ${hhmm(m.eaten_at)}">${PLAY}</button>`,
    ]).filter(Boolean).join('');
    return `<div class="vrow mrow">
      <button type="button" class="mhead" data-meal-open="${k}"><span class="vic vic-diet" aria-hidden="true">${ICONS.camera}</span>
        <span class="vtx"><span class="vname">${name}</span><span class="vnote">${esc(note)}</span></span><span class="chev" aria-hidden="true">›</span></button>
      ${thumbs ? `<div class="mthumbs">${thumbs}</div>` : ''}</div>`;
  }).join('');
  if (box._html !== html) {
    box._html = html;
    box.innerHTML = html;
  }
  box.querySelectorAll('img[data-path]:not([src])').forEach(async img => {
    const u = await mediaUrl(img.dataset.path);
    if (u && img.isConnected) img.src = u;
  });
  const v = root.querySelector('#photo-viewer');
  if (v.open && !state.meals.some(m => m.id === v.dataset.id)) v.close(); // deleted on the other phone
}

let audio = null, playBtn = null;
async function togglePlay(btn) {
  const same = playBtn === btn;
  audio?.pause();
  if (same && audio && !audio.paused) return;
  const url = await mediaUrl(btn.dataset.play);
  if (!url) return toast('Voice note is not on this phone yet', 'bad');
  audio = new Audio(url);
  playBtn = btn;
  btn.classList.add('playing');
  btn.innerHTML = PAUSE;
  const stop = () => (btn.classList.remove('playing'), (btn.innerHTML = PLAY));
  audio.onended = audio.onpause = stop;
  audio.play().catch(() => (stop(), toast('Cannot play this voice note', 'bad')));
}

async function openViewer(id) {
  const m = state.meals.find(x => x.id === id);
  if (!m) return;
  const v = root.querySelector('#photo-viewer');
  v.dataset.id = id;
  v.querySelector('[data-out=pv-title]').innerHTML = `<span>${esc(MEAL_NAME[m.meal_type])}</span><small>${esc(hhmm(m.eaten_at))}${esc(by(m))}</small>`;
  const img = v.querySelector('img');
  img.alt = `${MEAL_NAME[m.meal_type]} photo`;
  img.removeAttribute('src');
  v.showModal();
  img.src = await mediaUrl(m.photo_path);
}

function wireMealRows() {
  root.querySelector('[data-out=meal-rows]').addEventListener('click', e => {
    const view = e.target.closest('[data-photo]'), play = e.target.closest('[data-play]'), open = e.target.closest('[data-meal-open]');
    if (view) openViewer(view.dataset.photo);
    if (play) togglePlay(play);
    if (open) openMeal(open.dataset.mealOpen);
  });
  const v = root.querySelector('#photo-viewer');
  v.addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'pv-close') v.close();
    if (act === 'pv-del' && (await deleteMeal(v.dataset.id))) v.close();
  });
}
