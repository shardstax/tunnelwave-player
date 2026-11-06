import { useEffect, useMemo, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { Clock, Heart, ListMusic, Library, Search, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import { ActionsContext } from './actions';
import { getPlaylist, getVideo, search as searchApi, setCustomInstance } from './lib/api';
import { extractAccent } from './lib/color';
import { PlayerEngine } from './lib/engine';
import { shuffled, uid } from './lib/format';
import { useEngineState, useEvent, useLocalStorage, useMediaQuery } from './lib/hooks';
import { parseYouTubeUrl, thumbnail, toTrack } from './lib/youtube';
import { ARCH, ARCH_PATH, WAVE, WAVE_PATH } from './lib/logo';
import Stage from './components/Stage';
import Queue from './components/Queue';
import PlayerBar from './components/PlayerBar';
import Settings from './components/Settings';
import ShortcutsPopover from './components/ShortcutsPopover';
import QuoteCard from './components/QuoteCard';
import { nextQuote } from './lib/quotes';
import { Favourites, Playlists, Recent, Results, Suggestions } from './components/Browse';

const DEFAULT_SETTINGS = {
  theme: 'system',
  autoRadio: true,
  shuffle: false,
  repeat: 'off', // off | all | one
  volume: 0.9,
  muted: false,
  customInstance: { type: 'piped', base: '' },
};

const RECENT_LIMIT = 50;
const HISTORY_LIMIT = 100;
const IDLE_SEARCH = { status: 'idle', query: '', filter: 'videos', tracks: [], playlist: null, error: null };

const withUid = (track) => ({ ...toTrack(track), uid: uid() });

function Logo() {
  return (
    <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
        <path d={ARCH_PATH} strokeWidth={ARCH.width} />
        <path d={WAVE_PATH} strokeWidth={WAVE.width} />
      </g>
    </svg>
  );
}

export default function App() {
  const [engine] = useState(() => new PlayerEngine());
  const engineState = useEngineState(engine);

  // Spotify-style: `current` is playing, `queue` is only what's coming up,
  // `history` holds finished/skipped songs so "previous" can bring them back.
  const [current, setCurrent] = useLocalStorage('tq.nowPlaying', null);
  const [queue, setQueue] = useLocalStorage('tq.queue', []);
  const [history, setHistory] = useLocalStorage('tq.history', []);
  const [favourites, setFavourites] = useLocalStorage('tq.favourites', []);
  const [playlists, setPlaylists] = useLocalStorage('tq.playlists', []);
  const [recent, setRecent] = useLocalStorage('tq.recent', []);
  const [rawSettings, setRawSettings] = useLocalStorage('tq.settings', {});
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...rawSettings }), [rawSettings]);
  setCustomInstance(settings.customInstance);

  const [tab, setTab] = useState('results');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState(IDLE_SEARCH);
  const [toasts, setToasts] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quote, setQuote] = useState(null);
  const searchRef = useRef(null);
  const searchSeq = useRef(0);
  const isWide = useMediaQuery('(min-width: 980px)');

  const favouriteIds = useMemo(() => new Set(favourites.map((f) => f.id)), [favourites]);

  const toast = useEvent((message) => {
    const id = uid();
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  });

  const updateSettings = useEvent((patch) => setRawSettings((s) => ({ ...s, ...patch })));

  // ---------- playback & queue ----------

  /** Plays `track` right away; whatever was playing moves to history. Queue is untouched. */
  const startTrack = useEvent((track) => {
    if (current) setHistory((h) => [...h, toTrack(current)].slice(-HISTORY_LIMIT));
    setCurrent(withUid(track));
  });

  const addToQueue = useEvent((tracks, { next = false, play = false } = {}) => {
    const items = tracks.map(withUid);
    if (!items.length) return;

    const idle = !current || engine.state.status === 'ended';
    if (play || idle) {
      startTrack(items.shift());
      if (!items.length) return;
    }

    if (next) {
      setQueue([...items, ...queue]);
    } else if (settings.shuffle) {
      const nextQueue = [...queue];
      for (const item of items) nextQueue.splice(Math.floor(Math.random() * (nextQueue.length + 1)), 0, item);
      setQueue(nextQueue);
    } else {
      setQueue([...queue, ...items]);
    }
    if (!play && !idle) {
      const what = items.length === 1 ? `“${items[0].title}”` : `${items.length} songs`;
      toast(next ? `${what} will play next` : `Added ${what} to the queue`);
    }
  });

  const playNow = useEvent((track) => startTrack(track));

  /** "Play all": plays the first song and replaces the queue with the rest. */
  const replaceQueue = useEvent((tracks) => {
    let items = tracks.map(withUid);
    if (!items.length) return;
    if (settings.shuffle) items = shuffled(items);
    startTrack(items[0]);
    setQueue(items.slice(1));
  });

  /** Clicking a queued song plays it and takes only that song out of the queue. */
  const playFromQueue = useEvent((id) => {
    const item = queue.find((q) => q.uid === id);
    if (!item) return;
    setQueue(queue.filter((q) => q.uid !== id));
    startTrack(item);
  });

  const moveInQueue = useEvent((from, to) => {
    if (to < 0 || to >= queue.length) return;
    setQueue(arrayMove(queue, from, to));
  });

  const removeFromQueue = useEvent((id) => setQueue(queue.filter((q) => q.uid !== id)));

  const clearQueue = useEvent(() => {
    setQueue([]);
    toast('Queue cleared');
  });

  const saveQueueAsPlaylist = useEvent((name) => {
    createPlaylist(name, current ? [current, ...queue] : queue);
    toast(`Saved queue as “${name}”`);
  });

  const pickSuggestion = () => {
    const avoid = new Set([current?.id, ...queue.map((q) => q.id), ...recent.slice(0, 30).map((r) => r.id)]);
    const options = engine.state.related.filter((r) => !avoid.has(r.id)).slice(0, 3);
    return options[Math.floor(Math.random() * options.length)];
  };

  const next = useEvent((auto = false) => {
    if (auto && settings.repeat === 'one') {
      engine.seek(0);
      engine.play();
      return;
    }
    // repeat all: the finished song goes to the back of the line
    const upcoming = settings.repeat === 'all' && current ? [...queue, withUid(current)] : queue;
    if (upcoming.length) {
      setQueue(upcoming.slice(1));
      startTrack(upcoming[0]);
      return;
    }
    const suggestion = settings.autoRadio && pickSuggestion();
    if (suggestion) {
      startTrack(suggestion);
      if (!auto) toast(`Playing a suggestion: “${suggestion.title}”`);
      return;
    }
    if (!auto) toast('You’ve reached the end of the queue');
  });

  /** Brings back the last played song; the current one returns to the top of the queue. */
  const prev = useEvent(() => {
    if (!history.length) {
      engine.seek(0);
      return;
    }
    const last = history[history.length - 1];
    setHistory(history.slice(0, -1));
    if (current) setQueue([withUid(current), ...queue]);
    setCurrent(withUid(last));
  });

  const toggleShuffle = useEvent(() => {
    const on = !settings.shuffle;
    updateSettings({ shuffle: on });
    if (on && queue.length > 1) {
      setQueue(shuffled(queue));
      toast('Shuffled your queue');
    } else {
      toast(on ? 'Shuffle on' : 'Shuffle off');
    }
  });

  const changeVolume = useEvent((delta) => {
    const volume = Math.round(Math.min(1, Math.max(0, settings.volume + delta)) * 100) / 100;
    updateSettings({ volume, muted: false });
    toast(`Volume ${Math.round(volume * 100)}%`);
  });

  // ---------- library ----------

  const toggleFavourite = useEvent((track) => {
    if (favouriteIds.has(track.id)) {
      setFavourites(favourites.filter((f) => f.id !== track.id));
      toast('Removed from favourites');
    } else {
      setFavourites([toTrack(track), ...favourites]);
      toast('Added to favourites');
    }
  });

  const createPlaylist = useEvent((name, tracks) => {
    setPlaylists((p) => [...p, { id: uid(), name, tracks: tracks.map(toTrack) }]);
  });

  const addToPlaylist = useEvent((id, tracks) => {
    const target = playlists.find((p) => p.id === id);
    if (!target) return;
    const have = new Set(target.tracks.map((t) => t.id));
    const fresh = tracks.filter((t) => !have.has(t.id)).map(toTrack);
    setPlaylists(playlists.map((p) => (p.id === id ? { ...p, tracks: [...p.tracks, ...fresh] } : p)));
    toast(fresh.length ? `Added to “${target.name}”` : `Already in “${target.name}”`);
  });

  const removeFromPlaylist = useEvent((id, index) =>
    setPlaylists((ps) => ps.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index) } : p))),
  );
  const deletePlaylist = useEvent((id) => setPlaylists((ps) => ps.filter((p) => p.id !== id)));
  const renamePlaylist = useEvent((id, name) => setPlaylists((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p))));

  const isFavourite = useEvent((id) => favouriteIds.has(id));

  const actions = useMemo(
    () => ({
      addToQueue,
      playNow,
      replaceQueue,
      toggleFavourite,
      isFavourite,
      createPlaylist,
      addToPlaylist,
      removeFromPlaylist,
      deletePlaylist,
      renamePlaylist,
      toast,
      playlists,
    }),
    // favouriteIds is listed so rows re-render when hearts change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlists, favouriteIds],
  );

  // ---------- search & links ----------

  const runSearch = useEvent(async (text, filter = search.filter) => {
    const query = text.trim();
    if (!query) return;
    const seq = ++searchSeq.current;
    const link = parseYouTubeUrl(query);

    if (link?.videoId) {
      setInput('');
      let track = toTrack({ id: link.videoId, title: 'YouTube video' });
      try {
        track = (await getVideo(link.videoId)).track;
      } catch {
        /* we can still play it through the embed */
      }
      addToQueue([track]);
      if (!link.playlistId) return;
    }

    setTab('results');
    if (link?.playlistId) {
      if (!link.videoId) setInput('');
      setSearch({ ...IDLE_SEARCH, status: 'loading', query, filter });
      try {
        const playlist = await getPlaylist(link.playlistId);
        if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'done', query, filter, playlist });
      } catch (e) {
        if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'error', query, filter, error: e.message });
      }
      return;
    }

    setSearch({ ...IDLE_SEARCH, status: 'loading', query, filter });
    try {
      const tracks = await searchApi(query, filter);
      if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'done', query, filter, tracks });
    } catch (e) {
      if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'error', query, filter, error: e.message });
    }
  });

  // ---------- player wiring ----------

  const autoplayRef = useRef(false);
  useEffect(() => {
    if (current) engine.load(current, { autoplay: autoplayRef.current });
    else engine.stop();
    // first load after a page refresh waits for a click (browsers block autoplay anyway)
    autoplayRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.uid]);

  useEffect(() => engine.setVolume(settings.volume, settings.muted), [engine, settings.volume, settings.muted]);

  const recordedRef = useRef(null);
  const onEngineState = useEvent(() => {
    if (engine.state.status !== 'playing' || !current || recordedRef.current === current.uid) return;
    recordedRef.current = current.uid;
    setRecent((r) => [toTrack(current), ...r.filter((x) => x.id !== current.id)].slice(0, RECENT_LIMIT));
  });
  const onEnded = useEvent(() => next(true));

  useEffect(() => {
    engine.addEventListener('state', onEngineState);
    engine.addEventListener('ended', onEnded);
    return () => {
      engine.removeEventListener('state', onEngineState);
      engine.removeEventListener('ended', onEnded);
    };
  }, [engine, onEngineState, onEnded]);

  useEffect(() => {
    if (engineState.status === 'error' && engineState.error) toast(engineState.error);
  }, [engineState.status, engineState.error, toast]);

  // ---------- media keys / lock screen ----------

  useEffect(() => {
    document.title = current ? `${current.title} · Tunnelwave` : 'Tunnelwave';
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.author,
          album: 'Tunnelwave',
          artwork: [
            { src: thumbnail(current.id, 'mqdefault'), sizes: '320x180', type: 'image/jpeg' },
            { src: thumbnail(current.id, 'hqdefault'), sizes: '480x360', type: 'image/jpeg' },
          ],
        })
      : null;
  }, [current]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => engine.play(),
      pause: () => engine.pause(),
      nexttrack: () => next(),
      previoustrack: () => prev(),
      seekto: (d) => engine.seek(d.seekTime),
      seekbackward: (d) => engine.seek(engine.currentTime - (d.seekOffset || 10)),
      seekforward: (d) => engine.seek(engine.currentTime + (d.seekOffset || 10)),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported in this browser */
      }
    }
    const sync = () => {
      ms.playbackState = engine.state.status === 'playing' ? 'playing' : engine.state.status === 'idle' ? 'none' : 'paused';
      const duration = engine.duration;
      if (duration > 0 && ms.setPositionState) {
        try {
          ms.setPositionState({ duration, position: Math.min(engine.currentTime, duration), playbackRate: 1 });
        } catch {
          /* ignore invalid states while switching tracks */
        }
      }
    };
    engine.addEventListener('state', sync);
    engine.video.addEventListener('durationchange', sync);
    engine.video.addEventListener('seeked', sync);
    return () => {
      engine.removeEventListener('state', sync);
      engine.video.removeEventListener('durationchange', sync);
      engine.video.removeEventListener('seeked', sync);
    };
  }, [engine, next, prev]);

  // ---------- keyboard shortcuts ----------

  const onKey = useEvent((e) => {
    if (settingsOpen) return;
    const t = e.target;
    const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);

    // Alt + / works everywhere, even while typing
    if (e.altKey && e.code === 'Slash') {
      e.preventDefault();
      setShortcutsOpen((o) => !o);
      return;
    }
    // little extra, intentionally not listed
    if (e.altKey && e.code === 'KeyM') {
      e.preventDefault();
      setQuote(nextQuote());
      return;
    }
    if (typing) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.altKey) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const modActions = {
      arrowright: () => next(),
      arrowleft: () => prev(),
      arrowup: () => changeVolume(0.1),
      arrowdown: () => changeVolume(-0.1),
    };
    const plainActions = {
      ' ': () => engine.toggle(),
      arrowright: () => engine.seek(engine.currentTime + 10),
      arrowleft: () => engine.seek(engine.currentTime - 10),
      '/': () => searchRef.current?.focus(),
      f: () => current && toggleFavourite(current),
      s: () => toggleShuffle(),
      r: () => updateSettings({ repeat: { off: 'all', all: 'one', one: 'off' }[settings.repeat] }),
      m: () => updateSettings({ muted: !settings.muted }),
    };
    const action = mod ? modActions[key] : plainActions[key];
    if (!action) return;
    // let Space/Enter activate a focused button as usual
    if (key === ' ' && t.tagName === 'BUTTON') return;
    e.preventDefault();
    action();
  });

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  // ---------- theme & colours ----------

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement.style;
    const apply = (c) => {
      root.setProperty('--accent-h', c ? c.h : 265);
      root.setProperty('--accent-s', `${c ? c.s : 75}%`);
    };
    if (!current) return apply(null);
    let cancelled = false;
    extractAccent(thumbnail(current.id, 'mqdefault'))
      .then((c) => !cancelled && apply(c))
      .catch(() => !cancelled && apply(null));
    return () => {
      cancelled = true;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- backup ----------

  const exportData = () => {
    const data = { app: 'tunnelwave', version: 1, exportedAt: new Date().toISOString(), favourites, playlists, recent };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tunnelwave-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importData = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const clean = (list) =>
        (Array.isArray(list) ? list : []).filter((t) => typeof t?.id === 'string' && /^[\w-]{11}$/.test(t.id)).map(toTrack);
      const mergeTracks = (mine, theirs) => {
        const ids = new Set(mine.map((t) => t.id));
        return [...mine, ...theirs.filter((t) => !ids.has(t.id))];
      };

      const favs = clean(data.favourites);
      const lists = (Array.isArray(data.playlists) ? data.playlists : [])
        .filter((p) => typeof p?.name === 'string')
        .map((p) => ({ id: typeof p.id === 'string' ? p.id : uid(), name: p.name, tracks: clean(p.tracks) }));
      const newLists = lists.filter((p) => !playlists.some((x) => x.id === p.id));

      setFavourites(mergeTracks(favourites, favs));
      setPlaylists([...playlists, ...newLists]);
      setRecent(mergeTracks(recent, clean(data.recent)).slice(0, RECENT_LIMIT));
      toast(`Imported ${favs.length} favourites and ${newLists.length} playlists`);
    } catch {
      toast('That file isn’t a valid Tunnelwave backup');
    }
  };

  // ---------- render ----------

  const related = useMemo(() => {
    const taken = new Set([current?.id, ...queue.map((q) => q.id)]);
    return engineState.related.filter((r) => !taken.has(r.id));
  }, [engineState.related, queue, current?.id]);

  const tabs = [
    !isWide && { key: 'queue', label: 'Queue', icon: ListMusic, count: queue.length },
    { key: 'results', label: 'Search', icon: Search },
    { key: 'suggested', label: 'Suggested', icon: Sparkles, count: related.length },
    { key: 'favourites', label: 'Favourites', icon: Heart, count: favourites.length },
    { key: 'playlists', label: 'Playlists', icon: Library, count: playlists.length },
    { key: 'recent', label: 'Recent', icon: Clock },
  ].filter(Boolean);
  const activeTab = isWide && tab === 'queue' ? 'results' : tab;

  const queuePanel = (
    <Queue
      queue={queue}
      current={current}
      isPlaying={engineState.status === 'playing'}
      onPlay={playFromQueue}
      onMove={moveInQueue}
      onRemove={removeFromQueue}
      onClear={clearQueue}
      onSaveAsPlaylist={saveQueueAsPlaylist}
    />
  );

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <Logo />
            <span>Tunnelwave</span>
          </div>
          <form
            className="searchbox"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(input);
            }}
          >
            <Search size={18} className="muted" />
            <input
              ref={searchRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (parseYouTubeUrl(text)) {
                  e.preventDefault();
                  runSearch(text);
                }
              }}
              placeholder="Search songs or paste a YouTube link…"
              aria-label="Search or paste a link"
              enterKeyHint="search"
            />
            {input && (
              <button type="button" className="icon-btn" onClick={() => setInput('')} aria-label="Clear">
                <X size={16} />
              </button>
            )}
            <button className="btn btn-accent btn-sm" disabled={!input.trim()}>
              Go
            </button>
          </form>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <SettingsIcon size={20} />
          </button>
        </header>

        <main className="layout">
          <div className="main-col">
            <Stage
              engine={engine}
              track={current}
              isFavourite={!!current && favouriteIds.has(current.id)}
              onToggleFavourite={() => current && toggleFavourite(current)}
            />

            <section className="panel browse">
              <nav className="tabs" role="tablist">
                {tabs.map(({ key, label, icon: Icon, count }) => (
                  <button key={key} role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'is-on' : ''} onClick={() => setTab(key)}>
                    <Icon size={15} />
                    {label}
                    {count > 0 && <span className="count">{count}</span>}
                  </button>
                ))}
              </nav>
              <div className="tab-body">
                {activeTab === 'queue' && queuePanel}
                {activeTab === 'results' && (
                  <Results
                    search={search}
                    onFilter={(f) => runSearch(search.query, f)}
                    onRetry={() => runSearch(search.query)}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                )}
                {activeTab === 'suggested' && (
                  <Suggestions
                    tracks={related}
                    hasTrack={!!current}
                    autoRadio={settings.autoRadio}
                    onToggleAutoRadio={() => updateSettings({ autoRadio: !settings.autoRadio })}
                  />
                )}
                {activeTab === 'favourites' && <Favourites favourites={favourites} />}
                {activeTab === 'playlists' && <Playlists playlists={playlists} />}
                {activeTab === 'recent' && <Recent recent={recent} onClear={() => setRecent([])} />}
              </div>
            </section>
          </div>

          {isWide && <aside className="side-col">{queuePanel}</aside>}
        </main>

        <PlayerBar
          engine={engine}
          track={current}
          settings={settings}
          isFavourite={!!current && favouriteIds.has(current.id)}
          onToggleFavourite={() => current && toggleFavourite(current)}
          onPrev={prev}
          onNext={() => next()}
          onShuffle={toggleShuffle}
          onUpdateSettings={updateSettings}
          onShowShortcuts={() => setShortcutsOpen((o) => !o)}
        />

        {shortcutsOpen && <ShortcutsPopover onClose={() => setShortcutsOpen(false)} />}
        {quote && <QuoteCard quote={quote} onClose={() => setQuote(null)} />}

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.message}
            </div>
          ))}
        </div>

        {settingsOpen && (
          <Settings
            settings={settings}
            source={engineState.source}
            onUpdate={updateSettings}
            onExport={exportData}
            onImport={importData}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </ActionsContext.Provider>
  );
}
