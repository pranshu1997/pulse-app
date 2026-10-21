// Voice notes: record with the phone's microphone (MediaRecorder). iPhone records audio/mp4, Chrome audio/webm.
const MAX_SECONDS = 60;

export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const audioExt = type => (/mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /mpeg/.test(type) ? 'mp3' : 'webm');

// Start recording; `onTick(seconds)` runs every second. Returns stop(), which resolves to the audio Blob.
export async function startRecording(onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const done = new Promise(res => (rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    res(new Blob(parts, { type: rec.mimeType || 'audio/webm' }));
  }));
  rec.start();
  let seconds = 0;
  const timer = setInterval(() => {
    onTick(++seconds);
    if (seconds >= MAX_SECONDS) stop();
  }, 1000);
  const stop = () => {
    clearInterval(timer);
    if (rec.state !== 'inactive') rec.stop();
    return done;
  };
  return stop;
}
