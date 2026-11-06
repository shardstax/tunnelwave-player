const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

/**
 * Parses any YouTube link (watch, youtu.be, shorts, embed, live, music, playlist).
 * Returns { videoId, playlistId } or null when the text isn't a YouTube link.
 */
export function parseYouTubeUrl(input) {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;

  let url;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (!HOSTS.includes(host)) return null;

  let videoId = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0];
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
    if (m) videoId = m[1];
  }
  if (videoId && !ID_RE.test(videoId)) videoId = null;

  const playlistId = url.searchParams.get('list');
  if (!videoId && !playlistId) return null;
  return { videoId, playlistId };
}

export const thumbnail = (id, quality = 'mqdefault') =>
  `https://i.ytimg.com/vi/${id}/${quality}.jpg`;

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** Keeps only the fields we store, so saved data stays small and stable. */
export const toTrack = ({ id, title, author, duration, thumbnail: thumb }) => ({
  id,
  title: title || 'Untitled video',
  author: author || '',
  duration: duration > 0 ? Math.round(duration) : 0,
  thumbnail: thumb || thumbnail(id),
});
