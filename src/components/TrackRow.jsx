import { memo, useCallback, useRef, useState } from 'react';
import { Heart, ListEnd, ListPlus, Play, Plus, X } from 'lucide-react';
import { useActions } from '../actions';
import { useDismiss } from '../lib/hooks';
import { formatTime } from '../lib/format';
import { burstHearts } from '../lib/hearts';

export function Thumb({ track, onPlay, size = 'md' }) {
  return (
    <button className={`thumb thumb-${size}`} onClick={onPlay} title="Play now" aria-label={`Play ${track.title}`}>
      <img src={track.thumbnail} alt="" loading="lazy" />
      {track.duration > 0 && <span className="thumb-time">{formatTime(track.duration)}</span>}
      <span className="thumb-play">
        <Play size={18} fill="currentColor" />
      </span>
    </button>
  );
}

function PlaylistMenu({ track, onClose }) {
  const { playlists, addToPlaylist, createPlaylist, toast } = useActions();
  const [name, setName] = useState('');
  const ref = useRef(null);
  useDismiss(ref, true, onClose);

  const create = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    createPlaylist(name.trim(), [track]);
    toast(`Created “${name.trim()}”`);
    onClose();
  };

  return (
    <div className="menu" ref={ref} role="menu">
      <div className="menu-title">Add to playlist</div>
      {playlists.map((p) => (
        <button
          key={p.id}
          className="menu-item"
          onClick={() => {
            addToPlaylist(p.id, [track]);
            onClose();
          }}
        >
          {p.name}
          <span className="muted">{p.tracks.length}</span>
        </button>
      ))}
      <form className="menu-new" onSubmit={create}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist…" />
        <button className="icon-btn" disabled={!name.trim()} aria-label="Create playlist">
          <Plus size={16} />
        </button>
      </form>
    </div>
  );
}

/** A song in any list (results, favourites, recent, suggestions, playlists). */
function TrackRow({ track, onRemove, removeLabel = 'Remove' }) {
  const { addToQueue, playNow, isFavourite, toggleFavourite } = useActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const fav = isFavourite(track.id);

  return (
    <li className="track">
      <Thumb track={track} onPlay={() => playNow(track)} />
      <div className="track-text">
        <div className="track-title" title={track.title}>
          {track.title}
        </div>
        <div className="track-author">{track.author}</div>
      </div>
      <div className="track-actions">
        <button className={`icon-btn ${fav ? 'is-fav' : ''}`} onClick={(e) => {
            if (!fav) burstHearts(e.currentTarget);
            toggleFavourite(track);
          }} title={fav ? 'Remove from favourites' : 'Add to favourites'}>
          <Heart size={17} fill={fav ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn hide-sm" onClick={() => addToQueue([track], { next: true })} title="Play next">
          <ListEnd size={17} />
        </button>
        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)} title="Add to playlist" aria-expanded={menuOpen}>
            <ListPlus size={17} />
          </button>
          {menuOpen && <PlaylistMenu track={track} onClose={closeMenu} />}
        </div>
        {onRemove ? (
          <button className="icon-btn" onClick={onRemove} title={removeLabel}>
            <X size={17} />
          </button>
        ) : null}
        <button className="btn btn-soft btn-sm" onClick={() => addToQueue([track])} title="Add to queue">
          <Plus size={15} />
          <span className="hide-sm">Queue</span>
        </button>
      </div>
    </li>
  );
}

export default memo(TrackRow);
