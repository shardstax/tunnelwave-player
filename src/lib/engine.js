// One player for the whole app. Prefers an ad-free stream in a plain <video> element;
// if every stream source fails it falls back to the official YouTube embed.
import { getVideo } from './api';

const MAX_STREAM_ATTEMPTS = 4;

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

    this.embedEl = document.createElement('div');
    this.embedEl.className = 'embed-host';

    const v = (this.video = document.createElement('video'));
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('playing', () => {
      this.switching = false;
      // paused by the user while the stream was still starting
      if (!this.wantPlay) return v.pause();
      this.set({ status: 'playing' });
    });
    v.addEventListener('pause', () => {
      if (!this.switching && this.state.mode === 'native' && !v.ended) this.set({ status: 'paused' });
    });
    v.addEventListener('waiting', () => this.set({ status: 'loading' }));
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
    this.destroyEmbed();
    this.switching = true;
    this.video.pause();
    this.set({ ...INITIAL_STATE, status: 'loading', mode: 'native' });
    await this.loadNative(token, startAt, autoplay);
  }

  async loadNative(token, startAt, autoplay) {
    let info;
    try {
      info = await getVideo(this.track.id, { exclude: this.excluded });
    } catch (e) {
      if (token === this.token) this.loadEmbed(token, startAt, autoplay);
      return;
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
    v.src = stream.url;
    v.volume = this.volume;
    v.muted = this.muted;
    if (startAt > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = startAt), { once: true });

    if (!autoplay) {
      this.switching = false;
      this.set({ status: 'paused' });
      return;
    }
    v.play().catch((err) => {
      if (token !== this.token || err.name !== 'NotAllowedError') return;
      // browser blocked autoplay (e.g. right after a page reload) — wait for a click
      this.switching = false;
      this.wantPlay = false;
      this.set({ status: 'paused' });
    });
  }

  onNativeError() {
    if (this.state.mode !== 'native' || !this.video.getAttribute('src')) return;
    if (this.state.source) this.excluded.add(this.state.source.base);
    this.retry(this.token, this.video.currentTime, true);
  }

  retry(token, startAt, autoplay) {
    if (++this.attempts >= MAX_STREAM_ATTEMPTS) return this.loadEmbed(token, startAt, autoplay);
    this.set({ status: 'loading' });
    return this.loadNative(token, startAt, autoplay);
  }

  async loadEmbed(token, startAt, autoplay) {
    this.stopNative();
    this.set({
      mode: 'embed',
      status: 'loading',
      showVideo: true,
      source: { type: 'youtube', base: 'youtube-nocookie.com' },
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
          if (e.data === S.PLAYING) this.set({ status: 'playing' });
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
    this.track = null;
    this.destroyEmbed();
    this.stopNative();
    this.set(INITIAL_STATE);
  }

  // ---------- controls ----------

  play() {
    this.wantPlay = true;
    if (this.state.mode === 'embed') this.yt?.playVideo?.();
    else if (this.video.getAttribute('src')) this.video.play().catch(() => {});
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
    this.video.volume = volume;
    this.video.muted = muted;
    if (this.yt?.setVolume) {
      this.yt.setVolume(Math.round(volume * 100));
      if (muted) this.yt.mute();
      else this.yt.unMute();
    }
  }
}
