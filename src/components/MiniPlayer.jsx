import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Heart, Loader2, Pause, Play, Plus, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import { search as searchApi } from '../lib/api';
import { useEngineState, useEngineTime } from '../lib/hooks';
import { thumbnail } from '../lib/youtube';
import { formatTime } from '../lib/format';

/**
 * Opens an always-on-top window (Chrome / Edge "Document Picture-in-Picture") and copies the app's
 * styles and colours into it. Resolves to the window, or null if the browser can't do it.
 */
export async function openMiniWindow() {
  if (!('documentPictureInPicture' in window)) return null;
  const win = await window.documentPictureInPicture.requestWindow({ width: 400, height: 212 });
  const doc = win.document;
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      doc.head.append(style);
    } catch {
      // stylesheets from other sites (fonts) can't be read, but can be linked
      if (sheet.href) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.append(link);
      }
    }
  }
  doc.title = 'Tunnelwave';
  doc.body.className = 'mini-body';
  // follow the theme and the colour taken from each song's artwork
  const sync = () => {
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
    doc.documentElement.style.cssText = document.documentElement.style.cssText;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
  win.addEventListener('pagehide', () => observer.disconnect());
  return win;
}

const SEARCH_DEBOUNCE_MS = 350;
// compact player height, and how tall the window gets while searching
const COMPACT_H = 212;
const SEARCH_H = 500;

/** Search inside the floating window: type, then play a result or add it to the queue. */
function MiniSearch({ onClose, onPlayNow, onAddToQueue }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ status: 'idle', tracks: [] });
  const [added, setAdded] = useState(null); // id that just got a ✓
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({ status: 'idle', tracks: [] });
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setResults((r) => ({ ...r, status: 'loading' }));
      searchApi(q, 'videos')
        .then((tracks) => n === seq.current && setResults({ status: 'done', tracks: tracks.slice(0, 20) }))
        .catch(() => n === seq.current && setResults({ status: 'error', tracks: [] }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const add = (t) => {
    onAddToQueue(t);
    setAdded(t.id);
    setTimeout(() => setAdded((id) => (id === t.id ? null : id)), 1500);
  };

  return (
    <div className="mini-search">
      <div className="mini-search-box">
        <Search size={16} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.tracks[0]) onPlayNow(results.tracks[0]);
          }}
          placeholder="Search songs…"
          aria-label="Search songs"
        />
        {results.status === 'loading' && <Loader2 className="spin" size={15} />}
        <button className="mini-btn is-flat" onClick={onClose} title="Close search (Esc)">
          <X size={16} />
        </button>
      </div>
      <ul className={`mini-results ${results.status === 'loading' ? 'is-stale' : ''}`}>
        {results.status === 'error' && <li className="mini-hint">Couldn’t search right now. Try again in a moment.</li>}
        {results.status === 'done' && !results.tracks.length && <li className="mini-hint">No results</li>}
        {results.status === 'idle' && <li className="mini-hint">Type a song or artist. Enter plays the top result.</li>}
        {results.tracks.map((t) => (
          <li key={t.id} className="mini-result">
            <button className="mini-result-main" onClick={() => onPlayNow(t)} title="Play now">
              <img src={thumbnail(t.id, 'mqdefault')} alt="" loading="lazy" />
              <span className="mini-result-text">
                <span className="mini-result-title">{t.title}</span>
                <span className="mini-result-sub">
                  {t.author}
                  {t.duration > 0 && ` · ${formatTime(t.duration)}`}
                </span>
              </span>
            </button>
            <button className="mini-btn is-flat" onClick={() => onPlayNow(t)} title="Play now">
              <Play size={15} fill="currentColor" />
            </button>
            <button className="mini-btn is-flat" onClick={() => add(t)} title="Add to queue">
              {added === t.id ? <Check size={16} /> : <Plus size={16} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniPlayer({
  engine,
  track,
  isFavourite,
  onToggleFavourite,
  onPrev,
  onNext,
  settings,
  onUpdateSettings,
  onShuffle,
  searching,
  onSearch,
  onCloseSearch,
  onPlayNow,
  onAddToQueue,
}) {
  const state = useEngineState(engine);
  const { time, duration } = useEngineTime(engine);
  const [drag, setDrag] = useState(null);
  const playing = state.status === 'playing';
  const loading = state.status === 'loading';
  const { volume, muted, shuffle, repeat } = settings;
  const shown = drag ?? time;
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;
  const level = muted ? 0 : volume;
  const VolumeIcon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;
  const commitSeek = () => {
    if (drag !== null) engine.seek(drag);
    setDrag(null);
  };

  const search = searching && <MiniSearch onClose={onCloseSearch} onPlayNow={onPlayNow} onAddToQueue={onAddToQueue} />;

  if (!track) {
    return (
      <div className={`mini ${searching ? 'is-searching' : ''}`}>
        {search}
        {!searching && (
          <button className="mini-empty" onClick={onSearch}>
            <Search size={16} /> Nothing playing. Search for a song
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`mini ${searching ? 'is-searching' : ''}`}>
      <img className="mini-bg" src={thumbnail(track.id, 'mqdefault')} alt="" />
      {search}

      <div className="mini-head">
        <img className="mini-art" src={thumbnail(track.id, 'mqdefault')} alt="" />
        <div className="mini-text">
          <div className="mini-title" title={track.title}>
            {track.title}
          </div>
          <div className="mini-author">{track.author}</div>
        </div>
        {!searching && (
          <button className="mini-btn" onClick={onSearch} title="Search (/)">
            <Search size={16} />
          </button>
        )}
        <button className={`mini-btn ${isFavourite ? 'is-fav' : ''}`} onClick={onToggleFavourite} title="Favourite (F)">
          <Heart size={17} fill={isFavourite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="mini-seek">
        <span className="mini-time">{formatTime(shown)}</span>
        <input
          type="range"
          className="range"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(shown, duration || 0)}
          style={{ '--p': `${pct}%` }}
          disabled={!duration}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
          aria-label="Seek"
        />
        <span className="mini-time">{formatTime(duration)}</span>
      </div>

      <div className="mini-bottom">
        <div className="mini-controls">
          <button className={`mini-btn is-flat ${shuffle ? 'is-on' : ''}`} onClick={onShuffle} title="Shuffle (S)">
            <Shuffle size={16} />
          </button>
          <button className="mini-btn" onClick={onPrev} title="Previous">
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="mini-play" onClick={() => engine.toggle()} title="Play / pause (Space)">
            {loading ? <Loader2 className="spin" size={20} /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="mini-btn" onClick={onNext} title="Next">
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button
            className={`mini-btn is-flat ${repeat !== 'off' ? 'is-on' : ''}`}
            onClick={() => onUpdateSettings({ repeat: { off: 'all', all: 'one', one: 'off' }[repeat] })}
            title={`Repeat: ${repeat} (R)`}
          >
            <RepeatIcon size={16} />
          </button>
        </div>
        <div className="mini-volume">
          <button className="mini-btn is-flat" onClick={() => onUpdateSettings({ muted: !muted })} title="Mute (M)">
            <VolumeIcon size={17} />
          </button>
          <input
            type="range"
            className="range"
            min={0}
            max={1}
            step={0.01}
            value={level}
            style={{ '--p': `${level * 100}%` }}
            onChange={(e) => onUpdateSettings({ volume: Number(e.target.value), muted: false })}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the mini player into the floating window, with the main keyboard shortcuts working
 * there too: Space, ← / → to seek, ↑ / ↓ volume, M mute, S shuffle, R repeat, F favourite,
 * Ctrl + ← / → previous / next.
 */
export default function MiniPlayerPortal({ win, ...props }) {
  const { engine, settings, onUpdateSettings, onPrev, onNext, onShuffle, onToggleFavourite } = props;
  const [searching, setSearching] = useState(false);

  // the window grows to fit the results and shrinks back when search closes
  // (browsers only allow this right after a click or key press, which is when these run)
  const openSearch = () => {
    setSearching(true);
    try {
      if (win.innerHeight < SEARCH_H - 20) win.resizeBy(0, SEARCH_H - win.innerHeight);
    } catch {
      /* not allowed here: the window can still be dragged bigger by hand */
    }
  };
  const closeSearch = () => {
    setSearching(false);
    try {
      if (win.innerHeight > COMPACT_H + 20) win.resizeBy(0, COMPACT_H - win.innerHeight);
    } catch {
      /* fine, it just stays taller */
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey) return;
      // typing in the search box: leave the keys alone
      const t = e.target;
      if (t.tagName === 'INPUT' && t.type !== 'range') return;
      if (e.key === '/') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === 'Escape' && searching) {
        closeSearch();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const seekStep = settings.seekStep || 5;
      const volStep = (settings.volumeStep || 5) / 100;
      const setVolume = (d) => onUpdateSettings({ volume: Math.round(Math.min(1, Math.max(0, settings.volume + d)) * 100) / 100, muted: false });
      const actions = mod
        ? { arrowright: onNext, arrowleft: onPrev }
        : {
            ' ': () => !e.repeat && engine.toggle(),
            arrowright: () => engine.seek(engine.currentTime + seekStep),
            arrowleft: () => engine.seek(engine.currentTime - seekStep),
            arrowup: () => setVolume(volStep),
            arrowdown: () => setVolume(-volStep),
            m: () => onUpdateSettings({ muted: !settings.muted }),
            s: onShuffle,
            r: () => onUpdateSettings({ repeat: { off: 'all', all: 'one', one: 'off' }[settings.repeat] }),
            f: onToggleFavourite,
          };
      const action = actions[key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    win.document.addEventListener('keydown', onKey);
    return () => win.document.removeEventListener('keydown', onKey);
  }); // re-bound each render so it always sees the latest settings and search state
  return createPortal(
    <MiniPlayer {...props} searching={searching} onSearch={openSearch} onCloseSearch={closeSearch} />,
    win.document.body,
  );
}
