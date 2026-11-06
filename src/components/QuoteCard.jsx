import { Heart, Sparkles, X } from 'lucide-react';

const DURATION_MS = 10000;

// Quote toast in the top-right corner. Disappears after 10s (paused while hovered);
// triggering it again swaps in another line and restarts the timer.
export default function QuoteCard({ quote, onClose }) {
  const isNote = quote.kind === 'note';
  const Icon = isNote ? Heart : Sparkles;

  return (
    <aside className="quote-toast" key={quote.text} role="status" aria-live="polite">
      <header className="quote-head">
        <span className="quote-icon">
          <Icon size={14} fill={isNote ? 'currentColor' : 'none'} />
        </span>
        <span className="quote-label">{isNote ? 'Just checking in' : 'A little thought'}</span>
        <button className="quote-close" onClick={onClose} aria-label="Dismiss">
          <X size={15} />
        </button>
      </header>
      <p className="quote-text">{quote.text}</p>
      <span className="quote-timer" style={{ animationDuration: `${DURATION_MS}ms` }} onAnimationEnd={onClose} />
    </aside>
  );
}
