// Medicine plan: three sections named like Today (Morning, Afternoon, Evening). Each medicine is taken before or after food.
// Data model unchanged: med_plan.slot is still before_/after_ breakfast, lunch or dinner. Either phone adds or removes names
// (the son's phone writes on the father's rows — see migration 20261005100000).
import { sb, upsert, patch, cachedRows, pending } from './db.js';
import { overlay } from './overlay.js';
import { esc, toast, buzz, busy } from './ui.js';

const PARTS = [['breakfast', 'Morning', 'With breakfast'], ['lunch', 'Afternoon', 'With lunch'], ['dinner', 'Evening', 'With dinner']];
const CHEV = '<svg class="chev" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const FOOD = { before: 'Before food', after: 'After food' };
let root, owner, plan = [], sheet, form, editing;

const split = slot => slot.split('_'); // ['before', 'breakfast']

export async function mountMeds(el, profile) {
  root = el;
  owner = profile.owner;
  root.innerHTML = `<header class="large-title"><h1>Medicines</h1></header>
    ${PARTS.map(([meal, name, foot]) => `<section class="tl-sec"><h2 class="tl-h">${name}</h2>
      <div class="tl-list" data-out="${meal}"></div><p class="set-foot">${foot}</p></section>`).join('')}
    <dialog class="sheet tl" data-sheet="med"><form novalidate>
      <div class="sheet-head"><h2 data-out="title"></h2><button type="button" class="link" data-act="close">Close</button></div>
      <label>Name<input name="name" maxlength="120" autocomplete="off" aria-required="true"></label>
      <div class="seg wide" role="radiogroup" aria-label="Before or after food">${Object.entries(FOOD).map(([k, n]) =>
        `<label><input type="radio" name="when" value="${k}">${n}</label>`).join('')}</div>
      <div class="seg wide" role="radiogroup" aria-label="Time of day">${PARTS.map(([k, n]) =>
        `<label><input type="radio" name="meal" value="${k}">${n}</label>`).join('')}</div>
      <button class="save">Save</button>
      <button type="button" class="tl-list tl-remove" data-act="remove" hidden>Remove medicine</button>
    </form></dialog>`;
  sheet = root.querySelector('dialog');
  form = sheet.querySelector('form');
  form.onsubmit = e => (e.preventDefault(), busy(form.querySelector('.save'), save));
  root.onclick = e => {
    const add = e.target.closest('[data-add]');
    if (add) return open(null, add.dataset.add);
    const row = e.target.closest('[data-edit]');
    if (row) return open(plan.find(r => r.id === row.dataset.edit));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') sheet.close();
    if (act === 'remove') busy(e.target.closest('button'), remove);
  };
  sb.channel('meds').on('postgres_changes', { event: '*', schema: 'public', table: 'med_plan' }, load).subscribe();
  addEventListener('pulse:refresh', load);
  await load(true); // paint from the phone's copy first
  load();
}

async function load(first = false) {
  try {
    const [rows, ops] = await Promise.all([cachedRows('meds:plan', sb.from('med_plan').select('*').is('deleted_at', null).order('sort'), first), pending()]);
    plan = overlay(rows, ops, 'med_plan').filter(r => !r.deleted_at);
    paint();
  } catch (e) {
    if (!(first && e.message === 'nocache')) toast(e.message, 'bad');
  }
}

function paint() {
  for (const [meal] of PARTS) {
    const list = ['before', 'after'].flatMap(w => plan.filter(r => r.slot === `${w}_${meal}`));
    root.querySelector(`[data-out=${meal}]`).innerHTML = list.map(r => `<button type="button" class="tl-line" data-edit="${r.id}">
      <span class="tl-main"><span class="tl-name">${esc(r.name)}</span><small>${FOOD[split(r.slot)[0]]}</small></span>${CHEV}</button>`).join('')
      + `<button type="button" class="tl-add" data-add="${meal}">${PLUS}<span>Add medicine</span></button>`;
  }
}

function open(med, meal = med && split(med.slot)[1]) {
  editing = med;
  form.reset();
  sheet.querySelector('[data-out=title]').textContent = med ? 'Edit medicine' : 'Add medicine';
  form.name.value = med?.name ?? '';
  form.when.value = med ? split(med.slot)[0] : 'before';
  form.meal.value = meal;
  form.querySelector('[data-act=remove]').hidden = !med;
  sheet.showModal();
  if (!med) form.name.focus();
}

async function save() {
  const name = form.name.value.trim();
  if (!name) return toast('Type the medicine name', 'bad');
  if (!owner) return;
  const slot = `${form.when.value}_${form.meal.value}`;
  buzz();
  try {
    if (editing) await patch('med_plan', editing.id, { name, slot });
    else await upsert('med_plan', { id: crypto.randomUUID(), user_id: owner, slot, name, sort: plan.filter(r => r.slot === slot).length });
    sheet.close();
    load();
  } catch (e) {
    toast(e.message, 'bad'); // the sheet stays open with the name still typed
  }
}

// Not removed from the screen until the server agrees: a medicine that looks gone but is not would be worse than a slow tap.
async function remove() {
  buzz();
  try {
    await patch('med_plan', editing.id, { deleted_at: new Date().toISOString() });   // soft delete: nobody can hard-delete
    sheet.close();
  } catch (e) {
    toast(e.message, 'bad');
  }
  load();
}
