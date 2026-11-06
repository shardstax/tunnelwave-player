// Autoplay radio: what plays when the queue runs out.
//
// Spotify-style recipe, all on-device:
//  1. Ask YouTube for its own radio ("Mix") of the current song and of the last couple of songs,
//     so the station follows the session, not just one track.
//  2. Blend them: songs that several mixes agree on, and that sit near the top, rank highest.
//  3. Drop junk (compilations, reaction videos, 10-hour loops…) and alternate versions of songs
//     you just heard (lyric video, slowed + reverb, …) unless that's what you're listening to.
//  4. Learn from you: artists you skip sink, artists you finish or favourite rise.
//  5. Don't play the same artist back to back when there's a good alternative.

const compact = (s) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Lowercased artist name without "VEVO", "- Topic", "Official" and spacing. */
export function artistKey(author = '') {
  return compact(author.replace(/vevo$|\s*-\s*topic$|official/gi, ''));
}

const NOISE =
  /\b(official|music|video|videos|lyrics?|lyrical|audio|hd|hq|4k|full|song|songs|visuali[sz]er|remaster(ed)?|explicit|mv|the|a|from|new|latest)\b/g;

/**
 * A rough "which song is this" key, so "Artist - Song (Official Video)", "Song (Lyrics)" and
 * "Lyrical: Song | Movie" all count as the same song.
 */
export function songKey(track) {
  const author = artistKey(track.author);
  const title = (track.title || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[([{【].*?[)\]}】]/g, ' ')
    .replace(/["“”‘’']/g, '');
  const segments = title
    .split(/\s[-–—]\s|\||:|\s\/\/\s/)
    .map((seg) =>
      seg
        .replace(/\b(ft|feat|featuring)\b.*$/, '')
        .replace(NOISE, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    )
    // skip the artist part and tiny leftovers like "fun"
    .filter((seg) => seg.length > 3 && !(author && (compact(seg) === author || author.includes(compact(seg)))));
  return compact(segments[0] || title) || track.id;
}

// never radio material
const HARD_JUNK =
  /\b(full album|jukebox|non[- ]?stop|compilation|playlist|best of|greatest hits|top \d+|\d+\s*(hours?|hrs)|reaction|reacts?|tutorial|lesson|ringtone|teaser|trailer|interview|podcast|behind the scenes|making of|#?shorts|mashup|megamix|back ?to ?back)\b/i;

// alternate versions: only when the seeds are that kind of version too
const VARIANTS = [
  ['slowed', /\bslowed\b|\breverb\b/i],
  ['sped', /\bsped up\b|\bnightcore\b/i],
  ['lofi', /\blo-?fi\b/i],
  ['8d', /\b8d\b/i],
  ['cover', /\bcover\b(?!\s+me)/i],
  ['karaoke', /\bkaraoke\b|\binstrumental\b/i],
  ['live', /\blive\s+(at|from|in|on|performance|session|version)\b|[([]live\b|\bconcert\b/i],
  ['remix', /\bremix\b/i],
  ['bass', /\bbass boost(ed)?\b/i],
];

// "tumhiho" and "tumhihoaashiqui2" are the same song
const sameSong = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

function variantsOf(title) {
  return VARIANTS.filter(([, re]) => re.test(title)).map(([name]) => name);
}

function isJunk(track, allowedVariants, maxDuration) {
  if (HARD_JUNK.test(track.title)) return true;
  if (track.duration && (track.duration < 60 || track.duration > maxDuration)) return true;
  return variantsOf(track.title).some((v) => !allowedVariants.has(v));
}

// ---------- taste ----------

export const EMPTY_TASTE = { artists: {}, skipped: {} };
const SKIP_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Returns new taste after nudging an artist's score (and optionally remembering a skipped song). */
export function nudgeTaste(taste, track, delta, { skipped = false } = {}) {
  const key = artistKey(track.author);
  const artists = { ...taste.artists };
  if (key) artists[key] = clamp((artists[key] || 0) + delta, -5, 5);
  let skippedMap = taste.skipped;
  if (skipped) {
    const now = Date.now();
    const kept = Object.entries(taste.skipped).filter(([, at]) => now - at < SKIP_MEMORY_MS).slice(-300);
    skippedMap = { ...Object.fromEntries(kept), [track.id]: now };
  }
  return { artists, skipped: skippedMap };
}

// ---------- ranking ----------

/**
 * @param seeds    [{ track, tracks, weight }] — each seed's radio list in YouTube's order
 * @param avoid    tracks that shouldn't come up (now playing, queue, history, recently played)
 * @param taste    { artists, skipped }
 * @param favouriteIds Set of liked song ids
 */
export function buildStation({ seeds, avoid, taste = EMPTY_TASTE, favouriteIds = new Set(), current, limit = 30 }) {
  const avoidIds = new Set(avoid.map((t) => t.id));
  const avoidKeys = avoid.map(songKey);
  const allowed = new Set(seeds.flatMap((s) => variantsOf(s.track.title)));
  const longest = Math.max(0, ...seeds.map((s) => s.track.duration || 0));
  const maxDuration = Math.max(600, longest * 1.5);

  const pool = new Map(); // songKey -> { track, score, hits }
  for (const { tracks, weight } of seeds) {
    tracks.forEach((track, rank) => {
      if (avoidIds.has(track.id) || taste.skipped[track.id]) return;
      if (isJunk(track, allowed, maxDuration)) return;
      let key = songKey(track);
      if (avoidKeys.some((k) => sameSong(k, key))) return;
      const points = weight / (1 + rank * 0.12);
      if (!pool.has(key)) key = [...pool.keys()].find((k) => sameSong(k, key)) ?? key;
      const entry = pool.get(key);
      if (entry) {
        entry.score += points;
        entry.hits += 1;
      } else {
        pool.set(key, { track, score: points, hits: 1 });
      }
    });
  }

  const ranked = [...pool.values()]
    .map((e) => {
      let score = e.score * (1 + 0.25 * (e.hits - 1)); // several mixes agree → strong pick
      score *= 1 + clamp(taste.artists[artistKey(e.track.author)] || 0, -5, 5) * 0.12;
      if (favouriteIds.has(e.track.id)) score *= 1.2;
      return { track: e.track, score };
    })
    .sort((a, b) => b.score - a.score);

  // spread artists out: take the best song that isn't by the artist we just played,
  // unless that means reaching far down the list
  const out = [];
  let lastArtist = current ? artistKey(current.author) : '';
  while (ranked.length && out.length < limit) {
    let i = ranked.findIndex((r, idx) => idx < 6 && artistKey(r.track.author) !== lastArtist);
    if (i === -1) i = 0;
    const [pick] = ranked.splice(i, 1);
    out.push(pick.track);
    lastArtist = artistKey(pick.track.author);
  }
  return out;
}
