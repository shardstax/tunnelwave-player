import { useEffect, useMemo, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { Clock, Heart, ListMusic, Library, RadioTower, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { ActionsContext } from './actions';
import { getPlaylist, getRadio, getVideo, search as searchApi, setCustomInstance } from './lib/api';
import { EMPTY_TASTE, buildStation, nudgeTaste, reshuffleStation, songKey } from './lib/radio';
import { buildVibe } from './lib/vibes';
import { extractAccent } from './lib/color';
import { PlayerEngine } from './lib/engine';
import { shuffled, uid } from './lib/format';
import { useEngineState, useEvent, useLocalStorage, useMediaQuery } from './lib/hooks';
import { parseYouTubeUrl, thumbnail, toTrack } from './lib/youtube';
import { ARCH, ARCH_PATH, WAVE, WAVE_PATH } from './lib/logo';
import Stage from './components/Stage';
import Lyrics from './components/Lyrics';
import Queue from './components/Queue';
import PlayerBar from './components/PlayerBar';
import Settings from './components/Settings';
import ShortcutsPopover from './components/ShortcutsPopover';
import QuoteCard from './components/QuoteCard';
import { nextQuote } from './lib/quotes';
import { Favourites, Playlists, Recent, Results } from './components/Browse';
import Radio from './components/Radio';

const DEFAULT_SETTINGS = {
  theme: 'system',
  autoRadio: true,
  shuffle: false,
  repeat: 'off', // off | all | one
  seekStep: 5, // seconds for ← / →
  volumeStep: 5, // percent for Ctrl + ↑ / ↓
  compactPlayer: false, // now-playing card collapsed to a slim strip
  dubLanguage: '', // '' = original audio; otherwise e.g. 'hi' to prefer a Hindi dub when a video has one
  adFree: true, // false: play everything in the regular YouTube player
  dataSaver: false, // true: don't download the next song ahead of time
  volume: 0.9,
  muted: false,
  customInstance: { type: 'piped', base: '' },
};

const RECENT_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 100;
// seconds into a song before the next one is downloaded (skipped earlier = nothing wasted)
const PRELOAD_AFTER_S = 30;
const IDLE_SEARCH = { status: 'idle', query: '', filter: 'videos', tracks: [], playlist: null, error: null };

// `fromRadio` marks songs autoplay picked, so skipping them can teach the radio
const withUid = (track) => ({ ...toTrack(track), uid: uid(), ...(track.fromRadio && { fromRadio: true }) });
const IDLE_STATION = { forId: null, status: 'idle', tracks: [] };
const RADIO_SEED_WEIGHTS = [1, 0.45, 0.25];
// when a running station gets this short, more picks are added to the end
const STATION_TOP_UP_AT = 10;

// fields where keys should type text instead of triggering shortcuts
const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];
const isTextField = (el) =>
  el.isContentEditable ||
  el.tagName === 'TEXTAREA' ||
  el.tagName === 'SELECT' ||
  (el.tagName === 'INPUT' && !NON_TEXT_INPUTS.includes(el.type));

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
  const [taste, setTaste] = useLocalStorage('tq.taste', EMPTY_TASTE);
  // the running vibe station, if any: { id, name, query, icon, hue, tracks, round }
  const [vibe, setVibe] = useLocalStorage('tq.vibe', null);
  const [rawSettings, setRawSettings] = useLocalStorage('tq.settings', {});
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...rawSettings }), [rawSettings]);
  setCustomInstance(settings.customInstance);

  const [tab, setTab] = useState('results');
  const [lyricsOpen, setLyricsOpen] = useState(false);
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

  // Like Spotify: playing something from outside a vibe station switches the station off.
  // Songs from the station itself (or added to the queue) keep it going.
  const leaveVibeFor = (tracks) => {
    if (!vibe || tracks.every((t) => vibe.tracks.some((v) => v.id === t.id))) return;
    setVibe(null);
    toast(`${vibe.name} station stopped`);
  };

  const playNow = useEvent((track) => {
    leaveVibeFor([track]);
    startTrack(track);
  });

  /** "Play all": plays the first song and replaces the queue with the rest. */
  const replaceQueue = useEvent((tracks) => {
    leaveVibeFor(tracks);
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

  /**
   * Removes the current song and plays the next one in the queue (stops if the queue is empty).
   * The removed song goes to history, so "previous" can still bring it back.
   */
  const removeCurrent = useEvent(() => {
    if (!current) return;
    if (queue.length) {
      setQueue(queue.slice(1));
      startTrack(queue[0]);
      return;
    }
    setHistory((h) => [...h, toTrack(current)].slice(-HISTORY_LIMIT));
    setCurrent(null);
  });

  const clearQueue = useEvent(() => {
    setQueue([]);
    toast('Queue cleared');
  });

  const saveQueueAsPlaylist = useEvent((name) => {
    createPlaylist(name, current ? [current, ...queue] : queue);
    toast(`Saved queue as “${name}”`);
  });

  // ---------- autoplay radio ----------

  // Built when you play something new: blends YouTube's radio for this song and the last two,
  // then filters and re-ranks it with what we've learnt about the listener.
  // Songs played from the station keep it going instead of rebuilding it (see below).
  const [station, setStation] = useState(IDLE_STATION);
  const stationRef = useRef({ forId: null, promise: null });
  const currentRef = useRef(current);
  currentRef.current = current;

  const computeStation = useEvent(async (track) => {
    const seedTracks = [track];
    for (let i = history.length - 1; i >= 0 && seedTracks.length < RADIO_SEED_WEIGHTS.length; i--) {
      if (!seedTracks.some((s) => s.id === history[i].id)) seedTracks.push(history[i]);
    }
    const results = await Promise.allSettled(seedTracks.map((t) => getRadio(t.id)));
    const seeds = results.flatMap((r, i) =>
      r.status === 'fulfilled' ? [{ track: seedTracks[i], tracks: r.value.tracks, weight: RADIO_SEED_WEIGHTS[i] }] : [],
    );
    // the stream server's related videos are a weaker extra signal
    if (engine.track?.id === track.id && engine.state.related.length) {
      seeds.push({ track, tracks: engine.state.related, weight: 0.3 });
    }
    return buildStation({
      seeds,
      avoid: [track, ...queue, ...history.slice(-30), ...recent.slice(0, 20)],
      taste,
      favouriteIds,
      current: track,
    });
  });

  const latestStation = useRef(station);
  latestStation.current = station;

  useEffect(() => {
    if (!current) {
      setStation(IDLE_STATION);
      stationRef.current = { forId: null, promise: null };
      return;
    }
    let cancelled = false;
    const id = current.id;

    // Like Spotify: a song picked from autoplay (by you or automatically) carries on the same
    // station. The list stays as it was, minus that song, and fresh picks are only added to the end.
    const prev = latestStation.current;
    if (prev.status === 'done' && (prev.forId === id || prev.tracks.some((t) => t.id === id))) {
      const rest = prev.tracks.filter((t) => t.id !== id);
      if (prev.forId !== id) {
        setStation({ forId: id, status: 'done', tracks: rest });
        if (passedRef.current.forId === prev.forId) passedRef.current = { ...passedRef.current, forId: id };
      }
      stationRef.current = { forId: id, promise: Promise.resolve(rest) };
      if (rest.length >= STATION_TOP_UP_AT) return;
      computeStation(current)
        .then((fresh) => {
          if (cancelled) return;
          setStation((s) => {
            if (s.forId !== id) return s;
            const have = new Set(s.tracks.map((t) => t.id));
            const keys = s.tracks.map(songKey);
            const extra = fresh.filter((t) => !have.has(t.id) && !keys.includes(songKey(t)));
            return { ...s, tracks: [...s.tracks, ...extra] };
          });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    setStation((s) => (s.forId === id ? s : { forId: id, status: 'loading', tracks: [] }));
    const promise = computeStation(current).catch(() => []);
    stationRef.current = { forId: id, promise };
    promise.then((tracks) => {
      if (cancelled) return;
      // a rebuild shouldn't bring back picks the user already shuffled away
      const passed = passedRef.current.forId === id ? passedRef.current.ids : null;
      if (passed?.size) tracks = [...tracks.filter((t) => !passed.has(t.id)), ...tracks.filter((t) => passed.has(t.id))];
      setStation({ forId: id, status: 'done', tracks });
    });
    return () => {
      cancelled = true;
    };
    // related videos arrive a moment after the song starts; mixes are cached, so rebuilding is cheap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, engineState.related]);

  // ---------- vibe stations ----------

  const [vibeLoading, setVibeLoading] = useState(null); // id of the vibe being built
  const vibeSeq = useRef(0);
  const vibeAvoid = () => [...(current ? [current] : []), ...queue, ...history.slice(-50), ...recent.slice(0, 30)];

  const startVibe = useEvent(async (v) => {
    const seq = ++vibeSeq.current;
    setVibeLoading(v.id);
    try {
      const tracks = await buildVibe(v, { avoid: vibeAvoid(), taste, favouriteIds });
      if (seq !== vibeSeq.current) return;
      const [first, ...rest] = tracks;
      const { id, name, query, icon, hue, custom } = v;
      setVibe({ id, name, query, icon, hue, custom, tracks: rest, round: 0 });
      startTrack({ ...first, fromRadio: true });
      toast(`Playing ${name} station`);
    } catch {
      if (seq === vibeSeq.current) toast(`Couldn’t find songs for “${v.name}”. Try again or another vibe.`);
    } finally {
      if (seq === vibeSeq.current) setVibeLoading(null);
    }
  });

  const stopVibe = useEvent(() => {
    vibeSeq.current++;
    setVibeLoading(null);
    if (vibe) toast(`${vibe.name} station stopped`);
    setVibe(null);
  });

  // a song from the station (picked by autoplay or by you) leaves the upcoming list
  useEffect(() => {
    if (vibe && current && vibe.tracks.some((t) => t.id === current.id)) {
      setVibe((v) => v && { ...v, tracks: v.tracks.filter((t) => t.id !== current.id) });
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // running low: the next few playlists for this vibe top it up
  const toppingUp = useRef(false);
  useEffect(() => {
    if (!vibe || vibe.tracks.length >= STATION_TOP_UP_AT || toppingUp.current) return;
    toppingUp.current = true;
    const { id, round } = vibe;
    buildVibe(vibe, { round: round + 1, avoid: [...vibeAvoid(), ...vibe.tracks], taste, favouriteIds })
      .then((fresh) => {
        setVibe((v) => {
          if (!v || v.id !== id) return v;
          const keys = v.tracks.map(songKey);
          return { ...v, round: round + 1, tracks: [...v.tracks, ...fresh.filter((t) => !keys.includes(songKey(t)))] };
        });
      })
      .catch(() => setVibe((v) => (v && v.id === id ? { ...v, round: round + 1 } : v)))
      .finally(() => {
        toppingUp.current = false;
      });
  }, [vibe?.id, vibe?.tracks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Show different picks": the songs on screen move to the back and a fresh similar set comes up
  const passedRef = useRef({ forId: null, ids: new Set() });
  const reshuffleRadio = useEvent(() => {
    if (vibe) {
      const shown = new Set(radioTracks.slice(0, 5).map((t) => t.id));
      setVibe((v) => v && { ...v, tracks: reshuffleStation(v.tracks, shown, current) });
      return;
    }
    if (!current || station.forId !== current.id || !station.tracks.length) return;
    const prev = passedRef.current.forId === current.id ? passedRef.current.ids : new Set();
    let ids = new Set([...prev, ...radioTracks.slice(0, 5).map((t) => t.id)]);
    // went through everything: start the cycle again
    if (station.tracks.filter((t) => !ids.has(t.id)).length < 5) ids = new Set(radioTracks.slice(0, 5).map((t) => t.id));
    passedRef.current = { forId: current.id, ids };
    setStation((s) => ({ ...s, tracks: reshuffleStation(s.tracks, ids, current) }));
  });

  // what autoplay will actually play, minus anything you've queued since
  // (a running vibe station takes over from the "similar songs" radio)
  const radioTracks = useMemo(() => {
    const taken = new Set([current?.id, ...queue.map((q) => q.id)]);
    if (vibe) return vibe.tracks.filter((t) => !taken.has(t.id));
    if (!current || station.forId !== current.id) return [];
    return station.tracks.filter((t) => !taken.has(t.id));
  }, [station, queue, current, vibe]);

  const pickRadioTrack = async () => {
    if (vibe && radioTracks.length) return radioTracks[0];
    const forId = current?.id;
    let list = station.forId === forId && station.status === 'done' ? station.tracks : null;
    if (!list && stationRef.current.forId === forId) list = await stationRef.current.promise;
    const taken = new Set([forId, ...queue.map((q) => q.id)]);
    const pick = (list || []).find((t) => !taken.has(t.id));
    if (pick) return pick;
    // nothing ranked (e.g. radio servers down): fall back to the stream server's related videos
    return engine.state.related.find((r) => !taken.has(r.id) && !recent.slice(0, 30).some((x) => x.id === r.id));
  };

  // ---------- learning from what you skip and finish ----------

  const progressRef = useRef({ uid: null, time: 0, duration: 0 });
  const moveRef = useRef('skip'); // how the last song ended: skip | auto | prev
  const previousRef = useRef(current);

  useEffect(() => {
    const onTime = () => {
      if (engine.track) progressRef.current = { uid: engine.track.uid, time: engine.currentTime, duration: engine.duration };
    };
    engine.addEventListener('time', onTime);
    return () => engine.removeEventListener('time', onTime);
  }, [engine]);

  useEffect(() => {
    const left = previousRef.current;
    previousRef.current = current;
    const move = moveRef.current;
    moveRef.current = 'skip';
    if (!left || left.uid === current?.uid || move === 'prev') return;
    const p = progressRef.current.uid === left.uid ? progressRef.current : { time: 0, duration: 0 };
    const listened = p.duration > 0 ? p.time / p.duration : 0;
    if (move === 'auto' || listened >= 0.8) {
      setTaste((t) => nudgeTaste(t, left, left.fromRadio ? 0.4 : 0.2));
    } else if (left.fromRadio && p.time < 30) {
      setTaste((t) => nudgeTaste(t, left, -1, { skipped: true }));
    } else if (left.fromRadio && listened < 0.5) {
      setTaste((t) => nudgeTaste(t, left, -0.3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.uid]);

  const next = useEvent(async (auto = false) => {
    if (auto && settings.repeat === 'one') {
      engine.seek(0);
      engine.play();
      return;
    }
    // repeat all: the finished song goes to the back of the line
    const upcoming = settings.repeat === 'all' && current ? [...queue, withUid(current)] : queue;
    if (upcoming.length) {
      if (auto) moveRef.current = 'auto';
      setQueue(upcoming.slice(1));
      startTrack(upcoming[0]);
      return;
    }
    if ((!settings.autoRadio && !vibe) || !current) {
      if (!auto) toast('You’ve reached the end of the queue');
      return;
    }
    const startedFrom = current.uid;
    const pick = await pickRadioTrack();
    // the user picked something else while we were waiting
    if (currentRef.current?.uid !== startedFrom) return;
    if (!pick) {
      if (!auto) toast('You’ve reached the end of the queue');
      return;
    }
    if (auto) moveRef.current = 'auto';
    startTrack({ ...pick, fromRadio: true });
  });

  /** Brings back the last played song; the current one returns to the top of the queue. */
  const prev = useEvent(() => {
    if (!history.length) {
      engine.seek(0);
      return;
    }
    moveRef.current = 'prev';
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

  // a ref, so fast repeated presses each build on the last one instead of a stale render
  const volumeRef = useRef(settings.volume);
  volumeRef.current = settings.volume;
  const changeVolume = useEvent((delta) => {
    const volume = Math.round(Math.min(1, Math.max(0, volumeRef.current + delta)) * 100) / 100;
    volumeRef.current = volume;
    updateSettings({ volume, muted: false });
    toast(`Volume ${Math.round(volume * 100)}%`);
  });

  // ---------- library ----------

  const toggleFavourite = useEvent((track) => {
    if (favouriteIds.has(track.id)) {
      setFavourites(favourites.filter((f) => f.id !== track.id));
      setTaste((t) => nudgeTaste(t, track, -0.5));
      toast('Removed from favourites');
    } else {
      setFavourites([toTrack(track), ...favourites]);
      setTaste((t) => nudgeTaste(t, track, 1));
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

  const lastQueryRef = useRef('');
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
    setLyricsOpen(false); // searching brings the results back
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

    lastQueryRef.current = `${filter}:${query}`;
    // keep the previous results on screen (dimmed) while the new ones load, so typing doesn't flicker
    setSearch((s) => ({ ...IDLE_SEARCH, status: 'loading', query, filter, tracks: s.playlist ? [] : s.tracks }));
    try {
      const tracks = await searchApi(query, filter);
      if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'done', query, filter, tracks });
    } catch (e) {
      lastQueryRef.current = ''; // let the same text be retried
      if (seq === searchSeq.current) setSearch({ ...IDLE_SEARCH, status: 'error', query, filter, error: e.message });
    }
  });

  // search as you type: wait for a short pause in typing, then search.
  // Links aren't auto-run (half-typed URLs are useless); pasting or Enter handles them.
  useEffect(() => {
    const query = input.trim();
    if (query.length < 2 || parseYouTubeUrl(query) || /^(https?:|www\.)|youtu\.?be/i.test(query)) return;
    const timer = setTimeout(() => {
      if (lastQueryRef.current !== `${search.filter}:${query}`) runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- player wiring ----------

  const autoplayRef = useRef(false);
  useEffect(() => {
    // after a page refresh, wait for the user's first click/key before playing
    // (browsers block autoplay until then anyway)
    const autoplay = navigator.userActivation ? navigator.userActivation.hasBeenActive : autoplayRef.current;
    engine.preferredLang = settings.dubLanguage || null;
    engine.adFree = settings.adFree;
    if (current) engine.load(current, { autoplay });
    else engine.stop();
    autoplayRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.uid]);

  useEffect(() => engine.setVolume(settings.volume, settings.muted), [engine, settings.volume, settings.muted]);
  useEffect(() => engine.setPreferredLang(settings.dubLanguage || null), [engine, settings.dubLanguage]);
  useEffect(() => engine.setAdFree(settings.adFree), [engine, settings.adFree]);
  useEffect(() => engine.setPreload(!settings.dataSaver), [engine, settings.dataSaver]);

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

  // Get the next song ready so skipping or auto-advancing starts fast:
  // its stream link a few seconds in, and (unless Data saver is on) its whole audio half a minute in,
  // by which point you've probably decided to keep listening to this one.
  const autoplayOn = settings.autoRadio || !!vibe;
  const upNext = queue[0] ?? (autoplayOn ? radioTracks[0] : undefined);
  const upNextId = upNext?.id;
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  useEffect(() => {
    if (engineState.status !== 'playing' || !upNextId || !settings.adFree) return;
    const link = setTimeout(() => getVideo(upNextId).catch(() => {}), 8000);
    const audio = settings.dataSaver
      ? null
      : setTimeout(() => engine.preloadNext(upNextRef.current), Math.max(0, PRELOAD_AFTER_S - engine.currentTime) * 1000);
    return () => {
      clearTimeout(link);
      clearTimeout(audio);
    };
  }, [engineState.status === 'playing', upNextId, settings.dataSaver]); // eslint-disable-line react-hooks/exhaustive-deps

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
      seekbackward: (d) => engine.seek(engine.currentTime - (d.seekOffset || settings.seekStep)),
      seekforward: (d) => engine.seek(engine.currentTime + (d.seekOffset || settings.seekStep)),
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
  }, [engine, next, prev, settings.seekStep]);

  // ---------- keyboard shortcuts ----------

  // Shortcuts are captured before any focused button, slider or drag handle sees the key,
  // so e.g. Space always plays/pauses instead of clicking whatever was clicked last.
  const onKey = useEvent((e) => {
    const t = e.target;
    const claim = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Alt + / works everywhere, even while typing
    if (e.altKey && e.code === 'Slash') {
      claim();
      setShortcutsOpen((o) => !o);
      return;
    }
    if (e.altKey && e.code === 'KeyS') {
      claim();
      const on = !settings.adFree;
      updateSettings({ adFree: on });
      toast(on ? 'Ad-free servers on' : 'Ad-free servers off: using the YouTube player');
      return;
    }
    // little extra, intentionally not listed
    if (e.altKey && e.code === 'KeyM') {
      claim();
      setQuote(nextQuote());
      return;
    }
    if (isTextField(t)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.altKey) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const modActions = {
      arrowright: () => next(),
      arrowleft: () => prev(),
      arrowup: () => changeVolume(settings.volumeStep / 100),
      arrowdown: () => changeVolume(-settings.volumeStep / 100),
    };
    const plainActions = {
      ' ': () => engine.toggle(),
      arrowright: () => engine.seek(engine.currentTime + settings.seekStep),
      arrowleft: () => engine.seek(engine.currentTime - settings.seekStep),
      '/': () => searchRef.current?.focus(),
      f: () => current && toggleFavourite(current),
      s: () => toggleShuffle(),
      r: () => updateSettings({ repeat: { off: 'all', all: 'one', one: 'off' }[settings.repeat] }),
      m: () => updateSettings({ muted: !settings.muted }),
      l: () => current && setLyricsOpen((o) => !o),
    };
    const action = mod ? modActions[key] : plainActions[key];
    if (!action) return;
    claim();
    // holding Space shouldn't flicker play/pause
    if (key === ' ' && e.repeat) return;
    action();
  });

  // browsers "click" a focused button when Space is released, so swallow that too
  const onKeyUp = useEvent((e) => {
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [onKey, onKeyUp]);

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

  const tabs = [
    !isWide && { key: 'queue', label: 'Queue', icon: ListMusic, count: queue.length },
    { key: 'results', label: 'Search', icon: Search },
    { key: 'suggested', label: 'Stations', icon: RadioTower, count: radioTracks.length },
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
      onRemoveCurrent={removeCurrent}
      onClear={clearQueue}
      onSaveAsPlaylist={saveQueueAsPlaylist}
      autoplay={autoplayOn ? radioTracks.slice(0, 5) : []}
      autoplayVibe={vibe?.name}
      onPlayAutoplay={playNow}
      onReshuffleAutoplay={reshuffleRadio}
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
              onNext={() => next()}
              compact={settings.compactPlayer}
              onToggleCompact={() => updateSettings({ compactPlayer: !settings.compactPlayer })}
              lyricsOpen={lyricsOpen && !!current}
              onToggleLyrics={() => setLyricsOpen((o) => !o)}
            />

            {lyricsOpen && current ? (
              <Lyrics engine={engine} track={current} onClose={() => setLyricsOpen(false)} />
            ) : (
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
                  <Radio
                    vibe={vibe}
                    vibeLoading={vibeLoading}
                    onStartVibe={startVibe}
                    onStopVibe={stopVibe}
                    tracks={radioTracks}
                    loading={!vibe && !!current && station.status === 'loading'}
                    basedOn={current}
                    hasTrack={!!current}
                    autoRadio={settings.autoRadio}
                    onToggleAutoRadio={() => updateSettings({ autoRadio: !settings.autoRadio })}
                    onReshuffle={reshuffleRadio}
                  />
                )}
                {activeTab === 'favourites' && <Favourites favourites={favourites} />}
                {activeTab === 'playlists' && <Playlists playlists={playlists} />}
                {activeTab === 'recent' && <Recent recent={recent} onClear={() => setRecent([])} />}
              </div>
            </section>
            )}
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

        {shortcutsOpen && <ShortcutsPopover steps={settings} onClose={() => setShortcutsOpen(false)} />}
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
