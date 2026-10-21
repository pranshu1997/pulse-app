export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export const hhmm = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let timer;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(timer);
  timer = setTimeout(() => (el.className = ''), 2500);
}

export function hideToast() {
  clearTimeout(timer);
  document.getElementById('toast').className = '';
}

// Answers a tap at once: the button is disabled while `fn` runs, so a slow network never looks like a dead button.
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
  }
}

// Phone photos are 3-10 MB; resize to a JPEG before upload.
export async function shrink(file, max = 1280) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

// iOS Safari has no navigator.vibrate; clicking a hidden switch input (iOS 18+) plays the system tap haptic.
export function buzz(ms = 10) {
  try {
    if (navigator.vibrate) return navigator.vibrate(ms);
    let w = document.getElementById('hapt');
    if (!w) {
      w = Object.assign(document.createElement('label'), { id: 'hapt', innerHTML: '<input type="checkbox" switch>' });
      w.style.display = 'none';
      document.body.append(w);
    }
    w.click();
  } catch {}
}
