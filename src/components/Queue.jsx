import { memo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical, ListMusic, Save, Trash2, X } from 'lucide-react';
import { formatTime, formatTotal } from '../lib/format';

function Equalizer({ paused }) {
  return (
    <span className={`eq ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

const QueueItem = memo(function QueueItem({ item, index, count, onPlay, onMove, onRemove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className={`qitem ${isDragging ? 'is-dragging' : ''}`}>
      <button ref={setActivatorNodeRef} className="grip" {...attributes} {...listeners} aria-label={`Drag to reorder ${item.title}`}>
        <GripVertical size={16} />
      </button>
      <button className="qitem-main" onClick={() => onPlay(item.uid)} title="Play now">
        <span className="qitem-index">{index + 1}</span>
        <img src={item.thumbnail} alt="" loading="lazy" />
        <span className="track-text">
          <span className="track-title">{item.title}</span>
          <span className="track-author">
            {item.author}
            {item.duration > 0 && ` · ${formatTime(item.duration)}`}
          </span>
        </span>
      </button>
      <div className="qitem-actions">
        <button className="icon-btn" disabled={index === 0} onClick={() => onMove(index, index - 1)} title="Move up">
          <ChevronUp size={16} />
        </button>
        <button className="icon-btn" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} title="Move down">
          <ChevronDown size={16} />
        </button>
        <button className="icon-btn" onClick={() => onRemove(item.uid)} title="Remove">
          <X size={16} />
        </button>
      </div>
    </li>
  );
});

function Queue({ queue, current, isPlaying, onPlay, onMove, onRemove, onClear, onSaveAsPlaylist }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const total = queue.reduce((sum, t) => sum + (t.duration || 0), 0);

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = queue.findIndex((q) => q.uid === active.id);
    const to = queue.findIndex((q) => q.uid === over.id);
    onMove(from, to);
  };

  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSaveAsPlaylist(name.trim());
    setName('');
    setSaving(false);
  };

  return (
    <section className="panel queue">
      {current && (
        <div className="now-card">
          <p className="label">Now playing</p>
          <div className="qitem is-current">
            <span className="qitem-index">
              <Equalizer paused={!isPlaying} />
            </span>
            <img src={current.thumbnail} alt="" />
            <span className="track-text">
              <span className="track-title">{current.title}</span>
              <span className="track-author">{current.author}</span>
            </span>
          </div>
        </div>
      )}

      <header className="panel-head">
        <div>
          <h2>Next up</h2>
          <p className="muted small">
            {queue.length} {queue.length === 1 ? 'song' : 'songs'}
            {total > 0 && ` · ${formatTotal(total)}`}
          </p>
        </div>
        {(queue.length > 0 || current) && (
          <div className="row gap-xs">
            <button className="icon-btn" onClick={() => setSaving((s) => !s)} title="Save as playlist">
              <Save size={17} />
            </button>
            {queue.length > 0 && (
              <button className="icon-btn" onClick={onClear} title="Clear queue">
                <Trash2 size={17} />
              </button>
            )}
          </div>
        )}
      </header>

      {saving && (
        <form className="inline-form" onSubmit={save}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
          <button className="btn btn-accent btn-sm" disabled={!name.trim()}>
            Save
          </button>
        </form>
      )}

      {queue.length === 0 ? (
        <div className="empty">
          <ListMusic size={32} />
          <p>Nothing queued</p>
          <p className="muted small">Search for a song or paste a YouTube link, then hit “Queue”.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
          <SortableContext items={queue.map((q) => q.uid)} strategy={verticalListSortingStrategy}>
            <ol className="qlist">
              {queue.map((item, i) => (
                <QueueItem key={item.uid} item={item} index={i} count={queue.length} onPlay={onPlay} onMove={onMove} onRemove={onRemove} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

export default memo(Queue);
