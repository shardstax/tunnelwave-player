import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** useState that survives page reloads. */
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or storage full */
    }
  }, [key, value]);
  return [value, setValue];
}

export function useMediaQuery(query) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Re-renders when the engine's state (playing, loading, source...) changes. */
export function useEngineState(engine) {
  return useSyncExternalStore(
    (cb) => {
      engine.addEventListener('state', cb);
      return () => engine.removeEventListener('state', cb);
    },
    () => engine.state,
  );
}

/** Current time + duration; only components that show progress should use this. */
export function useEngineTime(engine) {
  const [t, setT] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    const update = () => setT({ time: engine.currentTime, duration: engine.duration });
    update();
    engine.addEventListener('time', update);
    engine.addEventListener('state', update);
    return () => {
      engine.removeEventListener('time', update);
      engine.removeEventListener('state', update);
    };
  }, [engine]);
  return t;
}

/** A stable function that always calls the latest version of `fn`. */
export function useEvent(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

/** Closes a popover when clicking outside of it or pressing Escape. */
export function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}
