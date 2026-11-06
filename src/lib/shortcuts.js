const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';

/** Shortcut list; seek and volume labels follow the steps chosen in Settings. */
export const getShortcuts = ({ seekStep = 5, volumeStep = 5 } = {}) => [
  ['Space', 'Play / pause'],
  [`${MOD} + →`, 'Next song'],
  [`${MOD} + ←`, 'Previous song'],
  [`${MOD} + ↑ / ↓`, `Volume up / down ${volumeStep}%`],
  ['← / →', `Seek ${seekStep} seconds`],
  ['/', 'Search'],
  ['F', 'Favourite current song'],
  ['S', 'Shuffle'],
  ['R', 'Repeat mode'],
  ['M', 'Mute'],
  [`${ALT} + /`, 'Show shortcuts'],
];
