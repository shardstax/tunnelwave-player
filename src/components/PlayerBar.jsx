import { useRef, useState } from 'react';
import {
  Check,
  Heart,
  Keyboard,
  Languages,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useDismiss, useEngineState, useEngineTime } from '../lib/hooks';
import { formatTime, languageName } from '../lib/format';

function Progress({ engine }) {
  const { time, duration } = useEngineTime(engine);
  const [drag, setDrag] = useState(null);
  const value = drag ?? time;
  const pct = duration ? Math.min(100, (value / duration) * 100) : 0;

  const commit = () => {
    if (drag !== null) engine.seek(drag);
    setDrag(null);
  };

  return (
    <div className="progress">
      <span className="time">{formatTime(value)}</span>
      <input
        type="range"
        className="range"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(value, duration || 0)}
        style={{ '--p': `${pct}%` }}
        disabled={!duration}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Seek"
      />
      <span className="time">{formatTime(duration)}</span>
    </div>
  );
}

/** Only shown for videos that come with dubbed audio tracks. */
function LanguageMenu({ engine, state }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, open, () => setOpen(false));
  const tracks = state.audioTracks;
  if (tracks.length < 2) return null;
  const base = (lang) => (lang || '').split('-')[0];
  const code = base(state.audioLang).toUpperCase();
  // 'English', not 'American English', unless two tracks share a language (e.g. Chinese)
  const label = (lang) => languageName(tracks.filter((t) => base(t.lang) === base(lang)).length > 1 ? lang : base(lang));

  return (
    <div className="lang" ref={ref}>
      <button
        className={`icon-btn lang-btn ${open ? 'is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Audio language: ${label(state.audioLang)}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Languages size={17} />
        {code && <span className="lang-code">{code}</span>}
      </button>
      {open && (
        <div className="lang-pop" role="menu" aria-label="Audio language">
          <p className="label">Audio language</p>
          <ul>
            {tracks.map((t) => {
              const on = t.lang === state.audioLang;
              return (
                <li key={t.lang}>
                  <button
                    role="menuitemradio"
                    aria-checked={on}
                    className={on ? 'is-on' : ''}
                    onClick={() => {
                      engine.setAudioLang(t.lang);
                      setOpen(false);
                    }}
                  >
                    <span className="lang-name">{label(t.lang)}</span>
                    {t.kind === 'original' && <span className="lang-tag">Original</span>}
                    {t.kind === 'descriptive' && <span className="lang-tag">Described</span>}
                    {on && <Check size={15} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PlayerBar({
  engine,
  track,
  settings,
  isFavourite,
  onToggleFavourite,
  onPrev,
  onNext,
  onUpdateSettings,
  onShuffle,
  onShowShortcuts,
}) {
  const state = useEngineState(engine);
  const { shuffle, repeat, volume, muted } = settings;
  const playing = state.status === 'playing';
  const loading = state.status === 'loading';

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;
  const nextRepeat = { off: 'all', all: 'one', one: 'off' }[repeat];

  return (
    <footer className="bar">
      <div className="bar-track">
        {track ? (
          <>
            <img src={track.thumbnail} alt="" />
            <div className="track-text">
              <div className="track-title">{track.title}</div>
              <div className="track-author">{track.author}</div>
            </div>
            <button className={`icon-btn hide-sm ${isFavourite ? 'is-fav' : ''}`} onClick={onToggleFavourite} title="Favourite (F)">
              <Heart size={18} fill={isFavourite ? 'currentColor' : 'none'} />
            </button>
          </>
        ) : (
          <span className="muted small">Not playing</span>
        )}
      </div>

      <div className="bar-center">
        <div className="controls">
          <button className={`icon-btn ${shuffle ? 'is-on' : ''}`} onClick={onShuffle} title="Shuffle upcoming songs (S)">
            <Shuffle size={18} />
          </button>
          <button className="icon-btn" onClick={onPrev} disabled={!track} title="Previous (Ctrl + ←)">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="play-btn" onClick={() => engine.toggle()} disabled={!track} title="Play/Pause (Space)">
            {loading ? <Loader2 className="spin" size={22} /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={onNext} disabled={!track} title="Next (Ctrl + →)">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button
            className={`icon-btn ${repeat !== 'off' ? 'is-on' : ''}`}
            onClick={() => onUpdateSettings({ repeat: nextRepeat })}
            title={`Repeat: ${repeat} (R)`}
          >
            <RepeatIcon size={18} />
          </button>
        </div>
        <Progress engine={engine} />
      </div>

      <div className="bar-right">
        <LanguageMenu engine={engine} state={state} />
        <button
          className="icon-btn hide-sm"
          onClick={onShowShortcuts}
          onPointerDown={(e) => e.stopPropagation()}
          title="Keyboard shortcuts (Alt + /)"
        >
          <Keyboard size={18} />
        </button>
        <div className="volume hide-sm">
          <button className="icon-btn" onClick={() => onUpdateSettings({ muted: !muted })} title="Mute (M)">
            <VolumeIcon size={18} />
          </button>
          <input
            type="range"
            className="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            style={{ '--p': `${(muted ? 0 : volume) * 100}%` }}
            onChange={(e) => onUpdateSettings({ volume: Number(e.target.value), muted: false })}
            aria-label="Volume"
          />
        </div>
      </div>
    </footer>
  );
}
