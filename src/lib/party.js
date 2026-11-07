// "Party queue" links: the song that's playing plus the queue, packed into the link itself
// (after the #, so it never reaches a server). Whoever opens it gets the same lineup.

const MAX_SONGS = 100;
const KEY = 'party';

const toBase64Url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Builds a shareable link for these tracks. */
export async function partyLink(tracks) {
  const list = tracks.slice(0, MAX_SONGS).map((t) => [t.id, t.title || '', t.author || '', Math.round(t.duration || 0)]);
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, t: list }));
  // compressed when the browser can (links get ~3× shorter); "z" / "j" says which
  let data;
  if (typeof CompressionStream === 'function') data = `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  else data = `j${toBase64Url(json)}`;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `${KEY}=${data}`;
  return url.toString();
}

/** Reads a party queue from the current URL, or null. Resolves to [{ id, title, author, duration }]. */
export async function readPartyLink(hash = window.location.hash) {
  const match = hash.match(new RegExp(`[#&]${KEY}=([zj])([\\w-]+)`));
  if (!match) return null;
  try {
    let bytes = fromBase64Url(match[2]);
    if (match[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const tracks = (Array.isArray(data.t) ? data.t : [])
      .filter((x) => Array.isArray(x) && /^[\w-]{11}$/.test(x[0]))
      .slice(0, MAX_SONGS)
      .map(([id, title, author, duration]) => ({ id, title: String(title || 'YouTube video'), author: String(author || ''), duration: Number(duration) || 0 }));
    return tracks.length ? tracks : null;
  } catch {
    return null;
  }
}

/** Removes the party data from the address bar (after it has been read). */
export function clearPartyLink() {
  if (!window.location.hash.includes(`${KEY}=`)) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
