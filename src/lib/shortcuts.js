const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';

export const SHORTCUTS = [
  ['Space', 'Play / pause'],
  [`${MOD} + →`, 'Next song'],
  [`${MOD} + ←`, 'Previous song'],
  [`${MOD} + ↑ / ↓`, 'Volume up / down'],
  ['← / →', 'Seek 10 seconds'],
  ['/', 'Search'],
  ['F', 'Favourite current song'],
  ['S', 'Shuffle'],
  ['R', 'Repeat mode'],
  ['M', 'Mute'],
  [`${ALT} + /`, 'Show shortcuts'],
];
