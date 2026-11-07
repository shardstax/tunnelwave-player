// Spotify-style preloading: the next song's audio is downloaded in the background, so skipping
// or reaching the end of a song starts the next one instantly, and it then plays from memory
// without depending on the server.
//
// Kept light on purpose:
//  - audio only (~1 MB a minute), never video
//  - at most two songs in memory (the one playing and the next); anything else is dropped at once
//  - long uploads (mixes, hour-long videos) and oversized files are never downloaded
//  - a download that isn't needed any more (skipped, queue changed) is cancelled immediately

const MAX_SONGS = 2;
export const MAX_PRELOAD_SECONDS = 10 * 60;
const MAX_BYTES = 15 * 1024 * 1024;

/** False on low-memory devices and when the browser asks to save data. */
export function preloadSupported() {
  const mem = navigator.deviceMemory; // GB, rounded; undefined outside Chromium
  if (mem !== undefined && mem < 2) return false;
  if (navigator.connection?.saveData) return false;
  return typeof fetch === 'function' && typeof AbortController === 'function';
}

export class AudioPreloader {
  constructor() {
    this.entries = new Map(); // videoId -> { url, status, controller, objectUrl, promise }
    this.pinned = null; // the song that's playing: never trimmed away underneath the player
  }

  /** Starts downloading `stream.url` for `id` (no-op if it's already there or on its way). */
  fetch(id, stream) {
    const existing = this.entries.get(id);
    if (existing && existing.url === stream.url && existing.status !== 'failed') return existing.promise;
    if (existing) this.drop(id);

    const controller = new AbortController();
    const entry = { url: stream.url, status: 'loading', controller, objectUrl: null, promise: null, at: Date.now() };
    entry.promise = download(stream.url, stream.mime, controller.signal)
      .then((blob) => {
        if (this.entries.get(id) !== entry) return null;
        entry.objectUrl = URL.createObjectURL(blob);
        entry.status = 'ready';
        entry.bytes = blob.size;
        this.trim();
        return entry.objectUrl;
      })
      .catch(() => {
        // not allowed (some servers block downloads), too big, or cancelled: just stream it normally
        if (this.entries.get(id) === entry) entry.status = 'failed';
        return null;
      });
    this.entries.set(id, entry);
    this.trim();
    return entry.promise;
  }

  /** A blob: URL for this exact stream if it's fully downloaded, else null. */
  ready(id, streamUrl) {
    const e = this.entries.get(id);
    return e && e.status === 'ready' && e.url === streamUrl ? e.objectUrl : null;
  }

  /** Keeps only these songs; everything else is cancelled and freed. */
  keepOnly(ids) {
    const keep = new Set(ids.filter(Boolean));
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.drop(id);
  }

  drop(id) {
    const e = this.entries.get(id);
    if (!e) return;
    e.controller.abort();
    // the player may still be letting go of it (switching songs), so free it a moment later
    if (e.objectUrl) setTimeout(() => URL.revokeObjectURL(e.objectUrl), 10000);
    this.entries.delete(id);
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  // never more than MAX_SONGS: the oldest goes first
  trim() {
    while (this.entries.size > MAX_SONGS) {
      const candidates = [...this.entries.entries()].filter(([id]) => id !== this.pinned);
      if (!candidates.length) break;
      this.drop(candidates.sort((a, b) => a[1].at - b[1].at)[0][0]);
    }
  }

  /** For the settings screen / debugging: how much audio is held right now. */
  get bytesHeld() {
    let n = 0;
    for (const e of this.entries.values()) n += e.bytes || 0;
    return n;
  }
}

async function download(url, mime, signal) {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length')) || 0;
  if (length > MAX_BYTES) throw new Error('Too big to preload');

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('Too big to preload');
    }
    chunks.push(value);
  }
  if (!total) throw new Error('Empty download');
  return new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] });
}
