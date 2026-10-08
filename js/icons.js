// Shared icons (24px, stroke) for Today and Summary: one per reading, medicine time and counter, camera for meals.
export const ic = (...d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.map(x => `<path d="${x}"/>`).join('')}</svg>`;
export const ICONS = {
  bp: ic('M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z', 'M3.2 12H9l1-2 2 4 1.5-3H21'),
  sugar: ic('M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z'),
  steps: ic('M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z', 'M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z'),
  weight: ic('M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', 'M8 8.5a6 6 0 0 1 8 0', 'M12 11l1.5-2.5'),
  morning: ic('M12 2v6', 'M4.9 10.9l1.4 1.4', 'M2 18h2', 'M20 18h2', 'M19.1 10.9l-1.4 1.4', 'M22 22H2', 'M8 6l4-4 4 4', 'M16 18a4 4 0 0 0-8 0'),
  afternoon: ic('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M6.3 17.7l-1.4 1.4', 'M19.1 4.9l-1.4 1.4'),
  evening: ic('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'),
  stool: ic('M7 14a5 5 0 0 1 10 0v1H7z', 'M9 10a3 3 0 0 1 6 0', 'M5 19h14'),
  urine_night: ic('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z', 'M15 15l2 2'),
  insulin: ic('M18 2l4 4', 'M17 7l3-3', 'M19 9l-8.7 8.7a2.1 2.1 0 0 1-3 0l-1-1a2.1 2.1 0 0 1 0-3L15 5', 'M9 11l4 4', 'M5 19l-3 3'),
  library: ic('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 16l5-5 4 4 3-3 6 6', 'M9 8.5h.01'),
  meds: ic('M10.5 20.5l-7-7a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7z', 'M8.5 8.5l7 7'),
  mic: ic('M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18v4'),
  tick: ic('M20 6L9 17l-5-5'),
  trash: ic('M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 11v6', 'M14 11v6'),
  camera: ic('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z', 'M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),
};
