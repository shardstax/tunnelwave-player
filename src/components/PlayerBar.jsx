import { useState } from 'react';
import {
  Heart,
  Keyboard,
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
import { useEngineState, useEngineTime } from '../lib/hooks';
import { formatTime } from '../lib/format';

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
