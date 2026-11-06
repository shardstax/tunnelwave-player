// Lyrics from LRCLIB (https://lrclib.net): a free, open lyrics database with time-synced lines.
// No key needed and it allows browser requests, so this stays frontend-only.
//
// YouTube titles are messy ("Artist - Song (Official Video) ft. X"), so we clean them up,
// ask LRCLIB a couple of ways, then pick the result whose title, artist and length fit best.

import { artistKey } from './radio';

const API = 'https://lrclib.net/api';
const cache = new Map();

const compact = (s = '') => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const NOISE =
  /\b(official\s+(music\s+)?(video|audio|lyric video|visuali[sz]er)|lyric(al)?\s+video|lyric(s|al)?|full\s+video\s+song|full\s+(video|song|audio)|audio|video\s+song|hd|hq|4k|mv|m\/v|remaster(ed)?(\s+\d{4})?|explicit)\b/gi;

function cleanTitle(title = '') {
  return title
    .replace(/[([{【][^)\]}】]*[)\]}】]/g, ' ') // (Official Video), [HD], 【MV】
    .replace(/\s+(ft|feat|featuring)\.?\s+.*$/i, '')
    .replace(NOISE, ' ')
    .replace(/[|]+.*$/, '') // "Song | Movie | Singer"
    .replace(/["“”]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim();
}

function cleanArtist(author = '') {
  return author.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s*official$/i, '').trim();
}

/** Best guess at { artist, title } for a YouTube track. */
export function guessSong(track) {
  const raw = cleanTitle(track.title);
  const channel = cleanArtist(track.author);
  const parts = raw.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    // "Artist - Song"; occasionally "Song - Artist", so pick the side that matches the channel
    const [a, ...rest] = parts;
    const b = rest.join(' - ');
    if (channel && compact(b).includes(compact(channel)) && !compact(a).includes(compact(channel))) {
      return { artist: b.trim(), title: a.trim() };
    }
    return { artist: a.trim(), title: b.trim() };
  }
  return { artist: channel, title: raw || track.title };
}

/** "[01:02.34] line" → [{ time: 62.34, text: 'line' }], sorted. */
export function parseLrc(lrc = '') {
  const lines = [];
  for (const row of lrc.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const [, m, s] of stamps) lines.push({ time: Number(m) * 60 + Number(s), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lyrics service error (${res.status})`);
  return res.json();
}

/**
 * Everything we know about the upload, for scoring: possible song names (Bollywood-style titles
 * look like "Song - Movie | Actor | Singer", so any part could be the song) and all the text in
 * which the singer's name might appear.
 */
function context(track, duration) {
  const guess = guessSong(track);
  const labelled = track.title
    .replace(/\|/g, ' - ')
    .replace(/\b(music|singers?|sung by|lyrics?|lyricist|composer|composed by|movie|film|album)\s*(by\s*)?[-:]\s*/gi, ' - ');
  const parts = cleanTitle(labelled)
    .split(/\s[-–—]\s|:/)
    .map((p) => p.trim())
    .filter((p) => compact(p).length >= 2);
  const titles = [...new Set([guess.title, ...parts].map(compact).filter(Boolean))];
  return { guess, parts, titles, artist: artistKey(guess.artist), haystack: compact(`${track.title} ${track.author}`), duration };
}

function score(item, ctx) {
  const got = compact(cleanTitle(item.trackName));
  if (!got) return -Infinity;
  let s = -Infinity;
  ctx.titles.forEach((want, i) => {
    const main = i === 0 ? 0.5 : 0; // the cleaned-up title is the best guess
    if (got === want) s = Math.max(s, 3.5 + main);
    else if (Math.min(got.length, want.length) >= 4 && (got.includes(want) || want.includes(got))) s = Math.max(s, 2 + main);
  });
  if (s === -Infinity) return s; // different song

  const gotArtist = artistKey(item.artistName);
  if (gotArtist.length >= 3 && ((ctx.artist && (gotArtist.includes(ctx.artist) || ctx.artist.includes(gotArtist))) || ctx.haystack.includes(gotArtist))) s += 3;
  const duration = ctx.duration;

  if (duration && item.duration) {
    const diff = Math.abs(item.duration - duration);
    s += diff <= 2 ? 2 : diff <= 10 ? 1 : diff <= 30 ? 0 : -2;
  }
  if (item.syncedLyrics) s += 1.5;
  else if (!item.plainLyrics && !item.instrumental) return -Infinity;
  return s;
}

/** Shapes an LRCLIB entry for the UI. */
export function toLyrics(item) {
  return {
    id: item.id,
    artist: item.artistName,
    title: item.trackName,
    duration: item.duration || 0,
    instrumental: !!item.instrumental,
    synced: item.syncedLyrics ? parseLrc(item.syncedLyrics) : null,
    plain: item.plainLyrics || (item.syncedLyrics ? parseLrc(item.syncedLyrics).map((l) => l.text).join('\n') : ''),
  };
}

/** Free-text lyrics search, for "wrong lyrics? pick another". */
export async function searchLyrics(query) {
  const list = (await api(`/search?q=${encodeURIComponent(query)}`)) || [];
  return list.filter((i) => i.syncedLyrics || i.plainLyrics || i.instrumental).slice(0, 12);
}

/**
 * Resolves to lyrics (see toLyrics) or null when nothing fits.
 * @param duration seconds, used to pick the right version
 */
export function getLyrics(track, duration = track.duration) {
  if (cache.has(track.id)) return cache.get(track.id);
  const promise = (async () => {
    const ctx = context(track, duration);
    const { guess, parts } = ctx;
    const q = (text) => `/search?q=${encodeURIComponent(text)}`;
    const queries = [
      `/search?track_name=${encodeURIComponent(guess.title)}&artist_name=${encodeURIComponent(guess.artist)}`,
      q(`${guess.artist} ${guess.title}`),
    ];
    // channel name as artist covers "Song (Official Video)" uploads on the artist's channel
    const channel = cleanArtist(track.author);
    if (channel && compact(channel) !== compact(guess.artist)) {
      queries.push(`/search?track_name=${encodeURIComponent(guess.title)}&artist_name=${encodeURIComponent(channel)}`);
    }
    // "Song - Movie | Actors | Singer": try the first part as the song, with the other parts as hints
    if (parts.length > 1) {
      queries.push(q(parts[0]), q(`${parts[0]} ${parts.at(-1)}`));
    }

    let best = null;
    let bestScore = 4; // needs at least a title match plus something else
    let failure = null;
    for (const path of [...new Set(queries)]) {
      let list;
      try {
        list = (await api(path)) || [];
      } catch (err) {
        failure = err;
        if (/429/.test(err.message)) break; // being rate limited: don't pile on
        continue;
      }
      for (const item of list) {
        const s = score(item, ctx);
        if (s > bestScore) {
          best = item;
          bestScore = s;
        }
      }
      if (bestScore >= 8.5) break; // title and artist fit, and the length is close
    }
    if (!best && failure) throw failure;
    return best ? toLyrics(best) : null;
  })();
  cache.set(track.id, promise);
  promise.catch(() => cache.delete(track.id));
  return promise;
}
