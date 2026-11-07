import { useState } from 'react';
import {
  Brain,
  Car,
  CloudRain,
  Coffee,
  Disc3,
  Drum,
  Dumbbell,
  Flame,
  HeartHandshake,
  LoaderCircle,
  PartyPopper,
  Radio as RadioIcon,
  Shuffle,
  Sparkles,
  Square,
  Sun,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { BulkBar, Empty, Skeleton, TrackList } from './Browse';
import { VIBES, customVibe } from '../lib/vibes';

const ICONS = { Brain, Car, CloudRain, Coffee, Disc3, Drum, Dumbbell, Flame, HeartHandshake, PartyPopper, Radio: RadioIcon, Sun, WandSparkles, Zap };

function VibeTile({ vibe, playing, loading, onStart }) {
  const Icon = ICONS[vibe.icon] || Sparkles;
  return (
    <li>
      <button
        className={`vibe-tile ${playing ? 'is-on' : ''}`}
        style={{ '--h': vibe.hue }}
        onClick={() => onStart(vibe)}
        disabled={loading}
        aria-pressed={playing}
        title={playing ? `${vibe.name} is playing` : `Play ${vibe.name} station`}
      >
        <span className="vibe-icon">{loading ? <LoaderCircle size={20} className="spin" /> : <Icon size={20} />}</span>
        <span className="vibe-text">
          <span className="vibe-name">{vibe.name}</span>
          <span className="vibe-hint">{playing ? 'On air' : vibe.hint}</span>
        </span>
      </button>
    </li>
  );
}

/** The Stations tab: mood stations on top, then what autoplay will play next. */
export default function Radio({
  vibe,
  vibeLoading,
  onStartVibe,
  onStopVibe,
  tracks,
  loading,
  basedOn,
  hasTrack,
  autoRadio,
  onToggleAutoRadio,
  onReshuffle,
}) {
  const [text, setText] = useState('');
  // a custom vibe that's playing gets its own tile at the front
  const tiles = vibe?.custom ? [vibe, ...VIBES] : VIBES;
  const ActiveIcon = vibe ? ICONS[vibe.icon] || Sparkles : null;

  return (
    <div className="radio">
      {vibe && (
        <div className="on-air" style={{ '--h': vibe.hue }}>
          <span className="vibe-icon">
            <ActiveIcon size={22} />
          </span>
          <div className="on-air-text">
            <p className="on-air-eyebrow">
              <span className="live-dot" /> On air
            </p>
            <h3>{vibe.name} station</h3>
            <p className="small">Plays after your queue and keeps going. Skip what you don’t like and it learns.</p>
          </div>
          <div className="on-air-actions">
            <button className="btn btn-soft btn-sm" onClick={onReshuffle} title="Show different picks">
              <Shuffle size={15} /> Different picks
            </button>
            <button className="btn btn-soft btn-sm" onClick={onStopVibe}>
              <Square size={13} fill="currentColor" /> Stop
            </button>
          </div>
        </div>
      )}

      <section className="vibes">
        <div className="radio-head">
          <h3>Vibes</h3>
          <p className="muted small">Pick a mood for a station that keeps playing songs that fit.</p>
        </div>
        <ul className="vibe-grid">
          {tiles.map((v) => (
            <VibeTile key={v.id} vibe={v} playing={vibe?.id === v.id} loading={vibeLoading === v.id} onStart={onStartVibe} />
          ))}
        </ul>
        <form
          className="inline-form vibe-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 2) return;
            onStartVibe(customVibe(text));
            setText('');
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or type any vibe: Hindi rap, 2000s pop, Arijit sad songs…"
            aria-label="Start a station for any vibe"
          />
          <button className="btn btn-accent btn-sm" disabled={text.trim().length < 2 || !!vibeLoading}>
            {vibeLoading?.startsWith('custom:') ? <LoaderCircle size={15} className="spin" /> : <RadioIcon size={15} />} Start
          </button>
        </form>
      </section>

      <section className="radio-next">
        {vibe ? (
          <div className="radio-head">
            <h3>Up next on {vibe.name}</h3>
            <p className="muted small">{tracks.length} songs lined up, more get added as you listen</p>
          </div>
        ) : (
          <div className="list-head">
            <div className="radio-head">
              <h3>Similar to what’s playing</h3>
              <p className="muted small radio-basis">
                {basedOn ? (
                  <>
                    Based on <strong>{basedOn.title}</strong> and what you played before it
                  </>
                ) : (
                  'Follows whatever you play'
                )}
              </p>
            </div>
            <label className="switch">
              <input type="checkbox" checked={autoRadio} onChange={onToggleAutoRadio} />
              <span className="switch-track" />
              Autoplay when the queue ends
            </label>
          </div>
        )}

        {loading && !tracks.length ? (
          <Skeleton />
        ) : tracks.length ? (
          <>
            {!vibe && <BulkBar tracks={tracks} onReshuffle={onReshuffle} />}
            <TrackList tracks={tracks} />
          </>
        ) : vibe ? (
          <Skeleton />
        ) : (
          <Empty icon={Sparkles} title={hasTrack ? 'No suggestions for this song yet' : 'Play something, or pick a vibe'}>
            {hasTrack
              ? 'The radio servers didn’t answer. Try another song, or skip ahead and it will try again.'
              : 'Play any song and similar music appears here. Skip what you don’t like and it learns.'}
          </Empty>
        )}
      </section>
    </div>
  );
}
