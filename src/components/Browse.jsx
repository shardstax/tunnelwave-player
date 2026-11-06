import { useState } from 'react';
import { ArrowLeft, Clock, Heart, ListMusic, ListPlus, Pencil, Play, Plus, Search, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import TrackRow from './TrackRow';
import { useActions } from '../actions';
import { formatTotal } from '../lib/format';

function Empty({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      <Icon size={32} />
      <p>{title}</p>
      {children && <p className="muted small">{children}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <ul className="tracks">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="track skeleton">
          <span className="thumb thumb-md" />
          <span className="track-text">
            <span className="sk-line" />
            <span className="sk-line short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrackList({ tracks, onRemove, removeLabel }) {
  return (
    <ul className="tracks">
      {tracks.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} onRemove={onRemove && (() => onRemove(t, i))} removeLabel={removeLabel} />
      ))}
    </ul>
  );
}

/** Buttons shown above any group of songs: play all / add all / save. */
function BulkBar({ tracks, saveName }) {
  const { addToQueue, replaceQueue, createPlaylist, toast } = useActions();
  if (!tracks.length) return null;
  return (
    <div className="bulk">
      <button className="btn btn-accent btn-sm" onClick={() => replaceQueue(tracks)}>
        <Play size={15} fill="currentColor" /> Play all
      </button>
      <button className="btn btn-soft btn-sm" onClick={() => addToQueue(tracks)}>
        <Plus size={15} /> Add all to queue
      </button>
      {saveName && (
        <button
          className="btn btn-soft btn-sm"
          onClick={() => {
            createPlaylist(saveName, tracks);
            toast(`Saved “${saveName}” to your playlists`);
          }}
        >
          <ListPlus size={15} /> Save as playlist
        </button>
      )}
    </div>
  );
}

export function Results({ search, onFilter, onRetry, onOpenSettings }) {
  if (search.status === 'idle') {
    return (
      <Empty icon={Search} title="Find something to play">
        Type a song or artist name, or paste any YouTube video or playlist link.
      </Empty>
    );
  }
  if (search.status === 'loading') return <Skeleton />;
  if (search.status === 'error') {
    return (
      <div className="empty">
        <TriangleAlert size={32} />
        <p>Couldn’t load results</p>
        <p className="muted small">{search.error}</p>
        <div className="row gap-xs">
          <button className="btn btn-accent btn-sm" onClick={onRetry}>
            Try again
          </button>
          <button className="btn btn-soft btn-sm" onClick={onOpenSettings}>
            Server settings
          </button>
        </div>
      </div>
    );
  }

  if (search.playlist) {
    const { title, tracks } = search.playlist;
    return (
      <>
        <div className="list-head">
          <div>
            <h3>{title}</h3>
            <p className="muted small">
              YouTube playlist · {tracks.length} videos · {formatTotal(tracks.reduce((s, t) => s + t.duration, 0))}
            </p>
          </div>
        </div>
        <BulkBar tracks={tracks} saveName={title} />
        <TrackList tracks={tracks} />
      </>
    );
  }

  return (
    <>
      <div className="list-head">
        <p className="muted small">
          Results for <strong>“{search.query}”</strong>
        </p>
        <div className="segmented">
          {[
            ['videos', 'Videos'],
            ['music', 'Songs'],
          ].map(([key, label]) => (
            <button key={key} className={search.filter === key ? 'is-on' : ''} onClick={() => onFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {search.tracks.length ? <TrackList tracks={search.tracks} /> : <Empty icon={Search} title="No results" />}
    </>
  );
}

export function Suggestions({ tracks, loading, basedOn, autoRadio, onToggleAutoRadio, hasTrack }) {
  return (
    <>
      <div className="list-head">
        <p className="muted small radio-basis">
          {basedOn ? (
            <>
              Your radio, based on <strong>{basedOn.title}</strong> and what you played before it
            </>
          ) : (
            'Your radio follows what you play'
          )}
        </p>
        <label className="switch">
          <input type="checkbox" checked={autoRadio} onChange={onToggleAutoRadio} />
          <span className="switch-track" />
          Autoplay when the queue ends
        </label>
      </div>
      {loading && !tracks.length ? (
        <Skeleton />
      ) : tracks.length ? (
        <>
          <BulkBar tracks={tracks} />
          <TrackList tracks={tracks} />
        </>
      ) : (
        <Empty icon={Sparkles} title={hasTrack ? 'No radio for this song yet' : 'Play something first'}>
          {hasTrack
            ? 'The radio servers didn’t answer. Try another song, or skip ahead and it will try again.'
            : 'Play any song and a radio of similar music appears here. Skip what you don’t like and it learns.'}
        </Empty>
      )}
    </>
  );
}

export function Favourites({ favourites }) {
  const { toggleFavourite } = useActions();
  if (!favourites.length) {
    return (
      <Empty icon={Heart} title="No favourites yet">
        Tap the heart on any song to save it here.
      </Empty>
    );
  }
  return (
    <>
      <BulkBar tracks={favourites} />
      <TrackList tracks={favourites} onRemove={(t) => toggleFavourite(t)} removeLabel="Remove from favourites" />
    </>
  );
}

export function Recent({ recent, onClear }) {
  if (!recent.length) {
    return (
      <Empty icon={Clock} title="Nothing played yet">
        Your last 50 songs will show up here.
      </Empty>
    );
  }
  return (
    <>
      <div className="list-head">
        <p className="muted small">Last {recent.length} songs</p>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear history
        </button>
      </div>
      <TrackList tracks={recent} />
    </>
  );
}

export function Playlists({ playlists }) {
  const { createPlaylist, deletePlaylist, renamePlaylist, removeFromPlaylist } = useActions();
  const [openId, setOpenId] = useState(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const open = playlists.find((p) => p.id === openId);

  if (open) {
    return (
      <>
        <div className="list-head">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>
            <ArrowLeft size={15} /> All playlists
          </button>
          <div className="row gap-xs">
            <button className="icon-btn" onClick={() => setRenaming((r) => !r)} title="Rename">
              <Pencil size={16} />
            </button>
            <button
              className="icon-btn"
              title="Delete playlist"
              onClick={() => {
                if (confirm(`Delete the playlist “${open.name}”?`)) {
                  deletePlaylist(open.id);
                  setOpenId(null);
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {renaming ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('name').trim();
              if (value) renamePlaylist(open.id, value);
              setRenaming(false);
            }}
          >
            <input name="name" autoFocus defaultValue={open.name} />
            <button className="btn btn-accent btn-sm">Rename</button>
          </form>
        ) : (
          <h3 className="playlist-title">{open.name}</h3>
        )}
        <BulkBar tracks={open.tracks} />
        {open.tracks.length ? (
          <TrackList tracks={open.tracks} onRemove={(t, i) => removeFromPlaylist(open.id, i)} removeLabel="Remove from playlist" />
        ) : (
          <Empty icon={ListMusic} title="This playlist is empty">
            Use the <ListPlus size={13} /> button on any song to add it here.
          </Empty>
        )}
      </>
    );
  }

  return (
    <>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          createPlaylist(name.trim(), []);
          setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name (e.g. Gym, Chill)" />
        <button className="btn btn-accent btn-sm" disabled={!name.trim()}>
          <Plus size={15} /> Create
        </button>
      </form>
      {playlists.length === 0 ? (
        <Empty icon={ListMusic} title="No playlists yet">
          Create one above, or save your queue or a YouTube playlist.
        </Empty>
      ) : (
        <ul className="playlist-grid">
          {playlists.map((p) => (
            <li key={p.id}>
              <button className="playlist-card" onClick={() => setOpenId(p.id)}>
                <span className="mosaic">
                  {Array.from({ length: 4 }, (_, i) =>
                    p.tracks[i] ? <img key={i} src={p.tracks[i].thumbnail} alt="" loading="lazy" /> : <span key={i} />,
                  )}
                </span>
                <span className="playlist-name">{p.name}</span>
                <span className="muted small">{p.tracks.length} songs</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
