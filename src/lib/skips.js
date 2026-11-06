// Non-music parts of a video (talking intros, skits, outros, sponsor reads), from the community-run
// SponsorBlock database (https://sponsor.ajay.app). Nothing is skipped automatically: the player just
// offers a "Skip intro" style button while one of these parts is playing.

const API = 'https://sponsor.ajay.app/api/skipSegments';
const CATEGORIES = ['music_offtopic', 'intro', 'outro', 'sponsor', 'selfpromo'];
const cache = new Map();

async function sha256Prefix(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes.slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolves to [{ start, end, category }] sorted by start, overlapping parts merged.
 * Uses the hash-prefix endpoint, so SponsorBlock never learns exactly which video you're playing.
 */
export function getSkipSegments(videoId) {
  if (cache.has(videoId)) return cache.get(videoId);
  const promise = (async () => {
    const prefix = await sha256Prefix(videoId);
    const url = `${API}/${prefix}?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}&actionType=skip`;
    const res = await fetch(url);
    if (res.status === 404) return []; // no segments for any video with this prefix
    if (!res.ok) throw new Error(`SponsorBlock ${res.status}`);
    const entry = (await res.json()).find((v) => v.videoID === videoId);
    const parts = (entry?.segments || [])
      .filter((s) => s.actionType === 'skip' && s.segment[1] - s.segment[0] >= 2)
      .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category, videoDuration: s.videoDuration || 0 }))
      .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const p of parts) {
      const last = merged.at(-1);
      if (last && p.start <= last.end + 1) {
        last.end = Math.max(last.end, p.end);
        if (p.category === 'music_offtopic') last.category = p.category;
      } else {
        merged.push({ ...p });
      }
    }
    return merged;
  })();
  cache.set(videoId, promise);
  promise.catch(() => cache.delete(videoId));
  return promise;
}

/** Button text for a part, based on where it sits in the song. */
export function skipLabel(seg, duration) {
  if (seg.start < 3) return 'Skip intro';
  if (duration && seg.end >= duration - 3) return 'Skip outro';
  return {
    intro: 'Skip intro',
    outro: 'Skip outro',
    sponsor: 'Skip sponsor',
    selfpromo: 'Skip promo',
  }[seg.category] || 'Skip non-music part';
}
