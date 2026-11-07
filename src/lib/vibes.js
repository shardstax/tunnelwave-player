// Vibe stations: a never-ending station for a mood ("Gym Hindi", "Work focus", …) or anything you type.
//
// How a station is built, all on-device:
//  1. Search YouTube for playlists matching the vibe, putting YouTube Music's own curated ones first.
//  2. Load a few of them and blend: songs that several playlists share rank higher.
//  3. Run the same clean-up as autoplay (no compilations, 10-hour loops, slowed/cover versions
//     unless the vibe asks for them), skip songs you've skipped before, and lift artists you like.
//  4. When the station runs low, the next few playlists top it up.
import { getPlaylist, searchPlaylists } from './api';
import { buildStation } from './radio';

export const VIBES = [
  // what's hot
  { id: 'trending-hindi', name: 'Trending Hindi', hint: 'What everyone’s playing now', query: 'trending hindi songs', icon: 'TrendingUp', hue: 0 },
  { id: 'pop-hits', name: 'Pop Hits', hint: 'Today’s English pop', query: 'english pop hits', icon: 'Star', hue: 290 },
  // moods & moments
  { id: 'gym', name: 'Gym', hint: 'High-energy workout hits', query: 'workout hits', icon: 'Dumbbell', hue: 8 },
  { id: 'gym-hindi', name: 'Gym Hindi', hint: 'Bollywood workout bangers', query: 'hindi gym workout songs', icon: 'Flame', hue: 24 },
  { id: 'focus', name: 'Work Focus', hint: 'Mostly instrumental electronic', query: 'electronic focus music', icon: 'Brain', hue: 205 },
  { id: 'lofi', name: 'Lofi', hint: 'Chill beats to study to', query: 'lofi girl', icon: 'Coffee', hue: 265 },
  { id: 'party', name: 'Party', hint: 'Dance-floor hits', query: 'party dance hits', icon: 'PartyPopper', hue: 315 },
  { id: 'bollywood-party', name: 'Bollywood Party', hint: 'Shaadi & club anthems', query: 'bollywood party songs', icon: 'Disc3', hue: 335 },
  { id: 'romantic-hindi', name: 'Romantic Hindi', hint: 'Bollywood love songs', query: 'hindi romantic songs', icon: 'HeartHandshake', hue: 350 },
  { id: 'sad-hindi', name: 'Sad Hindi', hint: 'Heartbreak & feels', query: 'hindi sad songs', icon: 'CloudRain', hue: 220 },
  { id: 'unplugged', name: 'Unplugged', hint: 'Acoustic Bollywood', query: 'bollywood unplugged', icon: 'Guitar', hue: 32 },
  { id: 'chill', name: 'Chill', hint: 'Easy, feel-good songs', query: 'chill vibes songs', icon: 'Sun', hue: 170 },
  { id: 'road-trip', name: 'Road Trip', hint: 'Windows-down singalongs', query: 'road trip songs', icon: 'Car', hue: 120 },
  // genres & eras
  { id: 'punjabi', name: 'Punjabi Hits', hint: 'Bhangra & Punjabi pop', query: 'punjabi hit songs', icon: 'Zap', hue: 45 },
  { id: 'hindi-indie', name: 'Hindi Indie', hint: 'Anuv Jain & new voices', query: 'hindi indie songs', icon: 'Feather', hue: 150 },
  { id: 'hindi-hiphop', name: 'Hindi Hip Hop', hint: 'Divine, Emiway, KR$NA & more', query: 'hindi rap songs', icon: 'Mic2', hue: 230 },
  { id: 'sufi', name: 'Sufi', hint: 'Soulful qawwali & Coke Studio', query: 'sufi songs', icon: 'Sparkle', hue: 40 },
  { id: 'retro-bollywood', name: '90s Bollywood', hint: 'Evergreen classics', query: '90s bollywood hits', icon: 'Radio', hue: 30 },
  { id: 'old-gold', name: 'Old is Gold', hint: 'Kishore, Lata, Rafi', query: 'old hindi songs kishore kumar lata mangeshkar', icon: 'Gem', hue: 48 },
  { id: 'k-pop', name: 'K-Pop', hint: 'Korean pop hits', query: 'kpop hits', icon: 'Music2', hue: 325 },
];

/** A vibe for anything the user types, e.g. "arijit sad songs". */
export function customVibe(text) {
  const query = text.trim().replace(/\s+/g, ' ');
  return { id: `custom:${query.toLowerCase()}`, name: query, hint: 'Your vibe', query, icon: 'WandSparkles', hue: 280, custom: true };
}

const PLAYLISTS_PER_ROUND = 6;

const FILLER = new Set(['songs', 'song', 'music', 'hits', 'hit', 'playlist', 'best', 'top', 'new', 'latest', 'for', 'the', 'and', 'of']);
const LANGUAGES = ['hindi', 'english', 'punjabi', 'tamil', 'telugu', 'marathi', 'bengali', 'gujarati', 'kannada', 'malayalam', 'bhojpuri', 'haryanvi', 'urdu', 'korean', 'spanish', 'arabic'];
const words = (s) => s.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a playlist fits the vibe (0.2 – 1.5): its name should share the vibe's key words,
 * and shouldn't promise other languages ("Hindi, English, Punjabi" lists dilute a Hindi station).
 */
function relevance(list, query) {
  const want = words(query).filter((w) => !FILLER.has(w));
  const name = new Set(words(list.name));
  const matched = want.filter((w) => name.has(w) || [...name].some((n) => n.startsWith(w) || w.startsWith(n))).length;
  let score = 0.4 + (want.length ? matched / want.length : 0.5);
  const otherLangs = LANGUAGES.filter((l) => name.has(l) && !want.includes(l)).length;
  if (otherLangs) score *= 0.5 ** otherLangs;
  if (list.official) score += 0.3;
  return Math.max(0.2, score);
}

// deleted / private entries come back as "Untitled video", "[Deleted video]" with no length
const isPlayable = (t) => t.duration > 0 && !/^\[(deleted|private)|^untitled video$|^deleted video$|^private video$/i.test(t.title);

// fan edits and speeches turn up in "motivation" playlists; a music station doesn't want them
const NOT_MUSIC = /\bamv\b|\banime\b|\bedit\b|\bspeech\b|\bmotivational video\b|\bpodcast\b/i;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Builds (round 0) or tops up (round 1, 2, …) a vibe station.
 * Resolves to a ranked track list; rejects if nothing could be found.
 */
export async function buildVibe(vibe, { round = 0, avoid = [], taste, favouriteIds } = {}) {
  const lists = await searchPlaylists(vibe.query);
  // best-fitting playlists first (YouTube Music's own curated ones get a lift); search order breaks ties
  const ordered = lists
    .map((l, i) => ({ ...l, fit: relevance(l, vibe.query), i }))
    .sort((a, b) => b.fit - a.fit || a.i - b.i);
  const start = (round * PLAYLISTS_PER_ROUND) % Math.max(1, ordered.length);
  const picked = [...ordered, ...ordered].slice(start, start + Math.min(PLAYLISTS_PER_ROUND, ordered.length));

  const loaded = await Promise.allSettled(picked.map((l) => getPlaylist(l.id, { pages: 1, side: true })));
  // the vibe's own words act as the "seed", so a "lofi" or "slowed" vibe keeps those versions
  const seedTrack = { id: '', title: vibe.query, author: '', duration: 0 };
  const seeds = loaded.flatMap((r, i) =>
    r.status === 'fulfilled'
      ? // playlist order says little about how good a song is, so shuffle it; agreement between playlists still counts
        [{ track: seedTrack, tracks: shuffle(r.value.tracks.filter((t) => isPlayable(t) && !NOT_MUSIC.test(t.title))), weight: picked[i].fit }]
      : [],
  );
  if (!seeds.length) throw new Error('No playlists could be loaded');

  const ranked = buildStation({ seeds, avoid, taste, favouriteIds, limit: 250 });
  // one channel shouldn't take over the station (some playlists are 80% one uploader)
  const cap = Math.max(4, Math.ceil(ranked.length * 0.12));
  const perArtist = new Map();
  const tracks = ranked.filter((t) => {
    const n = (perArtist.get(t.author) || 0) + 1;
    perArtist.set(t.author, n);
    return n <= cap;
  });
  if (!tracks.length) throw new Error('No songs found for this vibe');
  return tracks;
}
