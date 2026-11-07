import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsRight, Heart, Loader2, Maximize, MicVocal, Music2, ShieldCheck, TriangleAlert, Video, VideoOff, Youtube } from 'lucide-react';
import { useEngineState, useEngineTime, useLocalStorage } from '../lib/hooks';
import { getSkipSegments, skipLabel } from '../lib/skips';
import { thumbnail } from '../lib/youtube';
import { burstHearts } from '../lib/hearts';

function SourceBadge({ state }) {
  if (!state.source) return null;
  if (state.source.type === 'youtube' && state.source.reason === 'off') {
    return (
      <span className="badge badge-warn" title="Ad-free servers are turned off in Settings, so the official YouTube player is used.">
        <Youtube size={13} /> YouTube player
      </span>
    );
  }
  if (state.source.type === 'youtube') {
    return (
      <span className="badge badge-warn" title="No ad-free source was reachable, so the official YouTube player is used.">
        <TriangleAlert size={13} /> YouTube player · ads possible
      </span>
    );
  }
  return (
    <span className="badge" title={`Streaming via ${state.source.base}`}>
      <ShieldCheck size={13} /> Ad-free · {state.source.type}
    </span>
  );
}

/** Netflix-style "Skip intro" button, shown only while a non-music part is playing. */
function SkipButton({ engine, track, onNext }) {
  const [segments, setSegments] = useState([]);
  const { time, duration } = useEngineTime(engine);

  useEffect(() => {
    setSegments([]);
    if (!track) return;
    let cancelled = false;
    getSkipSegments(track.id)
      .then((list) => !cancelled && setSegments(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // parts measured on a different-length upload would skip the wrong bit
  const usable = segments.filter((s) => !s.videoDuration || !duration || Math.abs(s.videoDuration - duration) < 4);
  const seg = usable.find((s) => time >= s.start && time < s.end - 0.5);
  if (!seg) return null;

  const skip = (e) => {
    e.stopPropagation();
    if (duration && seg.end >= duration - 1) onNext();
    else engine.seek(seg.end);
  };
  return (
    <button key={seg.start} className="skip-btn" onClick={skip}>
      {skipLabel(seg, duration)} <ChevronsRight size={18} />
    </button>
  );
}

/**
 * The "now playing" card at the top of the page. Kept short on purpose so search results stay
 * in view; it can also collapse to a slim strip (remembered in settings).
 */
export default function Stage({ engine, track, isFavourite, onToggleFavourite, onNext, compact, onToggleCompact, lyricsOpen, onToggleLyrics }) {
  const state = useEngineState(engine);
  const hostRef = useRef(null);
  const stageRef = useRef(null);

  // the engine owns the <video> and embed elements; we just give them a home
  useEffect(() => {
    hostRef.current.append(engine.video, engine.embedEl);
  }, [engine]);

  // Audio-only app. The YouTube player (used when ad-free servers are off or down) always plays
  // video, so the artwork covers it like in ad-free mode; "Show video" reveals it when wanted.
  const [videoOn, setVideoOn] = useLocalStorage('tq.showVideo', false);
  const isEmbed = state.mode === 'embed';
  const showMedia = isEmbed && videoOn;
  const playing = state.status === 'playing';

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stageRef.current.requestFullscreen?.().catch(() => {});
  };

  const classes = ['hero', compact && 'is-compact', !track && 'is-empty', isEmbed && 'is-embed'].filter(Boolean).join(' ');

  return (
    <section className={classes} aria-label="Now playing">
      {track && <img className="hero-bg" src={thumbnail(track.id, 'hqdefault')} alt="" />}

      {/* always mounted: the engine's player elements live in here */}
      <div className="hero-art">
        {track && !showMedia && <span className={`vinyl ${playing ? 'is-spinning' : ''}`} />}
        <div className="stage" ref={stageRef}>
          {/* the YouTube player stays laid out under the artwork (hiding it can stop playback) */}
          <div ref={hostRef} className={`stage-media ${isEmbed ? '' : 'is-hidden'}`} data-mode={state.mode} />
          {track && !showMedia && (
            <img
              key={track.id}
              className="artwork-cover"
              src={thumbnail(track.id, 'maxresdefault')}
              alt=""
              title="Play / pause"
              onClick={() => engine.toggle()}
              onLoad={(e) => {
                // YouTube serves a 120×90 placeholder when there's no HD thumbnail
                if (e.currentTarget.naturalWidth <= 120) e.currentTarget.src = thumbnail(track.id, 'hqdefault');
              }}
              onError={(e) => (e.currentTarget.src = thumbnail(track.id, 'hqdefault'))}
            />
          )}
          {track && state.status === 'loading' && (
            <div className="stage-overlay">
              <Loader2 className="spin" size={30} />
            </div>
          )}
          {track && state.status === 'error' && (
            <div className="stage-overlay stage-error" title={state.error || ''}>
              <TriangleAlert size={26} />
              <p>{state.error || 'This video could not be played.'}</p>
            </div>
          )}
        </div>
      </div>

      {track ? (
        <div className="hero-info">
          <div className="hero-meta">
            <p className="hero-eyebrow">
              <span className="eyebrow-label">Now playing</span> <SourceBadge state={state} />
            </p>
            <h1 className="now-title" title={track.title}>
              {track.title}
            </h1>
            <p className="now-author">{track.author}</p>
            {state.note && (
              <p className="now-note" role="status">
                {state.status === 'loading' && <Loader2 className="spin" size={13} />} {state.note}
              </p>
            )}
          </div>
          <div className="hero-actions">
            <SkipButton engine={engine} track={track} onNext={onNext} />
            <button className={`icon-btn ${isFavourite ? 'is-fav' : ''}`} onClick={(e) => {
                if (!isFavourite) burstHearts(e.currentTarget);
                onToggleFavourite();
              }}
              title="Favourite (F)"
            >
              <Heart size={19} fill={isFavourite ? 'currentColor' : 'none'} />
            </button>
            <button
              className={`icon-btn ${lyricsOpen ? 'is-on' : ''}`}
              onClick={onToggleLyrics}
              title={lyricsOpen ? 'Hide lyrics (L)' : 'Lyrics (L)'}
              aria-pressed={lyricsOpen}
            >
              <MicVocal size={18} />
            </button>
            {isEmbed && (
              <button
                className={`icon-btn ${videoOn ? 'is-on' : ''}`}
                onClick={() => setVideoOn((on) => !on)}
                title={videoOn ? 'Hide video (audio only)' : 'Show video'}
                aria-pressed={videoOn}
              >
                {videoOn ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
            )}
            {showMedia && (
              <button className="icon-btn" onClick={fullscreen} title="Fullscreen video">
                <Maximize size={17} />
              </button>
            )}
            <button
              className="icon-btn hero-collapse"
              onClick={onToggleCompact}
              title={compact ? 'Show the bigger player' : 'Shrink the player'}
              aria-label={compact ? 'Expand player' : 'Collapse player'}
              aria-expanded={!compact}
            >
              {compact ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
            </button>
          </div>
        </div>
      ) : (
        <div className="hero-empty">
          <span className="hero-empty-icon">
            <Music2 size={24} />
          </span>
          <div>
            <h2>Nothing playing</h2>
            <p>Search for a song, or paste a YouTube link above.</p>
          </div>
        </div>
      )}
    </section>
  );
}
