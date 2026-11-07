import { createPortal } from 'react-dom';
import { Heart, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEngineState, useEngineTime } from '../lib/hooks';
import { thumbnail } from '../lib/youtube';

/**
 * Opens an always-on-top window (Chrome / Edge "Document Picture-in-Picture") and copies the app's
 * styles and colours into it. Resolves to the window, or null if the browser can't do it.
 */
export async function openMiniWindow() {
  if (!('documentPictureInPicture' in window)) return null;
  const win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 168 });
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

function MiniPlayer({ engine, track, isFavourite, onToggleFavourite, onPrev, onNext }) {
  const state = useEngineState(engine);
  const { time, duration } = useEngineTime(engine);
  const playing = state.status === 'playing';
  const loading = state.status === 'loading';
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  if (!track) {
    return (
      <div className="mini">
        <p className="mini-empty">Nothing playing</p>
      </div>
    );
  }

  return (
    <div className="mini">
      <img className="mini-bg" src={thumbnail(track.id, 'mqdefault')} alt="" />
      <img className="mini-art" src={thumbnail(track.id, 'mqdefault')} alt="" />
      <div className="mini-main">
        <div className="mini-text">
          <div className="mini-title" title={track.title}>
            {track.title}
          </div>
          <div className="mini-author">{track.author}</div>
        </div>
        <div className="mini-controls">
          <button className="mini-btn" onClick={onPrev} title="Previous">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="mini-play" onClick={() => engine.toggle()} title="Play / pause">
            {loading ? <Loader2 className="spin" size={20} /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="mini-btn" onClick={onNext} title="Next">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            className={`mini-btn ${isFavourite ? 'is-fav' : ''}`}
            onClick={onToggleFavourite}
            title="Favourite"
          >
            <Heart size={17} fill={isFavourite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      <div className="mini-progress" style={{ '--p': `${pct}%` }} />
    </div>
  );
}

/** Renders the mini player into the floating window. */
export default function MiniPlayerPortal({ win, ...props }) {
  return createPortal(<MiniPlayer {...props} />, win.document.body);
}

