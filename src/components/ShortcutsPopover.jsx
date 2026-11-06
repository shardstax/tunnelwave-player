import { useRef } from 'react';
import { X } from 'lucide-react';
import { useDismiss } from '../lib/hooks';
import { SHORTCUTS } from '../lib/shortcuts';

export function ShortcutList() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([key, label]) => (
        <div key={key}>
          <dt>
            <kbd>{key}</kbd>
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ShortcutsPopover({ onClose }) {
  const ref = useRef(null);
  useDismiss(ref, true, onClose);
  return (
    <div className="shortcuts-pop" ref={ref} role="dialog" aria-label="Keyboard shortcuts">
      <header className="panel-head">
        <h3>Keyboard shortcuts</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>
      <ShortcutList />
    </div>
  );
}
