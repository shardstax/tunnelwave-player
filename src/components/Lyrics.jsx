import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MicVocal, RotateCcw, Search, X } from 'lucide-react';
import { useEngineState } from '../lib/hooks';
import { getLyrics, guessSong, searchLyrics, toLyrics } from '../lib/lyrics';
import { formatTime } from '../lib/format';

// lyrics the user picked by hand, per video (this session only)
const picked = new Map();

// per-video timing fixes, remembered across reloads
const OFFSETS_KEY = 'tq.lyricsOffsets';
function loadOffsets() {
  try {
    return JSON.parse(localStorage.getItem(OFFSETS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveOffset(id, value) {
  try {
    const all = loadOffsets();
    if (value) all[id] = value;
    else delete all[id];
    const trimmed = Object.fromEntries(Object.entries(all).slice(-200));
    localStorage.setItem(OFFSETS_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable */
  }
}

// synced timing only lines up when we're playing the same version the lyrics were timed to
const SYNC_TOLERANCE = 3;

/** Index of the line being sung at `time`, or -1 before the first line. */
function lineAt(lines, time) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function Picker({ track, onPick, onCancel }) {
  const guess = guessSong(track);
  const [query, setQuery] = useState(`${guess.artist} ${guess.title}`.trim());
  const [state, setState] = useState({ status: 'idle', list: [] });

  const run = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setState({ status: 'loading', list: [] });
    try {
      setState({ status: 'done', list: await searchLyrics(query.trim()) });
    } catch {
      setState({ status: 'error', list: [] });
    }
  };

  useEffect(() => {
    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lyrics-picker">
      <form className="inline-form" onSubmit={run}>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Artist and song name" aria-label="Search lyrics" />
        <button className="btn btn-accent btn-sm" disabled={!query.trim()}>
          <Search size={15} /> Search
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </form>
      {state.status === 'loading' && <p className="muted small">Searching…</p>}
      {state.status === 'error' && <p className="muted small">Couldn’t reach the lyrics service. Try again in a moment.</p>}
      {state.status === 'done' && !state.list.length && <p className="muted small">Nothing found. Try fewer words.</p>}
      <ul className="lyrics-results">
        {state.list.map((item) => (
          <li key={item.id}>
            <button onClick={() => onPick(toLyrics(item))}>
              <span className="track-text">
                <span className="track-title">{item.trackName}</span>
                <span className="track-author">
                  {item.artistName}
                  {item.duration > 0 && ` · ${formatTime(item.duration)}`}
                </span>
              </span>
              <span className={`tag ${item.syncedLyrics ? 'is-on' : ''}`}>
                {item.instrumental ? 'Instrumental' : item.syncedLyrics ? 'Synced' : 'Text only'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Spotify-style lyrics: the line being sung lights up and stays in view, tap a line to jump there.
 * Falls back to plain text when the song has no timing, or when this upload is a different length
 * from the version the lyrics were timed to (music videos with an intro, for example).
 */
export default function Lyrics({ engine, track, onClose }) {
  const engineState = useEngineState(engine);
  const [state, setState] = useState({ status: 'loading', lyrics: null });
  const [picking, setPicking] = useState(false);
  const [forceSynced, setForceSynced] = useState(false);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(-1);
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);
  const userScrollUntil = useRef(0);

  useEffect(() => {
    setPicking(false);
    setForceSynced(false);
    setActive(-1);
    if (!track) return;
    setOffset(loadOffsets()[track.id] || 0);
    if (picked.has(track.id)) {
      setState({ status: 'ready', lyrics: picked.get(track.id) });
      return;
    }
    setState({ status: 'loading', lyrics: null });
    let cancelled = false;
    getLyrics(track, engine.duration || track.duration)
      .then((lyrics) => !cancelled && setState({ status: lyrics ? 'ready' : 'none', lyrics }))
      .catch(() => !cancelled && setState({ status: 'error', lyrics: null }));
    return () => {
      cancelled = true;
    };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lyrics = state.lyrics;
  const duration = engine.duration || track?.duration || 0;
  const lengthGap = lyrics?.duration && duration ? Math.abs(lyrics.duration - duration) : 0;
  const timingFits = lengthGap <= SYNC_TOLERANCE;
  const lines = useMemo(() => (lyrics?.synced?.length ? lyrics.synced : null), [lyrics]);
  const synced = !!lines && (timingFits || forceSynced);

  // follow the song smoothly; only re-render when the line changes
  useEffect(() => {
    if (!synced) return;
    let raf;
    let last = -2;
    const tick = () => {
      const i = lineAt(lines, engine.currentTime + offset);
      if (i !== last) {
        last = i;
        setActive(i);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [synced, lines, offset, engine]);

  // keep the current line a bit above the middle, unless the user is scrolling around
  useEffect(() => {
    if (!synced || Date.now() < userScrollUntil.current) return;
    const box = scrollRef.current;
    const el = lineRefs.current[Math.max(active, 0)];
    if (!box || !el) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.38, behavior: 'smooth' });
  }, [active, synced]);

  const holdScroll = () => {
    userScrollUntil.current = Date.now() + 4000;
  };

  const nudge = (delta) => {
    const value = Math.round((offset + delta) * 10) / 10;
    setOffset(value);
    saveOffset(track.id, value);
  };

  const pick = (chosen) => {
    picked.set(track.id, chosen);
    setState({ status: 'ready', lyrics: chosen });
    setPicking(false);
    setForceSynced(false);
  };

  let body;
  if (picking) {
    body = <Picker track={track} onPick={pick} onCancel={() => setPicking(false)} />;
  } else if (state.status === 'loading') {
    body = (
      <div className="lyrics-message">
        <Loader2 className="spin" size={26} />
        <p>Finding lyrics…</p>
      </div>
    );
  } else if (state.status === 'none' || state.status === 'error' || (!lyrics.plain && !lyrics.instrumental)) {
    body = (
      <div className="lyrics-message">
        <MicVocal size={30} />
        <p>{state.status === 'error' ? 'Couldn’t reach the lyrics service.' : 'No lyrics found for this song.'}</p>
        <button className="btn btn-sm" onClick={() => setPicking(true)}>
          <Search size={15} /> Search lyrics
        </button>
      </div>
    );
  } else if (lyrics.instrumental) {
    body = (
      <div className="lyrics-message">
        <MicVocal size={30} />
        <p>This one’s instrumental. Enjoy the music.</p>
      </div>
    );
  } else if (synced) {
    body = (
      <div className="lyrics-lines">
        {lines.map((line, i) => (
          <button
            key={i}
            ref={(el) => (lineRefs.current[i] = el)}
            className={`lyric ${i === active ? 'is-active' : i < active ? 'is-past' : ''}`}
            onClick={() => {
              userScrollUntil.current = 0;
              engine.seek(Math.max(0, line.time - offset));
            }}
          >
            {line.text || '♪'}
          </button>
        ))}
      </div>
    );
  } else {
    body = <div className="lyrics-plain">{lyrics.plain}</div>;
  }

  const showTiming = state.status === 'ready' && !picking && lines;

  return (
    <section className="panel lyrics" aria-label="Lyrics">
      <header className="lyrics-head">
        <div className="lyrics-title">
          <h2>
            <MicVocal size={17} /> Lyrics
          </h2>
          {lyrics && !picking && (
            <p className="muted small" title="Matched song">
              {lyrics.title} · {lyrics.artist}
            </p>
          )}
        </div>
        <div className="lyrics-tools">
          {showTiming && synced && (
            <div className="lyrics-sync" title="If the words run ahead of or behind the singing, nudge them">
              <button className="btn btn-sm" onClick={() => nudge(-0.5)}>
                Later
              </button>
              <span className="lyrics-offset">{offset === 0 ? 'In sync' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
              <button className="btn btn-sm" onClick={() => nudge(0.5)}>
                Earlier
              </button>
              {offset !== 0 && (
                <button className="icon-btn" onClick={() => nudge(-offset)} title="Reset timing">
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          )}
          {state.status === 'ready' && !picking && (
            <button className="btn btn-sm" onClick={() => setPicking(true)} title="Search for different lyrics">
              Wrong lyrics?
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close lyrics (L)" aria-label="Close lyrics">
            <X size={18} />
          </button>
        </div>
      </header>

      {showTiming && !timingFits && (
        <p className="lyrics-note small">
          {synced
            ? 'This version is a different length from the one the lyrics were timed to, so use Later / Earlier to line them up.'
            : 'This version is a different length from the one the lyrics were timed to, so they’re shown without timing.'}{' '}
          <button className="link-btn" onClick={() => setForceSynced((v) => !v)}>
            {synced ? 'Show without timing' : 'Sync anyway'}
          </button>
        </p>
      )}

      <div
        ref={scrollRef}
        className={`lyrics-scroll ${engineState.status === 'playing' ? 'is-playing' : ''}`}
        onWheel={holdScroll}
        onTouchMove={holdScroll}
      >
        {body}
      </div>

      <p className="lyrics-credit">
        Lyrics from{' '}
        <a href="https://lrclib.net" target="_blank" rel="noreferrer">
          LRCLIB
        </a>
      </p>
    </section>
  );
}
