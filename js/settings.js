// Settings: appearance (system / light / dark), reminders, account.
import { reminderState, enableReminders, disableReminders } from './push.js';
import { APP_VERSION } from './config.js';
import { sb, rows, upsert } from './db.js';
import { MED_SLOTS } from './slots.js';
import { esc, toast, buzz, busy } from './ui.js';

// Same defaults as supabase/functions/send-reminders/due.js: no med_reminder row = this time, on.
const REMIND_TIMES = { morning: '10:00', afternoon: '15:00', evening: '21:00' };
// What a slot sends, shown under its name.
const remindWhat = (k, at) => `If not ticked by ${at}`;
const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export const getTheme = () => {
  try { return localStorage.getItem('theme') ?? 'system'; } catch { return 'system'; }
};

// index.html sets data-theme before first paint; this keeps it and the browser bar colour in step.
export function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  dispatchEvent(new Event('pulse:theme'));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'system' && applyTheme());

// Notifications row: state on the right, one line of help under the group.
const REMIND = {
  off: ['<button type="button" class="row action" data-act="remind">Turn on reminders</button>', 'RKB can remind this phone about medicines and readings.'],
  on: ['<button type="button" class="row action" data-act="unremind">Turn off reminders</button>', 'Reminders are on for this phone.'],
  blocked: ['<div class="row static"><span class="row-main">Notifications</span><span class="set-val bad">Blocked</span></div>', 'Allow notifications for RKB in the phone’s Settings.'],
  'install-first': ['<div class="row static"><span class="row-main">Notifications</span><span class="set-val">Not available</span></div>', 'To get reminders, open RKB from the Home Screen: Share → Add to Home Screen.'],
  unsupported: ['<div class="row static"><span class="row-main">Notifications</span><span class="set-val">Not available</span></div>', 'This browser cannot show reminders.'],
};

// Reminders are push messages to one phone about Papa's own doses, so only his account can switch them on
// (the push table accepts his user only).
export async function mountSettings(el, profile, email) {
  const entry = profile.role === 'entry';
  el.innerHTML = `
    ${window.RKB ? '' : '<header class="large-title"><h1>Settings</h1></header>'}
    ${window.RKB ? '' : `<p class="group-label">Appearance</p>
    <div class="seg2 three" role="radiogroup" aria-label="Appearance">${THEMES.map(([k, name]) =>
      `<button type="button" role="radio" data-theme-pick="${k}">${name}</button>`).join('')}</div>`}
    ${entry ? `<p class="group-label">Notifications</p>
    <div class="group" data-out="remind"></div><p class="set-foot" data-out="remind-foot"></p>
    <p class="group-label">Medicine reminders</p>
    <div class="group" data-out="medrem">
      <div class="row static rem-row rem-master"><span class="row-main">All medicine reminders</span>
        <button type="button" class="rem-all" role="switch" aria-checked="true" aria-label="All medicine reminders"><span class="switch on"><i></i></span></button></div>
      ${MED_SLOTS.map(([k, name]) => `
      <div class="row static rem-row" data-rem="${k}"><span class="row-main">${name}<small>${remindWhat(k, REMIND_TIMES[k])}</small></span>
        <input type="time" class="time-pill" value="${REMIND_TIMES[k]}" aria-label="${name} reminder time">
        <button type="button" class="rem-sw" role="switch" aria-checked="true" aria-label="${name} reminder"><span class="switch on"><i></i></span></button></div>`).join('')}
    </div>
    <p class="set-foot">If you have not ticked your medicines by this time, the phone reminds you.</p>` : ''}
    ${window.RKB ? '' : `<p class="group-label">Account</p>
    <div class="group">
      <div class="row static"><span class="row-main">Signed in</span><span class="set-val">${esc(email)}</span></div>
      <button type="button" class="row danger" data-act="signout">Sign out</button>
    </div>`}
    <p class="group-label">App</p>
    <div class="group"><button type="button" class="row action" data-act="update">Check for updates</button></div>
    <p class="set-foot">Data refreshes by itself. Pull down to refresh now.</p>
    <p class="set-version">RKB Health ${APP_VERSION}</p>`;

  const paintTheme = () => el.querySelectorAll('[data-theme-pick]').forEach(b => b.setAttribute('aria-checked', b.dataset.themePick === getTheme()));
  const paintRemind = async () => {
    if (!entry) return;
    const [row, foot] = REMIND[await reminderState()];
    el.querySelector('[data-out=remind]').innerHTML = row;
    el.querySelector('[data-out=remind-foot]').textContent = foot;
  };
  paintTheme();
  paintRemind();

  // Medicine reminder times: one med_reminder row per slot, written when changed. No row = default time, on.
  const rem = Object.fromEntries(Object.entries(REMIND_TIMES).map(([k, at]) => [k, { at, enabled: true }]));
  const paintMed = k => {
    const row = el.querySelector(`[data-rem=${k}]`);
    row.querySelector('input').value = rem[k].at;
    row.querySelector('small').textContent = remindWhat(k, rem[k].at);
    row.querySelector('.rem-sw').setAttribute('aria-checked', rem[k].enabled);
    row.querySelector('.switch').classList.toggle('on', rem[k].enabled);
    // Master reflects "any slot on"; with it off the slot rows look disabled.
    const any = Object.values(rem).some(r => r.enabled);
    el.querySelector('.rem-all').setAttribute('aria-checked', any);
    el.querySelector('.rem-all .switch').classList.toggle('on', any);
    el.querySelector('[data-out=medrem]').classList.toggle('all-off', !any);
  };
  const saveMed = async (k, next) => {
    const before = rem[k];
    rem[k] = next;
    paintMed(k);
    try {
      await upsert('med_reminder', { user_id: profile.id, slot: k, at: next.at, enabled: next.enabled, deleted_at: null }, 'user_id,slot');
      buzz();
    } catch (err) {
      rem[k] = before;
      paintMed(k);
      toast(err.message, 'bad');
    }
  };
  if (entry) {
    rows(sb.from('med_reminder').select('slot, at, enabled').is('deleted_at', null)).then(list => {
      for (const r of list) if (rem[r.slot]) rem[r.slot] = { at: r.at.slice(0, 5), enabled: r.enabled };
      Object.keys(rem).forEach(paintMed);
    }).catch(() => {}); // offline: the defaults stay on screen
    el.addEventListener('change', e => {
      const k = e.target.closest('[data-rem]')?.dataset.rem;
      if (!k || e.target.type !== 'time') return;
      if (e.target.value) saveMed(k, { ...rem[k], at: e.target.value });
      else paintMed(k); // cleared: keep the old time
    });
  }

  el.addEventListener('click', async e => {
    const pick = e.target.closest('[data-theme-pick]')?.dataset.themePick;
    if (pick) {
      try { localStorage.setItem('theme', pick); } catch {}
      applyTheme(pick);
      paintTheme();
      buzz();
    }
    if (e.target.closest('[data-act=update]')) {
      toast('Checking…');
      dispatchEvent(new Event('pulse:check-update'));
    }
    if (e.target.closest('.rem-all')) {
      const on = !Object.values(rem).some(r => r.enabled); // any on: switch all off; all off: switch all on
      Object.keys(rem).forEach(k => saveMed(k, { ...rem[k], enabled: on }));
    }
    const sw = e.target.closest('.rem-sw');
    if (sw) {
      const k = sw.closest('[data-rem]').dataset.rem;
      saveMed(k, { ...rem[k], enabled: !rem[k].enabled });
    }
    const unremind = e.target.closest('[data-act=unremind]');
    if (unremind) {
      await busy(unremind, async () => {
        try {
          await disableReminders(profile.id);
          buzz();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      paintRemind();
    }
    const remind = e.target.closest('[data-act=remind]');
    if (remind) {
      remind.textContent = 'Turning on…';
      await busy(remind, async () => {
        try {
          await enableReminders(profile.id);
          buzz();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      paintRemind(); // the row now says "Reminders are on"
    }
  });
}
