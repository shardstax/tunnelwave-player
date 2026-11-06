import { useEffect, useRef, useState } from 'react';
import { Download, Monitor, Moon, RefreshCw, Sun, Upload, X } from 'lucide-react';
import { discoverInstances, testInstance } from '../lib/api';
import { ShortcutList } from './ShortcutsPopover';
import { MOD } from '../lib/shortcuts';

export default function Settings({ settings, onUpdate, source, onExport, onImport, onClose }) {
  const [inst, setInst] = useState(settings.customInstance);
  const [test, setTest] = useState(null);
  const [found, setFound] = useState(null);
  const fileRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const runTest = async () => {
    setTest({ status: 'loading' });
    try {
      await testInstance(inst);
      setTest({ status: 'ok' });
    } catch (e) {
      setTest({ status: 'error', message: e.name === 'AbortError' ? 'Timed out' : e.message });
    }
  };

  const discover = async () => {
    setFound({ status: 'loading' });
    try {
      const list = await discoverInstances();
      setFound({ status: 'ok', count: list.length });
    } catch {
      setFound({ status: 'error' });
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog" onCancel={onClose} onClick={(e) => e.target === dialogRef.current && onClose()}>
      <div className="dialog-body">
        <header className="panel-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <section className="setting">
          <h3>Theme</h3>
          <div className="segmented">
            {[
              ['system', 'System', Monitor],
              ['dark', 'Dark', Moon],
              ['light', 'Light', Sun],
            ].map(([key, label, Icon]) => (
              <button key={key} className={settings.theme === key ? 'is-on' : ''} onClick={() => onUpdate({ theme: key })}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting">
          <h3>Playback</h3>
          <label className="switch">
            <input type="checkbox" checked={settings.autoRadio} onChange={(e) => onUpdate({ autoRadio: e.target.checked })} />
            <span className="switch-track" />
            When the queue ends, keep playing suggested songs
          </label>
          <div className="setting-row">
            <span>Seek with ← / →</span>
            <div className="segmented">
              {[5, 10, 15, 30].map((n) => (
                <button key={n} className={settings.seekStep === n ? 'is-on' : ''} onClick={() => onUpdate({ seekStep: n })}>
                  {n}s
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>Volume with {MOD} + ↑ / ↓</span>
            <div className="segmented">
              {[2, 5, 10, 20].map((n) => (
                <button key={n} className={settings.volumeStep === n ? 'is-on' : ''} onClick={() => onUpdate({ volumeStep: n })}>
                  {n}%
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setting">
          <h3>Ad-free server</h3>
          <p className="muted small">
            Songs stream through public <a href="https://github.com/TeamPiped/Piped" target="_blank" rel="noreferrer">Piped</a> /{' '}
            <a href="https://invidious.io" target="_blank" rel="noreferrer">Invidious</a> servers. If one goes down the app tries the next
            automatically. {source && <>Now using <strong>{source.base.replace('https://', '')}</strong>.</>}
          </p>
          <div className="instance-form">
            <select value={inst.type} onChange={(e) => setInst({ ...inst, type: e.target.value })}>
              <option value="piped">Piped API</option>
              <option value="invidious">Invidious</option>
            </select>
            <input
              value={inst.base}
              onChange={(e) => {
                setInst({ ...inst, base: e.target.value });
                setTest(null);
              }}
              placeholder="https://your-instance.example (optional)"
            />
          </div>
          <div className="row gap-xs wrap">
            <button className="btn btn-soft btn-sm" disabled={!inst.base.trim() || test?.status === 'loading'} onClick={runTest}>
              Test
            </button>
            <button className="btn btn-accent btn-sm" onClick={() => onUpdate({ customInstance: inst })}>
              Save server
            </button>
            <button className="btn btn-ghost btn-sm" onClick={discover} disabled={found?.status === 'loading'}>
              <RefreshCw size={14} className={found?.status === 'loading' ? 'spin' : ''} /> Find more servers
            </button>
          </div>
          {test?.status === 'ok' && <p className="ok small">✓ Server works</p>}
          {test?.status === 'error' && <p className="err small">✗ {test.message}</p>}
          {found?.status === 'ok' && <p className="ok small">Found {found.count} public servers. They’ll be tried automatically.</p>}
          {found?.status === 'error' && <p className="err small">Couldn’t reach the server directories.</p>}
        </section>

        <section className="setting">
          <h3>Backup</h3>
          <p className="muted small">Your favourites, playlists and history live in this browser. Export them to keep a copy or move to another device.</p>
          <div className="row gap-xs">
            <button className="btn btn-soft btn-sm" onClick={onExport}>
              <Download size={15} /> Export
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => fileRef.current.click()}>
              <Upload size={15} /> Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section className="setting">
          <h3>Keyboard shortcuts</h3>
          <ShortcutList steps={settings} />
        </section>
      </div>
    </dialog>
  );
}
