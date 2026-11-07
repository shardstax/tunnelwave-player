import { useEffect, useRef, useState } from 'react';
import { AudioWaveform, Check, Moon, PictureInPicture2 } from 'lucide-react';
import { useDismiss } from '../lib/hooks';
import { EFFECTS } from '../lib/effects';

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, open, () => setOpen(false));
  return { open, setOpen, ref };
}

/** ✨ Sound: Normal / Slowed + Reverb / Nightcore / 8D. */
export function EffectsMenu({ effect, available, onChange }) {
  const { open, setOpen, ref } = usePopover();
  const active = effect !== 'normal';
  const current = EFFECTS.find((e) => e.id === effect) || EFFECTS[0];
  return (
    <div className="bar-menu" ref={ref}>
      <button
        className={`icon-btn pill-btn ${active ? 'is-on' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={active ? `Sound: ${current.name}` : 'Sound effects'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AudioWaveform size={18} />
        {active && <span className="pill-label">{current.id === '8d' ? '8D' : current.name.split(' ')[0]}</span>}
      </button>
      {open && (
        <div className="bar-pop" role="menu" aria-label="Sound effects">
          <p className="label">Sound</p>
          {!available && <p className="pop-note">Effects work with ad-free servers. They’ll apply when the next song uses one.</p>}
          <ul>
            {EFFECTS.map((e) => {
              const on = e.id === effect;
              return (
                <li key={e.id}>
                  <button role="menuitemradio" aria-checked={on} className={`pop-item ${on ? 'is-on' : ''}`} onClick={() => onChange(e.id)}>
                    <span className="pop-text">
                      <span className="pop-name">{e.name}</span>
                      <span className="pop-hint">{e.hint}</span>
                    </span>
                    {on && <Check size={16} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const SLEEP_OPTIONS = [15, 30, 45, 60, 90, 120];
const sleepLabel = (m) => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`);

function useCountdown(endsAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const left = Math.max(0, Math.round((endsAt - now) / 1000));
  const m = Math.floor(left / 60);
  return `${m}:${String(left % 60).padStart(2, '0')}`;
}

/** 🌙 Sleep timer: stop after N minutes or at the end of this song, with a gentle fade. */
export function SleepMenu({ sleep, onSet }) {
  const { open, setOpen, ref } = usePopover();
  const countdown = useCountdown(sleep?.mode === 'time' ? sleep.endsAt : null);
  const label = sleep?.mode === 'song' ? 'End of song' : countdown;
  return (
    <div className="bar-menu" ref={ref}>
      <button
        className={`icon-btn pill-btn ${sleep ? 'is-on' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={sleep ? `Sleep timer: ${label}` : 'Sleep timer'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Moon size={17} />
        {sleep && <span className="pill-label tabular">{sleep.mode === 'song' ? 'Song' : countdown}</span>}
      </button>
      {open && (
        <div className="bar-pop" role="menu" aria-label="Sleep timer">
          <p className="label">Sleep timer</p>
          <p className="pop-note">Music fades out gently, then pauses.</p>
          <div className="sleep-grid">
            {SLEEP_OPTIONS.map((m) => (
              <button
                key={m}
                className="chip-btn"
                onClick={() => {
                  onSet({ mode: 'time', endsAt: Date.now() + m * 60000 });
                  setOpen(false);
                }}
              >
                {sleepLabel(m)}
              </button>
            ))}
            <button
              className={`chip-btn ${sleep?.mode === 'song' ? 'is-on' : ''}`}
              onClick={() => {
                onSet({ mode: 'song' });
                setOpen(false);
              }}
            >
              End of song
            </button>
          </div>
          {sleep && (
            <button
              className="btn btn-soft btn-sm pop-off"
              onClick={() => {
                onSet(null);
                setOpen(false);
              }}
            >
              Turn off · {label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const miniPlayerSupported = () => 'documentPictureInPicture' in window;

export function MiniPlayerButton({ open, onToggle, disabled }) {
  if (!miniPlayerSupported()) return null;
  return (
    <button
      className={`icon-btn hide-sm ${open ? 'is-on' : ''}`}
      onClick={onToggle}
      disabled={disabled}
      title={open ? 'Close mini player' : 'Mini player (floats over other apps)'}
    >
      <PictureInPicture2 size={18} />
    </button>
  );
}
