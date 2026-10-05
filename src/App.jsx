import { useEffect } from 'react';
import { useStore, setState, getState, addSourcePaths, updateSettings } from './store.js';
import { queueStats } from './queue.js';
import { secondsToClock } from './lib/timecode.js';
import { I } from './ui/icons.jsx';
import { Modal, Row, TextInput, Select, Toggle } from './ui/controls.jsx';
import QueuePage from './pages/QueuePage.jsx';
import WatermarkPage from './pages/WatermarkPage.jsx';

export default function App() {
  const ready = useStore((s) => s.ready);
  const page = useStore((s) => s.page);
  const showSettings = useStore((s) => s.showSettings);
  const toastMsg = useStore((s) => s.toast);

  useEffect(() => {
    const k = (e) => {
      if (e.metaKey && e.key === '1') setState({ page: 'queue' });
      if (e.metaKey && e.key === '2') setState({ page: 'watermark' });
      if (e.metaKey && e.key === ',') setState({ showSettings: true });
      if (e.metaKey && e.key === 'i') {
        e.preventDefault();
        window.wm.openFiles().then((p) => p.length && addSourcePaths(p));
      }
    };
    window.addEventListener('keydown', k);
    // stop the window navigating to files dropped outside a drop zone
    const prevent = (e) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  if (!ready) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="app">
      <TopBar />
      {page === 'queue' ? <QueuePage /> : <WatermarkPage />}
      <Rail />
      {showSettings && <SettingsModal />}
      <EngineWarning />
      {toastMsg && (
        <div key={toastMsg.id} className={`toast ${toastMsg.kind}`}>
          {toastMsg.msg}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const page = useStore((s) => s.page);
  const jobs = useStore((s) => s.jobs);
  const running = useStore((s) => s.queueRunning);
  const show = useStore((s) => s.settings.show);
  const st = queueStats(getState());
  const busy = running || st.active > 0;
  return (
    <header className="topbar">
      <div className="logo">
        <span className="logo-mark">W</span>
        WATERMARK <span className="nine">9000</span>
      </div>
      <span className="page-title">{page === 'queue' ? 'Export Queue' : 'Watermark Presets'}</span>
      <span className="spacer" />
      {show && (
        <span className="faint" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
          {show}
        </span>
      )}
      <div className="top-status" title="Render queue">
        {busy ? (
          <>
            <span className="status encoding">
              <I.loader />
            </span>
            <span className="lbl">Rendering</span>
          </>
        ) : (
          <span className="lbl">{jobs.length ? `${st.queued} queued · ${st.done} done` : 'Idle'}</span>
        )}
        <div className="mini-bar">
          <div style={{ width: `${st.progress * 100}%` }} />
        </div>
        <span className="lbl">ETA</span>
        <span className="tc">{busy && st.eta != null ? secondsToClock(st.eta) : '--:--'}</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setState({ page: 'queue' })} title="Go to queue">
          <I.queue />
        </button>
      </div>
    </header>
  );
}

function Rail() {
  const page = useStore((s) => s.page);
  const jobs = useStore((s) => s.jobs);
  const remaining = jobs.filter((j) => ['queued', 'preparing', 'encoding'].includes(j.status)).length;
  return (
    <nav className="rail">
      <button className={page === 'queue' ? 'on' : ''} onClick={() => setState({ page: 'queue' })} title="Export Queue (⌘1)">
        <I.queue />
        QUEUE
        {remaining > 0 && <span className="badge">{remaining}</span>}
      </button>
      <button className={page === 'watermark' ? 'on' : ''} onClick={() => setState({ page: 'watermark' })} title="Watermark Presets (⌘2)">
        <I.watermark />
        WATERMARK
      </button>
      <span className="grow" />
      <button onClick={() => setState({ showSettings: true })} title="Settings (⌘,)">
        <I.settings />
        SETTINGS
      </button>
    </nav>
  );
}

function EngineWarning() {
  const info = useStore((s) => s.info);
  if (info.ffmpegVersion && info.ffprobe) return null;
  return (
    <div className="toast warn" style={{ bottom: 70 }}>
      The video engine (ffmpeg) couldn’t be found, so clips can’t be read or exported. Re-download the app, or install ffmpeg with Homebrew.
    </div>
  );
}

function SettingsModal() {
  const s = useStore((st) => st.settings);
  const info = useStore((st) => st.info);
  const close = () => setState({ showSettings: false });
  return (
    <Modal title="Settings" onClose={close} footer={<button className="btn primary" onClick={close}>Done</button>}>
      <div className="section">
        <div className="section-title">Project</div>
        <Row label="Show name" title="Available as {show} in watermarks and file names">
          <TextInput value={s.show} onChange={(v) => updateSettings({ show: v })} placeholder="e.g. THE LONG GOODBYE" />
        </Row>
      </div>
      <div className="section">
        <div className="section-title">Rendering</div>
        <Row label="Parallel jobs">
          <Select value={String(s.concurrency)} onChange={(v) => updateSettings({ concurrency: Number(v) })} options={[1, 2, 3, 4, 5, 6, 8].map((n) => [String(n), `${n} at a time`])} />
        </Row>
        <Row label="HW decode">
          <Toggle on={s.hwDecode} onChange={(v) => updateSettings({ hwDecode: v })} />
          <span className="hint">VideoToolbox decoding — usually slower than CPU decoding on Apple silicon, leave off</span>
        </Row>
        <Row label="x264 speed">
          <Select
            value={s.x264Preset}
            onChange={(v) => updateSettings({ x264Preset: v })}
            options={[
              ['ultrafast', 'Ultrafast — lowest quality per bit'],
              ['superfast', 'Superfast (default)'],
              ['veryfast', 'Veryfast — a little better, ~1.7× slower'],
              ['faster', 'Faster'],
              ['medium', 'Medium — best quality, slow'],
            ]}
          />
        </Row>
        <Row label="ProRes encoder">
          <Select
            value={s.proresEncoder}
            onChange={(v) => updateSettings({ proresEncoder: v })}
            options={[
              ['hardware', 'Apple silicon hardware (fastest)'],
              ['software', 'Software prores_ks'],
            ]}
          />
        </Row>
        <Row label="Existing files">
          <Select
            value={s.overwrite ? 'overwrite' : 'increment'}
            onChange={(v) => updateSettings({ overwrite: v === 'overwrite' })}
            options={[
              ['increment', 'Keep both — add _1, _2…'],
              ['overwrite', 'Overwrite'],
            ]}
          />
        </Row>
        <Row label="Notify">
          <Toggle on={s.notify} onChange={(v) => updateSettings({ notify: v })} />
          <span className="hint">macOS notification when the queue finishes</span>
        </Row>
      </div>
      <div className="section">
        <div className="section-title">System</div>
        <div className="hint mono" style={{ lineHeight: 1.7 }}>
          {info.ffmpegVersion || 'ffmpeg not found!'}
          <br />
          {info.ffmpeg}
          <br />
          {info.ffprobe}
          <br />
          {info.cpuModel} · {info.cpus} cores
        </div>
      </div>
    </Modal>
  );
}
