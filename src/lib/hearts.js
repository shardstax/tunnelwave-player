// A little burst of hearts that float up from a button when you favourite a song.

const HEARTS = ['❤️', '💖', '💕', '💗', '💓'];

export function burstHearts(el) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'heart-burst';
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('span');
    h.textContent = HEARTS[i % HEARTS.length];
    // fan out upwards: -60° … +60° from straight up, with a little randomness
    const angle = ((i / 6) * 120 - 60 + (Math.random() * 16 - 8)) * (Math.PI / 180);
    const dist = 38 + Math.random() * 26;
    h.style.setProperty('--x', `${Math.sin(angle) * dist}px`);
    h.style.setProperty('--y', `${-Math.cos(angle) * dist - 10}px`);
    h.style.setProperty('--r', `${Math.random() * 50 - 25}deg`);
    h.style.setProperty('--s', `${0.7 + Math.random() * 0.6}`);
    h.style.animationDelay = `${i * 18}ms`;
    layer.append(h);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1100);
}
