// Dose reminders via Web Push. iOS allows push only for an app added to the Home Screen (16.4+).
import { VAPID_PUBLIC_KEY } from './config.js';
import { upsert } from './db.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

const keyBytes = b64 => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export async function reminderState() {
  if (!pushSupported()) return isIos() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  return Notification.permission === 'granted' && sub ? 'on' : 'off';
}

export async function enableReminders(uid) {
  if (!VAPID_PUBLIC_KEY) throw new Error('Reminders are not set up on the server yet.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them in phone settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const { endpoint, keys } = sub.toJSON();
  await upsert('push_subscriptions', {
    user_id: uid, endpoint, p256dh: keys.p256dh, auth: keys.auth,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, deleted_at: null,
  }, 'endpoint');
}
