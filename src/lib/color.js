// Picks the most vivid colour from a thumbnail so the UI can match the current song.

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Resolves to { h, s } (degrees, 0-100) or null when the image is basically grey. */
export async function extractAccent(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 30;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // group pixels into 12 hue buckets, weighted by how colourful they are
  const buckets = Array.from({ length: 12 }, () => ({ weight: 0, h: 0, s: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.12 || l > 0.9 || s < 0.2) continue;
    const w = s * (1 - Math.abs(l - 0.5) * 1.6);
    const b = buckets[Math.floor(h / 30) % 12];
    b.weight += w;
    b.h += h * w;
    b.s += s * w;
  }
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.weight < 8) return null;
  return { h: Math.round(best.h / best.weight), s: Math.round(Math.min(90, Math.max(45, (best.s / best.weight) * 100))) };
}
