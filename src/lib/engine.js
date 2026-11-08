// One player for the whole app. Prefers an ad-free stream in a plain <video> element;
// if every stream source fails it falls back to the official YouTube embed.
import { getVideo, markDead } from './api';
import { AudioPreloader, MAX_PRELOAD_SECONDS, preloadSupported } from './preload';
import { SoundFx, effectById, needsGraph } from './effects';

const MAX_STREAM_ATTEMPTS = 4;
// A server whose audio hasn't started by now is treated as stuck, and we move on to the next one.
// Measured: a busy server can take 5–12s to start a song (and sends nothing until then), while a
// truly stuck one goes past 25s, so 15s separates the two without cutting off slow-but-working ones.
const START_TIMEOUT_MS = 15000;
// ...and if it has at least started sending the file, it gets this much more
const START_EXTRA_MS = 10000;
// buffering this long in the middle of a song: same thing
const STALL_TIMEOUT_MS = 10000;
// say what's going on if finding a server takes a while
const SLOW_NOTE_MS = 3000;
// after a server fails mid-load, how long to look for another before using the YouTube player
const RETRY_LOOKUP_MS = 4000;
// how long "the servers can't play the next song" stays true before we'd check again
const VERDICT_TTL_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 12000;

/**
 * Resolves once a stream has actually started delivering playable audio, rejects if it errors or
 * stays silent. Uses a throwaway, muted element that's thrown away right after (a few hundred KB).
 */
function canStart(url, cors) {
  return new Promise((resolve, reject) => {
    const a = document.createElement('audio');
    a.muted = true;
    a.preload = 'auto';
    if (cors) a.crossOrigin = 'anonymous';
    const done = (ok) => {
      clearTimeout(timer);
      a.removeAttribute('src');
      a.load();
      if (ok) resolve();
      else reject(new Error('Stream did not start'));
    };
    const timer = setTimeout(() => done(false), CHECK_TIMEOUT_MS);
    a.addEventListener('canplay', () => done(true), { once: true });
    a.addEventListener('error', () => done(false), { once: true });
    a.src = url;
  });
}

let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      ytApiPromise = null;
      reject(new Error('Could not load the YouTube player'));
    };
    document.head.append(script);
  });
  return ytApiPromise;
}

const playable = (el, mime) => !mime || el.canPlayType(mime) !== '';

const baseLang = (lang) => (lang || '').split('-')[0].toLowerCase();

/**
 * Videos with dubbed audio list one set of streams per language. Pick the language first
 * (exact choice → preferred language → the original), then the best quality within it.
 */
function pickAudio(list, el, { lang, preferred } = {}) {
  const ok = list.filter((s) => playable(el, s.mime));
  const groups = [
    lang && ok.filter((s) => s.lang === lang),
    preferred && ok.filter((s) => baseLang(s.lang) === preferred && s.kind !== 'descriptive'),
    ok.filter((s) => s.kind === 'original'),
    ok.filter((s) => !s.kind),
    ok,
  ];
  const group = groups.find((g) => g && g.length);
  return group ? [...group].sort((a, b) => b.bitrate - a.bitrate)[0] : null;
}

/** One entry per language for the picker: [{ lang, kind }], original first. */
function audioLanguages(list) {
  const byLang = new Map();
  for (const s of list) if (s.lang && !byLang.has(s.lang)) byLang.set(s.lang, { lang: s.lang, kind: s.kind });
  const order = { original: 0, dubbed: 1, descriptive: 2 };
  return [...byLang.values()].sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1) || a.lang.localeCompare(b.lang));
}

function pickVideo(list, el) {
  // 720p is plenty for a music player and saves data
  const ok = list.filter((s) => playable(el, s.mime) && s.height <= 720);
  return ok.sort((a, b) => b.height - a.height)[0] || null;
}

const INITIAL_STATE = {
  status: 'idle', // idle | loading | playing | paused | ended | error
  mode: 'idle', // idle | native | embed
  showVideo: false,
  source: null, // { type, base }
  audioTracks: [], // languages on offer when a video has dubbed audio
  audioLang: null, // language of the stream that's playing
  related: [],
  meta: null,
  error: null,
  note: null, // short status line under the spinner, e.g. "Trying another server…"
};

export class PlayerEngine extends EventTarget {
  constructor() {
    super();
    this.state = INITIAL_STATE;
    this.token = 0;
    this.track = null;
    this.audioOnly = true;
    this.preferredLang = null; // e.g. 'hi': use a Hindi dub when a video has one
    this.chosenLang = null; // language picked by hand for the current video
    this.volume = 1;
    this.muted = false;
    this.adFree = true; // false: always use the YouTube player (Settings)
    this.watchdog = null;
    // next song's audio, downloaded ahead of time (Settings → "Preload the next song")
    this.preloader = new AudioPreloader();
    this.preloadOn = preloadSupported();
    this.fromMemory = false; // the current song is playing from a preloaded copy
    // sound effects (Slowed + Reverb, Nightcore, 8D); the audio graph is built on first use
    this.effect = effectById('normal');
    this.fx = null;
    this.fadeLevel = 1; // sleep timer fade-out
    // videoId -> { ok, at } | { checking }: can an ad-free server play the upcoming song?
    this.verdicts = new Map();

    this.embedEl = document.createElement('div');
    this.embedEl.className = 'embed-host';

    const v = (this.video = document.createElement('video'));
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('playing', () => {
      this.clearWatchdog();
      this.switching = false;
      if (this.state.note) this.set({ note: null });
      // paused by the user while the stream was still starting
      if (!this.wantPlay) return v.pause();
      this.set({ status: 'playing' });
    });
    v.addEventListener('pause', () => {
      this.clearWatchdog();
      if (!this.switching && this.state.mode === 'native' && !v.ended) this.set({ status: 'paused' });
    });
    v.addEventListener('waiting', () => {
      this.set({ status: 'loading' });
      if (this.wantPlay && !this.watchdog) this.armWatchdog(STALL_TIMEOUT_MS, 'stall');
    });
    v.addEventListener('timeupdate', () => this.emit('time'));
    v.addEventListener('durationchange', () => this.emit('time'));
    v.addEventListener('ended', () => {
      this.set({ status: 'ended' });
      this.emit('ended');
    });
    v.addEventListener('error', () => this.onNativeError());
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state');
  }

  get currentTime() {
    if (this.state.mode === 'embed') return this.yt?.getCurrentTime?.() || 0;
    return this.video.currentTime || 0;
  }

  get duration() {
    if (this.state.mode === 'embed') return this.yt?.getDuration?.() || this.track?.duration || 0;
    return Number.isFinite(this.video.duration) ? this.video.duration : this.track?.duration || 0;
  }

  // ---------- loading ----------

  async load(track, { audioOnly = this.audioOnly, startAt = 0, autoplay = true } = {}) {
    const token = ++this.token;
    this.track = track;
    this.audioOnly = audioOnly;
    this.excluded = new Set();
    this.attempts = 0;
    this.chosenLang = null;
    this.wantPlay = autoplay;
    // only this song's preloaded copy (if any) is still useful; the app asks for the next one later
    this.preloader.pinned = track.id;
    this.preloader.keepOnly([track.id]);
    this.destroyEmbed();
    this.switching = true;
    this.video.pause();
    this.clearWatchdog();
    if (!this.adFree) {
      this.stopNative();
      this.set({ ...INITIAL_STATE });
      return this.loadEmbed(token, startAt, autoplay, 'off');
    }
    // checked during the last song: no ad-free server can play this one, so don't make you wait
    const verdict = this.verdicts.get(track.id);
    if (verdict && verdict.ok === false && Date.now() - verdict.at < VERDICT_TTL_MS) {
      this.verdicts.delete(track.id); // next time (e.g. pressing previous) try the servers again
      this.stopNative();
      this.set({ ...INITIAL_STATE });
      return this.loadEmbed(token, startAt, autoplay, 'skipped');
    }
    this.set({ ...INITIAL_STATE, status: 'loading', mode: 'native' });
    await this.loadNative(token, startAt, autoplay);
  }

  async loadNative(token, startAt, autoplay) {
    this.resumeAt = startAt;
    let info;
    const slow = setTimeout(() => {
      if (token === this.token && !this.state.note) this.set({ note: 'Looking for a working server…' });
    }, SLOW_NOTE_MS);
    try {
      const lookup = getVideo(this.track.id, { exclude: this.excluded });
      // A server already let this song down. Don't keep you waiting while the rest are tried one
      // round after another: if none answers quickly, go straight to the YouTube player.
      info =
        this.attempts > 0
          ? await Promise.race([
              lookup,
              new Promise((_, reject) => setTimeout(() => reject(new Error('No quick replacement')), RETRY_LOOKUP_MS)),
            ])
          : await lookup;
    } catch (e) {
      if (token === this.token) this.loadEmbed(token, startAt, autoplay, 'fallback');
      return;
    } finally {
      clearTimeout(slow);
    }
    if (token !== this.token) return;
    // the user may have pressed play/pause while we were fetching
    autoplay = this.wantPlay;

    const v = this.video;
    const videoStream = this.audioOnly ? null : pickVideo(info.video, v);
    // muxed video works as audio too, so it's the last resort for audio-only mode
    const audioStream = pickAudio(info.audio, v, { lang: this.chosenLang, preferred: this.preferredLang });
    const stream = videoStream || audioStream || pickVideo(info.video, v);
    if (!stream) {
      this.excluded.add(info.source.base);
      return this.retry(token, startAt, autoplay);
    }

    const audioTracks = audioLanguages(info.audio.filter((s) => playable(v, s.mime)));
    this.set({
      source: info.source,
      related: info.related,
      meta: info.track,
      showVideo: !!videoStream,
      audioTracks: audioTracks.length > 1 ? audioTracks : [],
      audioLang: stream === audioStream ? audioStream.lang : null,
    });
    if (v.src === stream.url) {
      // same file (audio/video toggle on a muxed stream): just show/hide the picture
      this.switching = false;
      if (Math.abs(v.currentTime - startAt) > 1) v.currentTime = startAt;
      if (autoplay) v.play().catch(() => {});
      else this.set({ status: 'paused' });
      return;
    }
    this.switching = true;
    // preloaded: play the downloaded copy, which starts instantly and can't stall
    const memoryUrl = this.preloader.ready(this.track.id, stream.url);
    // still downloading: don't fetch the same song twice, stream it the normal way instead
    if (!memoryUrl) this.preloader.drop(this.track.id);
    this.fromMemory = !!memoryUrl;
    v.src = memoryUrl || stream.url;
    this.startExtended = false;
    this.applyVolume();
    this.applyRate();
    if (startAt > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = startAt), { once: true });

    if (!autoplay) {
      this.switching = false;
      this.set({ status: 'paused' });
      return;
    }
    this.armWatchdog(START_TIMEOUT_MS);
    v.play().catch((err) => {
      if (token !== this.token || err.name !== 'NotAllowedError') return;
      this.clearWatchdog();
      // browser blocked autoplay (e.g. right after a page reload) — wait for a click
      this.switching = false;
      this.wantPlay = false;
      this.set({ status: 'paused' });
    });
  }

  onNativeError() {
    if (this.state.mode !== 'native' || !this.video.getAttribute('src')) return;
    this.clearWatchdog();
    if (this.fromMemory) {
      // the downloaded copy didn't play: forget it and stream as usual (the server isn't at fault)
      this.fromMemory = false;
      this.preloader.drop(this.track.id);
      return this.loadNative(this.token, this.video.currentTime || this.resumeAt || 0, true);
    }
    this.dropSource();
    this.set({ note: 'That server failed, trying another…' });
    this.retry(this.token, this.video.currentTime || this.resumeAt || 0, true);
  }

  /** Stop using the current server for this song (and skip it for a while). */
  dropSource() {
    const base = this.state.source?.base;
    if (!base) return;
    this.excluded.add(base);
    markDead(base);
  }

  // ---------- stall watchdog ----------
  // A stream that fails raises an error, but one that just hangs never does. Without this the
  // spinner could spin forever, so after a while we treat silence as failure and move on.
  // Servers vary a lot (the same one can start in 1s or 11s), so a slow start that is clearly
  // receiving data gets extra time; one that has sent nothing at all is dropped quickly.

  armWatchdog(ms, kind = 'start') {
    clearTimeout(this.watchdog);
    const token = this.token;
    this.watchdogKind = kind;
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.onStall(token);
    }, ms);
    // let the user know it's slow, not broken
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (token === this.token && this.watchdog && !this.state.note) this.set({ note: 'Server is slow right now, still loading…' });
    }, 5000);
  }

  clearWatchdog() {
    clearTimeout(this.watchdog);
    clearTimeout(this.slowTimer);
    this.watchdog = null;
  }

  onStall(token) {
    const v = this.video;
    if (token !== this.token || this.state.mode !== 'native' || !this.wantPlay || !v.getAttribute('src')) return;
    if (!v.paused && v.readyState >= 3) return; // it recovered on its own
    if (this.watchdogKind === 'start' && !this.startExtended && v.readyState >= 1) {
      // the song's details arrived, the audio is just slow to follow: give it a bit longer
      this.startExtended = true;
      this.set({ note: 'This server is slow today, still loading…' });
      this.armWatchdog(START_EXTRA_MS, 'start');
      return;
    }
    const at = v.currentTime > 0 ? v.currentTime : this.resumeAt || 0;
    this.dropSource();
    this.set({ note: 'That server is too slow, trying another…' });
    this.retry(token, at, true);
  }

  retry(token, startAt, autoplay) {
    if (++this.attempts >= MAX_STREAM_ATTEMPTS) return this.loadEmbed(token, startAt, autoplay);
    this.set({ status: 'loading' });
    return this.loadNative(token, startAt, autoplay);
  }

  /** @param reason 'off' (ad-free servers turned off in Settings) or 'fallback' (none of them worked) */
  async loadEmbed(token, startAt, autoplay, reason = 'fallback') {
    this.clearWatchdog();
    this.stopNative();
    this.set({
      mode: 'embed',
      status: 'loading',
      showVideo: true,
      source: { type: 'youtube', base: 'youtube-nocookie.com', reason },
      note:
        reason === 'fallback'
          ? 'No ad-free server worked, so using the YouTube player'
          : reason === 'skipped'
            ? 'Ad-free servers aren’t working right now, so this song went straight to the YouTube player'
            : null,
    });

    let YT;
    try {
      YT = await loadYouTubeApi();
    } catch (e) {
      if (token === this.token) this.set({ status: 'error', error: e.message });
      return;
    }
    if (token !== this.token) return;
    autoplay = this.wantPlay;

    const mount = document.createElement('div');
    this.embedEl.replaceChildren(mount);
    const S = YT.PlayerState;
    this.yt = new YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      videoId: this.track.id,
      width: '100%',
      height: '100%',
      playerVars: { autoplay: autoplay ? 1 : 0, start: Math.floor(startAt), playsinline: 1, rel: 0 },
      events: {
        onReady: (e) => {
          if (token !== this.token) return;
          e.target.setVolume(Math.round(this.volume * 100));
          if (this.muted) e.target.mute();
          if (this.wantPlay) e.target.playVideo();
          else this.set({ status: 'paused' });
        },
        onStateChange: (e) => {
          if (token !== this.token) return;
          if (e.data === S.PLAYING) this.set({ status: 'playing', note: null });
          else if (e.data === S.PAUSED) this.set({ status: 'paused' });
          else if (e.data === S.BUFFERING) this.set({ status: 'loading' });
          else if (e.data === S.ENDED) {
            this.set({ status: 'ended' });
            this.emit('ended');
          }
        },
        onError: (e) => {
          if (token !== this.token) return;
          const reason = e.data === 101 || e.data === 150 ? 'The owner does not allow this video to be embedded' : `YouTube player error ${e.data}`;
          this.set({ status: 'error', error: reason });
        },
      },
    });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.emit('time'), 500);
  }

  stopNative() {
    this.switching = false;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }

  destroyEmbed() {
    clearInterval(this.timer);
    try {
      this.yt?.destroy();
    } catch {
      /* already gone */
    }
    this.yt = null;
    this.embedEl.replaceChildren();
  }

  stop() {
    this.token++;
    this.clearWatchdog();
    this.track = null;
    this.destroyEmbed();
    this.stopNative();
    this.preloader.pinned = null;
    this.preloader.clear();
    this.set(INITIAL_STATE);
  }

  // ---------- controls ----------

  play() {
    this.wantPlay = true;
    this.fx?.resume();
    if (this.state.mode === 'embed') this.yt?.playVideo?.();
    else if (this.video.getAttribute('src')) {
      if (this.video.readyState < 3) this.armWatchdog(START_TIMEOUT_MS);
      this.video.play().catch(() => {});
    }
  }

  pause() {
    this.wantPlay = false;
    if (this.state.mode === 'embed') this.yt?.pauseVideo?.();
    else this.video.pause();
  }

  toggle() {
    // mid track-switch the element still holds the old song: just remember the choice
    if (this.switching) {
      this.wantPlay = !this.wantPlay;
      this.set({ status: this.wantPlay ? 'loading' : 'paused' });
      return;
    }
    // check the real player, not just our status: while buffering it is still "playing"
    let running;
    if (this.state.mode === 'embed') {
      const s = this.yt?.getPlayerState?.();
      running = s === 1 || s === 3; // YT.PlayerState.PLAYING / BUFFERING
    } else {
      running = !this.video.paused;
    }
    if (running) this.pause();
    else this.play();
  }

  /**
   * "Play on YouTube now": stop waiting for a slow ad-free server and play this song in the
   * YouTube player right away. Only this song; the next one tries the servers again.
   */
  useYouTubeNow() {
    if (!this.track || this.state.mode !== 'native') return;
    const at = this.video.currentTime > 0 ? this.video.currentTime : this.resumeAt || 0;
    // a new token, so the server lookup still running can't take the song back when it finishes
    const token = ++this.token;
    this.wantPlay = true;
    this.loadEmbed(token, at, true, 'chosen');
  }

  /** Turn the ad-free servers on or off (Settings). Reloads the current song where it was. */
  setAdFree(on) {
    if (on === this.adFree) return;
    this.adFree = on;
    if (!on) this.preloader.clear(); // the YouTube player can't use downloaded audio
    if (!this.track) return;
    const at = this.currentTime;
    const play = this.switching ? this.wantPlay : this.state.status === 'playing' || this.state.status === 'loading';
    this.load(this.track, { startAt: at, autoplay: play });
  }

  /** Data saver (Settings) turns preloading off; what's already held for other songs is freed. */
  setPreload(on) {
    this.preloadOn = on && preloadSupported();
    if (!this.preloadOn) this.preloader.keepOnly([this.track?.id]);
  }

  /**
   * Downloads the audio of the song that will play next (first in the queue / next autoplay pick),
   * so it starts instantly. Only one upcoming song is held; asking for another replaces it.
   */
  async preloadNext(track) {
    if (!track || !this.preloadOn || !this.adFree || track.id === this.track?.id) return;
    if (track.duration > MAX_PRELOAD_SECONDS) return;
    this.preloader.keepOnly([this.track?.id, track.id]);
    try {
      const info = await getVideo(track.id);
      if (!this.preloadOn || (info.track?.duration || 0) > MAX_PRELOAD_SECONDS) return;
      // the same pick loadNative will make, so the downloaded file is the one it plays
      const stream = pickAudio(info.audio, this.video, { preferred: this.preferredLang });
      if (stream) await this.preloader.fetch(track.id, stream);
    } catch {
      /* no server could describe it right now: it will just stream when its turn comes */
    }
  }

  /**
   * Checks, while the current song plays, whether an ad-free server can really play `track`
   * (servers sometimes answer but hand out streams that don't play). If none can, that song
   * starts straight in the YouTube player instead of spending 15–25 seconds trying them first.
   * Resolves to true / false (or undefined when there's nothing to check).
   */
  async checkNext(track) {
    if (!track || !this.adFree || track.id === this.track?.id) return undefined;
    const known = this.verdicts.get(track.id);
    if (known?.ok && Date.now() - known.at < VERDICT_TTL_MS) return true;
    if (known?.checking) return known.checking;
    const checking = (async () => {
      try {
        const info = await getVideo(track.id);
        const stream = pickAudio(info.audio, this.video, { preferred: this.preferredLang }) || pickVideo(info.video, this.video);
        if (!stream) return false;
        await canStart(stream.url, !!this.fx);
        return true;
      } catch {
        return false;
      }
    })();
    this.verdicts.set(track.id, { checking });
    const ok = await checking;
    this.verdicts.set(track.id, { ok, at: Date.now() });
    // only a handful of songs are ever "next"; don't let this grow
    if (this.verdicts.size > 20) this.verdicts.delete(this.verdicts.keys().next().value);
    return ok;
  }

  /** Preferred dub language from Settings ('hi', 'es', … or null for the original); applies right away. */
  setPreferredLang(code) {
    if (code === this.preferredLang) return;
    this.preferredLang = code;
    const tracks = this.state.audioTracks;
    if (this.chosenLang || !tracks.length) return;
    const target =
      (code && tracks.find((t) => baseLang(t.lang) === code && t.kind !== 'descriptive')) ||
      tracks.find((t) => t.kind === 'original');
    if (target && target.lang !== this.state.audioLang) {
      this.setAudioLang(target.lang);
      this.chosenLang = null; // still following the preference, not a manual pick
    }
  }

  /** Switches the current video to another audio language, keeping the position and play state. */
  setAudioLang(lang) {
    if (this.state.mode !== 'native' || !this.track || lang === this.state.audioLang) return;
    this.chosenLang = lang;
    this.wantPlay = this.switching ? this.wantPlay : !this.video.paused;
    const at = this.video.currentTime || 0;
    this.switching = true;
    this.set({ status: 'loading' });
    return this.loadNative(this.token, at, this.wantPlay);
  }

  seek(seconds) {
    const t = Math.max(0, Math.min(seconds, this.duration || seconds));
    if (this.state.mode === 'embed') this.yt?.seekTo?.(t, true);
    else this.video.currentTime = t;
    this.emit('time');
  }

  setVolume(volume, muted) {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  applyVolume() {
    const volume = this.volume * this.fadeLevel;
    const v = this.video;
    if (this.fx) {
      // with effects on, the element feeds the audio graph at full level and the graph sets the volume
      v.volume = 1;
      v.muted = false;
      this.fx.setVolume(volume, this.muted);
    } else {
      v.volume = volume;
      v.muted = this.muted;
    }
    if (this.yt?.setVolume) {
      this.yt.setVolume(Math.round(volume * 100));
      if (this.muted) this.yt.mute();
      else this.yt.unMute();
    }
  }

  // ---------- sound effects ----------

  /** Speed (and with it the pitch) for the current effect; a new song resets it, so this runs per load. */
  applyRate() {
    const v = this.video;
    const rate = this.effect.rate || 1;
    // changing speed should change pitch too ("slowed" songs sound deeper), like a record
    v.preservesPitch = rate === 1;
    v.mozPreservesPitch = rate === 1;
    v.webkitPreservesPitch = rate === 1;
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
  }

  /** Only the ad-free player can process audio; the YouTube player plays as-is. */
  get effectsAvailable() {
    return this.state.mode !== 'embed';
  }

  /** 'normal' | 'slowed' | 'nightcore' | '8d'. Applies to the song that's playing and every song after it. */
  setEffect(id) {
    this.effect = effectById(id);
    if (needsGraph(this.effect) && !this.fx) this.enableGraph();
    this.fx?.resume();
    this.fx?.apply(this.effect);
    if (this.state.mode === 'native') this.applyRate();
    this.emit('state');
  }

  enableGraph() {
    const v = this.video;
    // Web Audio may only read audio the server allows other sites to read (CORS). Streams loaded
    // in this mode ask for that; any server that refuses fails like a broken server and is skipped.
    v.crossOrigin = 'anonymous';
    try {
      this.fx = new SoundFx(v);
    } catch {
      this.fx = null;
      return;
    }
    this.applyVolume();
    // the song that's playing was loaded without asking, so load it again at the same spot
    const src = v.getAttribute('src');
    if (this.state.mode === 'native' && src && !src.startsWith('blob:') && this.track) {
      const at = v.currentTime || 0;
      this.wantPlay = this.switching ? this.wantPlay : !v.paused;
      this.switching = true;
      this.set({ status: 'loading' });
      v.removeAttribute('src');
      this.loadNative(this.token, at, this.wantPlay);
    }
  }

  // ---------- sleep timer ----------

  /** Lowers the volume over `ms`, then pauses and puts the volume back for next time. */
  fadeOut(ms = 8000) {
    clearInterval(this.fadeTimer);
    const started = performance.now();
    return new Promise((resolve) => {
      this.fadeTimer = setInterval(() => {
        const p = Math.min(1, (performance.now() - started) / ms);
        this.fadeLevel = 1 - p;
        this.applyVolume();
        if (p < 1) return;
        clearInterval(this.fadeTimer);
        this.pause();
        this.fadeLevel = 1;
        // restore once the pause has taken effect, so there's no blip of sound
        setTimeout(() => this.applyVolume(), 300);
        resolve();
      }, 100);
    });
  }

  cancelFade() {
    clearInterval(this.fadeTimer);
    if (this.fadeLevel !== 1) {
      this.fadeLevel = 1;
      this.applyVolume();
    }
  }
}
