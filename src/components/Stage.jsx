import { useEffect, useRef } from 'react';
import { Heart, Loader2, Maximize, Music2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEngineState } from '../lib/hooks';
import { thumbnail } from '../lib/youtube';

function SourceBadge({ state }) {
  if (!state.source) return null;
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

export default function Stage({ engine, track, isFavourite, onToggleFavourite }) {
  const state = useEngineState(engine);
  const hostRef = useRef(null);
  const stageRef = useRef(null);

  // the engine owns the <video> and embed elements; we just give them a home
  useEffect(() => {
    hostRef.current.append(engine.video, engine.embedEl);
  }, [engine]);

  // audio-only app: the picture is only shown for the YouTube embed fallback
  const showMedia = state.mode === 'embed';
  const showArtwork = track && !showMedia;

  const fullscreen = () => {
    const el = stageRef.current;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => {});
  };

  return (
    <section className="stage-wrap">
      <div className="stage" ref={stageRef}>
        <div
          ref={hostRef}
          className={`stage-media ${showMedia ? '' : 'is-hidden'}`}
          data-mode={state.mode}
        />

        {showArtwork && (
          <div className="artwork" onClick={() => engine.toggle()} title="Play / pause">
            <img className="artwork-bg" src={thumbnail(track.id, 'hqdefault')} alt="" />
            {/* full 16:9 cover (YouTube thumbnails are wide, a circle would crop them) with a record peeking out */}
            <div className="artwork-stack">
              <span className={`vinyl ${state.status === 'playing' ? 'is-spinning' : ''}`} />
              <img
                key={track.id}
                className="artwork-cover"
                src={thumbnail(track.id, 'maxresdefault')}
                alt=""
                onLoad={(e) => {
                  // YouTube serves a 120×90 placeholder when there's no HD thumbnail
                  if (e.currentTarget.naturalWidth <= 120) e.currentTarget.src = thumbnail(track.id, 'hqdefault');
                }}
                onError={(e) => (e.currentTarget.src = thumbnail(track.id, 'hqdefault'))}
              />
            </div>
          </div>
        )}

        {!track && (
          <div className="stage-empty">
            <Music2 size={44} />
            <h2>Nothing playing</h2>
            <p className="muted">Search for a song, or paste a YouTube link above.</p>
          </div>
        )}

        {track && state.status === 'loading' && (
          <div className="stage-overlay">
            <Loader2 className="spin" size={36} />
          </div>
        )}

        {track && state.status === 'error' && (
          <div className="stage-overlay stage-error">
            <TriangleAlert size={30} />
            <p>{state.error || 'This video could not be played.'}</p>
          </div>
        )}

        {track && (
          <div className="stage-tools">
            <SourceBadge state={state} />
            <button className="icon-btn glass" onClick={fullscreen} title="Fullscreen">
              <Maximize size={16} />
            </button>
          </div>
        )}
      </div>

      {track && (
        <div className="now">
          <div className="now-text">
            <h1 className="now-title">{track.title}</h1>
            <p className="now-author">{track.author}</p>
          </div>
          <button className={`icon-btn lg ${isFavourite ? 'is-fav' : ''}`} onClick={onToggleFavourite} title="Favourite (F)">
            <Heart size={22} fill={isFavourite ? 'currentColor' : 'none'} />
          </button>
        </div>
      )}
    </section>
  );
}
