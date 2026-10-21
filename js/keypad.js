// In-app number keypad, shared by Today and Tasks. Fields use inputmode="none", so the phone keyboard
// stays away and entry looks and works the same on Android and iPhone.

export const field = (name, label, attrs) =>
  `<label class="field"><span>${label}</span><input name="${name}" inputmode="none" autocomplete="off" placeholder="–" ${attrs}></label>`;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
export const pad = decimal => `<div class="pad">${KEYS.map(k =>
  `<button type="button" data-key="${k}" ${k === '.' && !decimal ? 'disabled aria-hidden="true"' : ''} aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>`).join('')}</div>`;

export function setActive(form, input) {
  form.querySelectorAll('.field').forEach(f => f.classList.toggle('active', f.contains(input)));
  form.active = input;
}

// `next(input)` may return the field to jump to once this one is complete.
export function bindKeypad(form, next = () => null) {
  form.addEventListener('focusin', e => e.target.closest('.field') && setActive(form, e.target));
  form.addEventListener('click', e => {
    if (e.target.closest('.field')) setActive(form, e.target.closest('.field').querySelector('input'));
    const key = e.target.closest('[data-key]')?.dataset.key;
    const input = form.active;
    if (!key || !input) return;
    if (key === '⌫') input.value = input.value.slice(0, -1);
    else if (input.value.length < Number(input.maxLength) && !(key === '.' && input.value.includes('.'))) input.value += key;
    const to = key !== '⌫' && next(input);
    if (to) setActive(form, to);
  });
}

// Fields skip native validation (inputmode="none" + novalidate), so ranges are checked here.
export function fieldProblem(form) {
  for (const input of form.querySelectorAll('.field input')) {
    const label = input.closest('.field').querySelector('span').textContent;
    if (!input.value) {
      if (input.required) return `Enter ${label.toLowerCase()}`;
      continue;
    }
    const v = Number(input.value);
    if (Number.isNaN(v) || v < Number(input.min) || v > Number(input.max)) return `${label} must be between ${input.min} and ${input.max}`;
  }
  return null;
}
