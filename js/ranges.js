// Reading levels for colour cues. Common adult reference ranges, not a diagnosis.
export function bpLevel(sys, dia) {
  if (sys >= 140 || dia >= 90) return 'high';
  if (sys >= 130 || dia >= 85) return 'raised';
  if (sys < 90 || dia < 60) return 'low';
  return 'ok';
}

export function sugarLevel(value, context) {
  const v = Number(value);
  if (v < 70) return 'low';
  if (context === 'fasting') return v >= 126 ? 'high' : v >= 100 ? 'raised' : 'ok';
  return v >= 200 ? 'high' : v >= 140 ? 'raised' : 'ok';
}

export const LEVEL_WORD = { high: 'High', raised: 'Slightly high', low: 'Low', ok: 'Normal' };
