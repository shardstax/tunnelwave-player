// Tunnelwave mark: a tunnel arch with a wave running through it (64×64 grid).
// Shared by the header logo and scripts/make-icons.mjs so every icon matches.

export const ARCH = { cx: 32, cy: 31, r: 17, bottom: 50, width: 6 };
export const WAVE = { x0: 21.5, x1: 42.5, cy: 39, amp: 2.8, period: 10.5, width: 4.2 };

export const waveY = (x) => WAVE.cy + WAVE.amp * Math.sin((2 * Math.PI * (x - WAVE.x0)) / WAVE.period);

const { cx, cy, r, bottom } = ARCH;
export const ARCH_PATH = `M${cx - r} ${bottom}V${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}V${bottom}`;

export const WAVE_PATH = Array.from({ length: 45 }, (_, i) => {
  const x = WAVE.x0 + ((WAVE.x1 - WAVE.x0) * i) / 44;
  return `${i ? 'L' : 'M'}${x.toFixed(2)} ${waveY(x).toFixed(2)}`;
}).join('');
