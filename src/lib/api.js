// Talks to public Piped / Invidious instances (open-source YouTube front-ends).
// Instances go down often, so every call walks a list of them until one answers.
import { thumbnail, toTrack } from './youtube';

export const DEFAULT_INSTANCES = [
  { type: 'piped', base: 'https://api.piped.private.coffee' },
  { type: 'invidious', base: 'https://yt.chocolatemoo53.com' },
  { type: 'piped', base: 'https://pipedapi.kavin.rocks' },
  { type: 'piped', base: 'https://pipedapi.leptons.xyz' },
  { type: 'piped', base: 'https://pipedapi.reallyaweso.me' },
  { type: 'invidious', base: 'https://inv.nadeko.net' },
  { type: 'invidious', base: 'https://invidious.nerdvpn.de' },
];

const TIMEOUT_MS = 9000;
const LAST_GOOD_KEY = 'tq.lastGoodInstance';
const DISCOVERED_KEY = 'tq.discoveredInstances';
const DISCOVERY_TTL = 6 * 60 * 60 * 1000;

let customInstance = null;

/** Set from the settings screen. Pass null to clear. */
export function setCustomInstance(inst) {
  customInstance = inst?.base ? { type: inst.type, base: inst.base.trim().replace(/\/+$/, '') } : null;
}

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked; not fatal */
  }
};

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(String(data.error).slice(0, 120));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function candidates(exclude, prefer) {
  const lastGood = readJSON(LAST_GOOD_KEY, null);
  const discovered = readJSON(DISCOVERED_KEY, { list: [] }).list;
  const all = [...DEFAULT_INSTANCES, ...discovered];
  // last instance that worked goes first; a custom instance always goes before that
  all.sort((a, b) => (b.base === lastGood) - (a.base === lastGood));
  // some calls only work (well) on one kind of server
  if (prefer) all.sort((a, b) => (b.type === prefer) - (a.type === prefer));
  if (customInstance) all.unshift(customInstance);

  const seen = new Set();
  return all.filter((i) => {
    if (seen.has(i.base) || exclude.has(i.base)) return false;
    seen.add(i.base);
    return true;
  });
}

/** Fetches fresh instance lists from the Piped and Invidious directories. */
export async function discoverInstances() {
  const [piped, inv] = await Promise.allSettled([
    getJSON('https://piped-instances.kavin.rocks/'),
    getJSON('https://api.invidious.io/instances.json?sort_by=health'),
  ]);
  const list = [];
  if (piped.status === 'fulfilled' && Array.isArray(piped.value)) {
    for (const p of piped.value.slice(0, 8)) {
      if (p.api_url) list.push({ type: 'piped', base: p.api_url.replace(/\/+$/, '') });
    }
  }
  if (inv.status === 'fulfilled' && Array.isArray(inv.value)) {
    for (const [, i] of inv.value) {
      if (i?.type === 'https' && i.api && i.cors) list.push({ type: 'invidious', base: i.uri.replace(/\/+$/, '') });
    }
  }
  writeJSON(DISCOVERED_KEY, { at: Date.now(), list });
  return list;
}

/**
 * Runs `op[type](base)` against instances until one succeeds.
 * Tries the preferred instance alone first, then the rest in parallel batches.
 * `remember: false` keeps side requests (like radio) from changing which server playback tries first.
 */
async function request(op, exclude = new Set(), { prefer, remember = true } = {}) {
  const tried = new Set(exclude);
  let lastError;

  const attempt = async (inst) => {
    tried.add(inst.base);
    const result = await op[inst.type](inst.base);
    if (remember) writeJSON(LAST_GOOD_KEY, inst.base);
    return { ...result, source: inst };
  };

  for (let pass = 0; pass < 2; pass++) {
    const list = candidates(tried, prefer);
    if (list.length) {
      try {
        return await attempt(list[0]);
      } catch (e) {
        lastError = e;
      }
      const rest = list.slice(1);
      for (let i = 0; i < rest.length; i += 3) {
        try {
          return await Promise.any(rest.slice(i, i + 3).map(attempt));
        } catch (e) {
          lastError = e.errors?.at(-1) ?? e;
        }
      }
    }
    // everything failed: refresh the instance directory once and go again
    const cache = readJSON(DISCOVERED_KEY, { at: 0 });
    if (pass > 0 || Date.now() - cache.at < DISCOVERY_TTL / 6) break;
    await discoverInstances().catch(() => {});
  }
  throw new Error(`No server responded${lastError ? ` (${lastError.message})` : ''}. Try again or add your own instance in Settings.`);
}

// ---------- normalizers ----------

/**
 * Language of an audio stream, for videos with dubbed tracks.
 * YouTube tags each stream URL with e.g. xtags=acont=dubbed:lang=hi; Piped also sends explicit fields.
 * Returns { lang, kind } where kind is original | dubbed | descriptive | null (single-language video).
 */
function audioTrackOf(url, piped = {}) {
  let lang = piped.audioTrackLocale || piped.audioTrackId?.split('.')[0] || null;
  let kind = piped.audioTrackType?.toLowerCase() || null;
  try {
    const xtags = new URL(url).searchParams.get('xtags') || '';
    for (const part of xtags.split(':')) {
      const [k, v] = part.split('=');
      if (k === 'lang' && !lang) lang = v;
      if (k === 'acont' && !kind) kind = v;
    }
  } catch {
    /* not a URL we can read; treat as single-language */
  }
  if (kind === 'secondary') kind = 'dubbed';
  return { lang, kind: lang ? kind || 'dubbed' : null };
}

const pipedId = (url = '') => new URLSearchParams(url.split('?')[1]).get('v');

const fromPiped = (item) => {
  const id = pipedId(item.url);
  return id
    ? toTrack({ id, title: item.title, author: item.uploaderName || item.uploader, duration: item.duration })
    : null;
};

const fromInvidious = (v) =>
  toTrack({ id: v.videoId, title: v.title, author: v.author, duration: v.lengthSeconds });

// ---------- public API ----------

export async function search(query, filter = 'videos') {
  const q = encodeURIComponent(query);
  const { tracks } = await request({
    piped: async (base) => {
      const f = filter === 'music' ? 'music_songs' : 'videos';
      const data = await getJSON(`${base}/search?q=${q}&filter=${f}`);
      if (!Array.isArray(data.items)) throw new Error('Bad search response');
      return { tracks: data.items.filter((i) => i.type === 'stream').map(fromPiped).filter(Boolean) };
    },
    invidious: async (base) => {
      const data = await getJSON(`${base}/api/v1/search?q=${q}&type=video`);
      if (!Array.isArray(data)) throw new Error('Bad search response');
      return { tracks: data.filter((v) => v.type === 'video').map(fromInvidious) };
    },
  });
  return tracks;
}

const videoCache = new Map();
const inflight = new Map();
const CACHE_MS = 30 * 60 * 1000;

/**
 * Returns { track, audio[], video[], related[], source } for one video.
 * audio/video entries are { url, mime, bitrate|height }; video means muxed (picture + sound).
 */
export async function getVideo(id, { exclude } = {}) {
  const retrying = exclude?.size > 0;
  const cached = videoCache.get(id);
  if (!retrying && cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  // share one request when the same video is asked for twice at once
  if (!retrying && inflight.has(id)) return inflight.get(id);
  const pending = fetchVideo(id, exclude);
  if (!retrying) {
    inflight.set(id, pending);
    pending.finally(() => inflight.delete(id)).catch(() => {});
  }
  return pending;
}

async function fetchVideo(id, exclude) {
  const data = await request(
    {
      piped: async (base) => {
        const d = await getJSON(`${base}/streams/${id}`);
        const audio = (d.audioStreams || []).map((s) => ({
          url: s.url,
          mime: s.mimeType,
          bitrate: s.bitrate || 0,
          ...audioTrackOf(s.url, s),
        }));
        const video = (d.videoStreams || [])
          .filter((s) => !s.videoOnly && /^\d+p/.test(s.quality || ''))
          .map((s) => ({ url: s.url, mime: s.mimeType, height: parseInt(s.quality, 10) }));
        if (!audio.length && !video.length) throw new Error('No playable streams');
        return {
          track: toTrack({ id, title: d.title, author: d.uploader, duration: d.duration }),
          audio,
          video,
          related: (d.relatedStreams || []).filter((s) => s.type === 'stream').map(fromPiped).filter(Boolean),
        };
      },
      invidious: async (base) => {
        const d = await getJSON(`${base}/api/v1/videos/${id}?local=true`);
        const abs = (u) => new URL(u, base).href;
        const audio = (d.adaptiveFormats || [])
          .filter((f) => f.type?.startsWith('audio/'))
          .map((f) => ({
            url: abs(f.url),
            mime: f.type.split(';')[0],
            bitrate: Number(f.bitrate) || 0,
            ...audioTrackOf(abs(f.url), {
              audioTrackLocale: f.audioTrack?.id?.split('.')[0],
              audioTrackType: f.audioTrack ? (f.audioTrack.isDefault ?? f.audioTrack.audioIsDefault ? 'original' : 'dubbed') : undefined,
            }),
          }));
        const video = (d.formatStreams || []).map((f) => ({
          url: abs(f.url),
          mime: f.type?.split(';')[0] || 'video/mp4',
          height: parseInt(f.resolution || f.qualityLabel || '0', 10),
        }));
        if (!audio.length && !video.length) throw new Error('No playable streams');
        return {
          track: toTrack({ id, title: d.title, author: d.author, duration: d.lengthSeconds }),
          audio,
          video,
          related: (d.recommendedVideos || []).map(fromInvidious),
        };
      },
    },
    exclude,
  );

  videoCache.set(id, { at: Date.now(), data });
  return data;
}

/** Loads a YouTube playlist (first ~500 items). */
export async function getPlaylist(listId) {
  const id = encodeURIComponent(listId);
  return request({
    piped: async (base) => {
      const d = await getJSON(`${base}/playlists/${id}`);
      const items = [...(d.relatedStreams || [])];
      let next = d.nextpage;
      for (let page = 0; next && page < 5; page++) {
        const more = await getJSON(`${base}/nextpage/playlists/${id}?nextpage=${encodeURIComponent(next)}`);
        items.push(...(more.relatedStreams || []));
        next = more.nextpage;
      }
      const tracks = items.map(fromPiped).filter(Boolean);
      // some instances return the playlist name with no items; let another server try
      if (!tracks.length) throw new Error('Playlist came back empty');
      return { title: d.name || 'YouTube playlist', tracks };
    },
    invidious: async (base) => {
      const d = await getJSON(`${base}/api/v1/playlists/${id}`);
      const tracks = (d.videos || []).map(fromInvidious);
      if (!tracks.length) throw new Error('Playlist came back empty');
      return { title: d.title || 'YouTube playlist', tracks };
    },
  });
}

const radioCache = new Map();
const RADIO_CACHE_MS = 60 * 60 * 1000;

/**
 * Songs YouTube itself would play after `id`: its "Mix" radio (the YouTube Music radio algorithm),
 * or plain related videos when no server can build a mix. Resolves to { tracks, kind: 'mix' | 'related' }.
 */
export function getRadio(id) {
  const cached = radioCache.get(id);
  if (cached && Date.now() - cached.at < RADIO_CACHE_MS) return cached.promise;
  const promise = request(
    {
      piped: async (base) => {
        const d = await getJSON(`${base}/playlists/RD${encodeURIComponent(id)}`);
        const tracks = (d.relatedStreams || []).map(fromPiped).filter(Boolean);
        if (tracks.length < 5) throw new Error('No mix for this song');
        return { tracks, kind: 'mix' };
      },
      invidious: async (base) => {
        // Invidious mixes are broken or disabled on most servers, so use related videos instead
        const known = videoCache.get(id)?.data?.related;
        const tracks = known?.length
          ? known
          : ((await getJSON(`${base}/api/v1/videos/${id}?fields=recommendedVideos`)).recommendedVideos || []).map(fromInvidious);
        if (!tracks.length) throw new Error('No related videos');
        return { tracks, kind: 'related' };
      },
    },
    new Set(),
    { prefer: 'piped', remember: false },
  );
  radioCache.set(id, { at: Date.now(), promise });
  promise.catch(() => radioCache.delete(id));
  return promise;
}

/** Quick health check used by the Settings screen. */
export async function testInstance(inst) {
  const base = inst.base.trim().replace(/\/+$/, '');
  const url = inst.type === 'piped' ? `${base}/search?q=test&filter=videos` : `${base}/api/v1/search?q=test&type=video`;
  await getJSON(url);
  return true;
}

export { thumbnail };
