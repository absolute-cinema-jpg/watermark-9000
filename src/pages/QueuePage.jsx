import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, setState, getState, addSourcePaths, removeSources, updateOutputPreset, updateSettings, toast } from '../store.js';
import { Panel, Row, Select, TextInput, NumberField, Check, Toggle, useDropFiles } from '../ui/controls.jsx';
import { I } from '../ui/icons.jsx';
import { CODECS, CONTAINERS, RESOLUTIONS, AUDIO_MODES, SCALE_MODES, codecSummary, resolutionSummary, outputSize, estimateSizeMB } from '../lib/codecs.js';
import { fpsLabel, secondsToClock, framesToTC, tcToFrames, parseTC, canDropFrame } from '../lib/timecode.js';
import { makeOutputPreset, PRESET_COLORS, uid } from '../lib/defaults.js';
import { addJobs, startQueue, pauseQueue, stopQueue, cancelJob, retryJobs, removeJobs, clearFinished, moveJobs, queueStats, resolveOutputPath } from '../queue.js';
import { buildVars, TOKENS } from '../lib/tokens.js';
import { drawSourceFrame, drawWatermarkPreview, ffmpegPreview, imageFromUrl } from '../lib/preview.js';

export default function QueuePage() {
  return (
    <main className="page queue-page">
      <SourcesPanel />
      <ViewerPanel />
      <RenderPanel />
      <QueuePanel />
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Media pool

function useSelection(items, selected, setSelected) {
  const anchor = useRef(null);
  return (e, id) => {
    const ids = items.map((i) => i.id);
    if (e.shiftKey && anchor.current) {
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(ids.slice(lo, hi + 1));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      anchor.current = id;
    } else {
      setSelected([id]);
      anchor.current = id;
    }
  };
}

function SourcesPanel() {
  const sources = useStore((s) => s.sources);
  const selected = useStore((s) => s.selectedSources);
  const setSel = (ids) => setState({ selectedSources: ids });
  const onClick = useSelection(sources, selected, setSel);
  const [over, dropProps] = useDropFiles(addSourcePaths);
  const importFiles = async () => {
    const paths = await window.wm.openFiles();
    if (paths.length) addSourcePaths(paths);
  };
  const totalDur = sources.reduce((a, s) => a + (s.probe?.duration || 0), 0);

  return (
    <Panel
      className={`p-sources ${over ? 'dropzone-active' : ''}`}
      title="Media Pool"
      sub={sources.length ? `${sources.length} clip${sources.length === 1 ? '' : 's'} · ${secondsToClock(totalDur)}` : ''}
      actions={
        <>
          <button className="icon-btn" title="Import media (⌘I)" onClick={importFiles}>
            <I.import />
          </button>
          <button className="icon-btn" title="Remove selected (⌫)" disabled={!selected.length} onClick={() => removeSources(selected)}>
            <I.trash />
          </button>
        </>
      }
      bodyProps={{
        ...dropProps,
        tabIndex: 0,
        onKeyDown: (e) => {
          if ((e.key === 'Backspace' || e.key === 'Delete') && selected.length) removeSources(selected);
          if (e.key === 'a' && e.metaKey) {
            e.preventDefault();
            setSel(sources.map((s) => s.id));
          }
        },
        style: { outline: 'none' },
      }}
    >
      {sources.length === 0 ? (
        <div className="empty" onDoubleClick={importFiles}>
          <div>
            <I.film />
            <b>Drop reels, clips or folders here</b>
            Any codec, any resolution — MOV, MP4, MXF, MKV…
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={importFiles}>
                <I.import /> Import Media
              </button>
            </div>
          </div>
        </div>
      ) : (
        <table className="bin">
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '21%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Start TC</th>
              <th>Resolution</th>
              <th>FPS</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr
                key={s.id}
                className={selected.includes(s.id) ? 'sel' : ''}
                onMouseDown={(e) => onClick(e, s.id)}
                onDoubleClick={() => window.wm.reveal(s.path)}
                title={s.error ? s.error : s.path}
              >
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%' }}>
                    {s.status === 'probing' ? (
                      <span className="status encoding">
                        <I.loader />
                      </span>
                    ) : s.status === 'error' ? (
                      <span className="status failed">
                        <I.alert />
                      </span>
                    ) : (
                      <span className="dot" style={{ background: '#9b5cff', boxShadow: '0 0 6px #9b5cff' }} />
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                  </span>
                </td>
                <td className="mono dim">{s.probe?.timecode || '—'}</td>
                <td className="dim">{s.probe ? `${s.probe.width}×${s.probe.height}` : ''}</td>
                <td className="dim">{s.probe ? fpsLabel(s.probe.fps) : ''}</td>
                <td className="mono dim">{s.probe ? secondsToClock(s.probe.duration) : s.status === 'error' ? 'error' : '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Viewer: selected clip through the selected output preset (scale + watermark)

function ViewerPanel() {
  const sources = useStore((s) => s.sources);
  const selected = useStore((s) => s.selectedSources);
  const outputs = useStore((s) => s.outputPresets);
  const selectedOutputId = useStore((s) => s.selectedOutputId);
  const watermarks = useStore((s) => s.watermarks);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const src = sources.find((s) => s.id === selected[selected.length - 1]) || null;
  const preset = outputs.find((o) => o.id === selectedOutputId) || outputs[0];
  const wm = preset?.watermarkId ? watermarks.find((w) => w.id === preset.watermarkId) : null;
  const canvasRef = useRef();
  const [t, setT] = useState(0);
  const [frameUrl, setFrameUrl] = useState(null);
  const [exact, setExact] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setExact(null);
    if (!src?.probe) return setFrameUrl(null);
    setT(src.thumbT || 0);
    setFrameUrl(src.thumb || null);
  }, [src?.id, src?.thumb]);

  // fetch new frame when scrubbing (debounced)
  useEffect(() => {
    if (!src?.probe) return;
    setExact(null);
    const h = setTimeout(async () => {
      try {
        const url = await window.wm.thumb(src.path, t, 960);
        setFrameUrl(url);
      } catch {}
    }, 90);
    return () => clearTimeout(h);
  }, [t]);

  const size = preset ? outputSize(preset, src?.probe) : { w: 1920, h: 1080 };
  const frame = src?.probe ? Math.round(t * src.probe.fps.value) : 0;

  useEffect(() => {
    let dead = false;
    (async () => {
      const c = canvasRef.current;
      if (!c) return;
      const scale = Math.min(1, 1280 / size.w);
      const W = Math.round(size.w * scale);
      const H = Math.round(size.h * scale);
      const [img, exactImg] = await Promise.all([imageFromUrl(frameUrl), imageFromUrl(exact)]);
      if (dead) return;
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      if (exactImg) {
        ctx.drawImage(exactImg, 0, 0, W, H);
        return;
      }
      drawSourceFrame(ctx, img, W, H, preset?.scaleMode);
      if (!img) {
        ctx.fillStyle = '#1a1a1f';
        ctx.fillRect(0, 0, W, H);
      }
      const env = {
        vars: buildVars({ sourcePath: src?.path, probe: src?.probe, show: settings.show, recipient: preset?.recipient, presetName: preset?.name, outW: size.w, outH: size.h, settings: preset, user: info.user }),
        fps: src?.probe?.fps,
        sourceTC: src?.probe?.timecode,
        frame,
      };
      await drawWatermarkPreview(ctx, wm, W, H, env);
    })();
    return () => {
      dead = true;
    };
  }, [frameUrl, exact, preset, wm, size.w, size.h, src?.id, settings.show]);

  const renderExact = async () => {
    if (!src?.probe || !preset) return;
    setBusy(true);
    try {
      const env = {
        vars: buildVars({ sourcePath: src.path, probe: src.probe, show: settings.show, recipient: preset.recipient, presetName: preset.name, outW: size.w, outH: size.h, settings: preset, user: info.user }),
        fps: src.probe.fps,
        sourceTC: src.probe.timecode,
      };
      const url = await ffmpegPreview({ sourcePath: src.path, probe: src.probe, preset, watermark: wm, t, env, hwDecode: settings.hwDecode });
      setExact(url);
    } catch (e) {
      toast('Preview failed: ' + String(e.message || e).slice(0, 200), 'warn');
    }
    setBusy(false);
  };

  const p = src?.probe;
  const drop = p && canDropFrame(p.fps) && parseTC(p.timecode)?.drop;
  const curTC = p ? framesToTC(tcToFrames(p.timecode || '00:00:00:00', p.fps, drop) + frame, p.fps, drop) : '00:00:00:00';
  const pct = p ? (t / Math.max(0.001, p.duration)) * 100 : 0;

  return (
    <Panel
      className="p-viewer"
      title="Output Viewer"
      sub={src ? src.name : 'No clip selected'}
      actions={
        <>
          <span className="chip" title="Previewing through this output preset">
            <span className="dot" style={{ background: preset?.color }} />
            {preset?.name || '—'}
          </span>
          <span className="faint mono" style={{ fontSize: 10.5 }}>
            {size.w}×{size.h}
          </span>
        </>
      }
    >
      <div className="viewer" style={{ height: '100%' }}>
        <div className="viewer-stage">
          <canvas ref={canvasRef} />
          {exact && (
            <div className="stage-badge accent" style={{ cursor: 'pointer' }} onClick={() => setExact(null)} title="Back to live preview">
              <I.bolt style={{ width: 12, height: 12 }} /> ffmpeg render — exact output
            </div>
          )}
        </div>
        <div className="viewer-bar">
          <span className="tc-big">{curTC}</span>
          <input
            type="range"
            className="scrubber"
            min={0}
            max={p ? Math.max(0, p.duration - 1 / p.fps.value) : 1}
            step={p ? 1 / p.fps.value : 0.01}
            value={t}
            disabled={!p}
            style={{ '--pct': `${pct}%` }}
            onChange={(e) => setT(Number(e.target.value))}
          />
          <button className="btn" disabled={!p || busy} onClick={renderExact} title="Render this frame through ffmpeg with the exact export settings">
            {busy ? <I.loader /> : <I.bolt />} Render Frame
          </button>
        </div>
        {p && (
          <div className="meta-grid">
            <span>Codec</span>
            <span>
              {p.codec?.toUpperCase()} {p.profile ? `· ${p.profile}` : ''}
            </span>
            <span>Frame rate</span>
            <span>{fpsLabel(p.fps)} fps</span>
            <span>Source</span>
            <span>
              {p.width}×{p.height} {p.pixFmt ? `· ${p.pixFmt}` : ''}
            </span>
            <span>Audio</span>
            <span>{p.audio.length ? `${p.audio.length} track${p.audio.length > 1 ? 's' : ''} · ${p.audio.map((a) => a.channels).join('+')} ch` : 'none'}</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Render settings (output presets)

function RenderPanel() {
  const outputs = useStore((s) => s.outputPresets);
  const checked = useStore((s) => s.checkedOutputs);
  const selectedId = useStore((s) => s.selectedOutputId);
  const watermarks = useStore((s) => s.watermarks);
  const selectedSources = useStore((s) => s.selectedSources);
  const sources = useStore((s) => s.sources);
  const settings = useStore((s) => s.settings);
  const preset = outputs.find((o) => o.id === selectedId);

  const toggleCheck = (id, v) => setState((s) => ({ checkedOutputs: v ? [...s.checkedOutputs, id] : s.checkedOutputs.filter((x) => x !== id) }));
  const add = () => {
    const o = makeOutputPreset({ name: `Output ${outputs.length + 1}`, color: PRESET_COLORS[outputs.length % PRESET_COLORS.length], watermarkId: watermarks[0]?.id || null });
    setState((s) => ({ outputPresets: [...s.outputPresets, o], selectedOutputId: o.id }));
  };
  const dup = () => {
    if (!preset) return;
    const o = { ...structuredClone(preset), id: uid(), name: `${preset.name} copy` };
    setState((s) => ({ outputPresets: [...s.outputPresets, o], selectedOutputId: o.id }));
  };
  const del = () => {
    if (!preset || outputs.length <= 1) return;
    if (!confirm(`Delete output preset “${preset.name}”?`)) return;
    setState((s) => {
      const rest = s.outputPresets.filter((o) => o.id !== preset.id);
      return { outputPresets: rest, selectedOutputId: rest[0]?.id, checkedOutputs: s.checkedOutputs.filter((x) => x !== preset.id) };
    });
  };
  const readySel = sources.filter((s) => selectedSources.includes(s.id) && s.probe);
  const nJobs = readySel.length * checked.length;

  return (
    <Panel
      className="p-render"
      title="Render Settings"
      actions={
        <>
          <button className="icon-btn" title="New output preset" onClick={add}>
            <I.plus />
          </button>
          <button className="icon-btn" title="Duplicate preset" onClick={dup}>
            <I.copy />
          </button>
          <button className="icon-btn" title="Delete preset" onClick={del} disabled={outputs.length <= 1}>
            <I.trash />
          </button>
        </>
      }
      bodyProps={{ style: { display: 'flex', flexDirection: 'column' } }}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="section" style={{ padding: 0 }}>
          <div className="section-title" style={{ padding: '10px 12px 0', marginBottom: 4 }}>
            Output Presets <span className="grow" />
            <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              tick to render
            </span>
          </div>
          <div className="preset-list">
            {outputs.map((o) => {
              const w = watermarks.find((x) => x.id === o.watermarkId);
              return (
                <div key={o.id} className={`preset-item ${o.id === selectedId ? 'sel' : ''}`} onMouseDown={() => setState({ selectedOutputId: o.id })}>
                  <Check checked={checked.includes(o.id)} onChange={(v) => toggleCheck(o.id, v)} />
                  <span className="color-bar" style={{ background: o.color }} />
                  <div className="meta">
                    <div className="name">{o.name}</div>
                    <div className="desc">
                      {codecSummary(o)} · {resolutionSummary(o)} · {w ? w.name : 'No watermark'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {preset && <PresetEditor preset={preset} watermarks={watermarks} />}
      </div>

      <div className="add-bar">
        <div className="row" style={{ gridTemplateColumns: '70px 1fr', marginBottom: 0 }}>
          <label>Location</label>
          <div className="inline">
            {settings.destMode === 'source' ? (
              <span className="dim" style={{ flex: 1 }}>
                Next to each source file
              </span>
            ) : (
              <input className="input mono" style={{ flex: 1, fontSize: 11 }} value={settings.destination} readOnly title={settings.destination} />
            )}
            <button
              className="btn"
              onClick={async () => {
                const d = await window.wm.chooseFolder(settings.destination);
                if (d) updateSettings({ destination: d, destMode: 'folder' });
              }}
            >
              Browse
            </button>
          </div>
        </div>
        <div className="row" style={{ gridTemplateColumns: '70px 1fr', marginBottom: 0, minHeight: 20 }}>
          <span />
          <div className="inline">
            <Check checked={settings.destMode === 'source'} onChange={(v) => updateSettings({ destMode: v ? 'source' : 'folder' })}>
              <span className="dim">Render next to source files</span>
            </Check>
          </div>
        </div>
        <div className="summary">
          {nJobs ? (
            <>
              <b>{readySel.length}</b> clip{readySel.length === 1 ? '' : 's'} × <b>{checked.length}</b> output{checked.length === 1 ? '' : 's'} = <b>{nJobs}</b> job{nJobs === 1 ? '' : 's'}
            </>
          ) : !readySel.length ? (
            'Select clips in the Media Pool'
          ) : (
            'Tick the output presets to render'
          )}
        </div>
        <button className="btn primary big" disabled={!nJobs} onClick={() => addJobs(readySel.map((s) => s.id), checked)}>
          <I.plus /> Add to Render Queue
        </button>
      </div>
    </Panel>
  );
}

function PresetEditor({ preset, watermarks }) {
  const up = (patch) => updateOutputPreset(preset.id, patch);
  const codec = CODECS[preset.codec];
  const sources = useStore((s) => s.sources);
  const selectedSources = useStore((s) => s.selectedSources);
  const settings = useStore((s) => s.settings);
  const sample = sources.find((s) => s.id === selectedSources[0] && s.probe) || sources.find((s) => s.probe);

  const setCodec = (c) => {
    const def = CODECS[c];
    const patch = { codec: c };
    if (!def.containers.includes(preset.container)) patch.container = def.containers[0];
    if (def.profiles && !def.profiles.some((p) => p[0] === preset.profile)) patch.profile = def.defaultProfile;
    if (def.bitrate && !preset.bitrate) patch.bitrate = def.defaultBitrate;
    up(patch);
  };

  const resValue = preset.resolution === 'source' ? 'source' : RESOLUTIONS.some((r) => r[0] === `${preset.width}x${preset.height}`) && preset.resolution !== 'custom' ? `${preset.width}x${preset.height}` : 'custom';

  const samplePath = useMemo(() => {
    if (!sample) return null;
    const job = { sourcePath: sample.path, probe: sample.probe, preset };
    return resolveOutputPath(job);
  }, [sample, preset, settings.destination, settings.destMode, settings.show]);

  const size = outputSize(preset, sample?.probe);
  const est = sample ? estimateSizeMB(preset, sample.probe, size.w, size.h) : 0;

  return (
    <>
      <div className="section">
        <div className="section-title">Preset</div>
        <Row label="Name">
          <TextInput value={preset.name} onChange={(v) => up({ name: v })} />
        </Row>
        <Row label="Recipient" title="Used by the {recipient} token in watermarks, file names and folders">
          <TextInput value={preset.recipient} onChange={(v) => up({ recipient: v })} placeholder="e.g. SOUND, VFX, MUSIC" />
        </Row>
        <Row label="Colour">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => up({ color: c })}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: c,
                  boxShadow: preset.color === c ? `0 0 0 2px #0e0e11, 0 0 0 3.5px ${c}` : 'none',
                }}
              />
            ))}
          </div>
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Video</div>
        <Row label="Codec">
          <Select value={preset.codec} onChange={setCodec} options={Object.entries(CODECS).map(([k, v]) => [k, v.label])} />
        </Row>
        <Row label="Format">
          <Select value={preset.container} onChange={(v) => up({ container: v })} options={codec.containers.map((c) => [c, CONTAINERS[c]])} />
        </Row>
        {codec.profiles && (
          <Row label="Type">
            <Select value={preset.profile} onChange={(v) => up({ profile: v })} options={codec.profiles} />
          </Row>
        )}
        {codec.bitrate && (
          <Row label="Bit rate">
            <NumberField value={preset.bitrate} onChange={(v) => up({ bitrate: v })} min={0.5} max={400} step={0.5} precision={1} unit="Mb/s" label="⟷" />
          </Row>
        )}
        {codec.fixedSize ? (
          <Row label="Resolution">
            <span className="dim">1920 × 1080 (fixed for DNxHD)</span>
          </Row>
        ) : (
          <>
            <Row label="Resolution">
              <Select
                value={resValue}
                onChange={(v) => {
                  if (v === 'source') up({ resolution: 'source' });
                  else if (v === 'custom') up({ resolution: 'custom' });
                  else {
                    const [w, h] = v.split('x').map(Number);
                    up({ resolution: v, width: w, height: h });
                  }
                }}
                options={RESOLUTIONS}
              />
            </Row>
            {resValue === 'custom' && (
              <Row label="Size">
                <NumberField value={preset.width} onChange={(v) => up({ width: Math.round(v) })} min={64} max={8192} step={2} precision={0} label="W" />
                <NumberField value={preset.height} onChange={(v) => up({ height: Math.round(v) })} min={64} max={8192} step={2} precision={0} label="H" />
              </Row>
            )}
          </>
        )}
        {preset.resolution !== 'source' && (
          <Row label="Scaling">
            <Select value={preset.scaleMode} onChange={(v) => up({ scaleMode: v })} options={SCALE_MODES} />
          </Row>
        )}
        <Row label="">
          <Check checked={preset.deinterlace} onChange={(v) => up({ deinterlace: v })}>
            <span className="dim">Deinterlace interlaced sources</span>
          </Check>
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Audio</div>
        <Row label="Tracks">
          <Select value={preset.audio} onChange={(v) => up({ audio: v })} options={AUDIO_MODES} />
        </Row>
        {preset.container === 'mp4' && preset.audio === 'pcm_all' && <div className="hint" style={{ marginLeft: 106 }}>MP4 can’t hold PCM — tracks will be AAC.</div>}
        <Row label="">
          <Check checked={preset.keepTimecode !== false} onChange={(v) => up({ keepTimecode: v })}>
            <span className="dim">Carry source timecode track</span>
          </Check>
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Watermark</div>
        <Row label="Preset">
          <Select value={preset.watermarkId || ''} onChange={(v) => up({ watermarkId: v || null })} options={[['', 'None — clean'], ...watermarks.map((w) => [w.id, w.name])]} />
          <button
            className="icon-btn"
            title="Edit in Watermark page"
            disabled={!preset.watermarkId}
            onClick={() => setState({ page: 'watermark', selectedWatermarkId: preset.watermarkId, selectedElementId: null })}
          >
            <I.watermark />
          </button>
        </Row>
      </div>

      <div className="section">
        <div className="section-title">File</div>
        <Row label="File name">
          <TextInput mono value={preset.fileName} onChange={(v) => up({ fileName: v })} placeholder="{filename}_{recipient}" />
        </Row>
        <Row label="Subfolder">
          <TextInput mono value={preset.subfolder} onChange={(v) => up({ subfolder: v })} placeholder="optional, e.g. {recipient}/{date}" />
        </Row>
        <div className="token-row" style={{ marginLeft: 106 }}>
          {['{filename}', '{recipient}', '{show}', '{date}', '{preset}', '{resolution}'].map((t) => (
            <button key={t} onClick={() => up({ fileName: (preset.fileName || '') + (preset.fileName ? '_' : '') + t })} title={TOKENS.find((x) => x[0] === t)?.[1]}>
              {t}
            </button>
          ))}
        </div>
        {samplePath && (
          <div className="hint mono" style={{ marginTop: 10, wordBreak: 'break-all', fontSize: 10 }}>
            → {samplePath}
            {est > 0 && <span className="faint"> · ≈{est >= 1000 ? `${(est / 1000).toFixed(1)} GB` : `${Math.round(est)} MB`}</span>}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Queue

const STATUS = {
  queued: ['Queued', I.clock],
  preparing: ['Preparing', I.loader],
  encoding: ['Encoding', I.loader],
  done: ['Complete', I.checkCircle],
  failed: ['Failed', I.alert],
  cancelled: ['Cancelled', I.ban],
};

function clockTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function QueuePanel() {
  const jobs = useStore((s) => s.jobs);
  const running = useStore((s) => s.queueRunning);
  const startedAt = useStore((s) => s.queueStartedAt);
  const selected = useStore((s) => s.selectedJobs);
  const settings = useStore((s) => s.settings);
  const stats = queueStats(getState());
  const setSel = (ids) => setState({ selectedJobs: ids });
  const onClick = useSelection(jobs, selected, setSel);
  const [dragOver, setDragOver] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running && !stats.active) return;
    const h = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, [running, stats.active]);

  const elapsed = startedAt && (running || stats.active) ? (Date.now() - startedAt) / 1000 : null;
  const busy = running || stats.active > 0;

  const onKey = (e) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected.length) removeJobs(selected);
    if (e.key === 'a' && e.metaKey) {
      e.preventDefault();
      setSel(jobs.map((j) => j.id));
    }
  };

  return (
    <Panel
      className="p-queue"
      title="Render Queue"
      sub={jobs.length ? `${stats.done} of ${stats.total} complete${stats.failed ? ` · ${stats.failed} failed` : ''}` : ''}
      actions={
        <div className="qtoolbar">
          <span className="faint" style={{ fontSize: 11 }}>
            Parallel
          </span>
          <Select
            style={{ width: 56 }}
            value={String(settings.concurrency)}
            onChange={(v) => updateSettings({ concurrency: Number(v) })}
            options={[1, 2, 3, 4, 5, 6, 8].map((n) => [String(n), String(n)])}
          />
          <button className="btn ghost" onClick={clearFinished} disabled={!jobs.some((j) => ['done', 'failed', 'cancelled'].includes(j.status))}>
            Clear Finished
          </button>
          <button className="btn danger" onClick={stopQueue} disabled={!stats.active} title="Stop running jobs and return them to the queue">
            <I.stop /> Stop
          </button>
          {running ? (
            <button className="btn" onClick={pauseQueue} title="Finish running jobs, don't start new ones">
              <I.pause /> Pause
            </button>
          ) : (
            <button className="btn primary" onClick={startQueue} disabled={!stats.queued && !stats.active}>
              <I.play /> {stats.active ? 'Resume' : 'Start Queue'}
            </button>
          )}
        </div>
      }
      bodyProps={{ tabIndex: 0, onKeyDown: onKey, style: { outline: 'none', display: 'flex', flexDirection: 'column' } }}
    >
      <div className="qsummary">
        <div className="big-eta">
          <span className="l">{busy ? 'Queue ETA' : stats.queued ? 'Estimated' : 'Queue'}</span>
          <span className="v">{stats.eta == null ? (stats.queued ? '--:--' : '00:00') : secondsToClock(stats.eta)}</span>
        </div>
        <div className="overall">
          <div className="top">
            <span>
              {busy ? (
                <>
                  Rendering <b style={{ color: 'var(--text-hi)' }}>{stats.active}</b> in parallel · {stats.queued} waiting
                </>
              ) : stats.queued ? (
                `${stats.queued} job${stats.queued === 1 ? '' : 's'} ready`
              ) : jobs.length ? (
                'All done'
              ) : (
                'Queue is empty'
              )}
            </span>
            <span className="mono">{Math.round(stats.progress * 100)}%</span>
          </div>
          <div className={`pbar ${busy ? 'running' : stats.progress >= 1 ? 'done' : ''}`}>
            <div className="fill" style={{ width: `${stats.progress * 100}%` }} />
          </div>
        </div>
        <div className="stat">
          <span className="l">Speed</span>
          <span className="v">{stats.throughput ? `${stats.throughput.toFixed(1)}×` : '—'}</span>
        </div>
        <div className="stat">
          <span className="l">Elapsed</span>
          <span className="v">{elapsed != null ? secondsToClock(elapsed) : '—'}</span>
        </div>
        <div className="stat">
          <span className="l">Finishes</span>
          <span className="v">{busy && stats.eta ? clockTime(Date.now() + stats.eta * 1000) : '—'}</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {jobs.length === 0 ? (
          <div className="empty">
            <div>
              <I.queue />
              <b>Build your turnover queue</b>
              Select clips in the Media Pool, tick output presets, then Add to Render Queue.
              <br />
              Start it once and walk away — every job runs back to back.
            </div>
          </div>
        ) : (
          <table className="bin qtable">
            <colgroup>
              <col style={{ width: 30 }} />
              <col />
              <col style={{ width: '21%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Job</th>
                <th>Output Preset</th>
                <th>Progress</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <JobRow
                  key={j.id}
                  job={j}
                  index={i}
                  selected={selected.includes(j.id)}
                  dragOver={dragOver === j.id}
                  onMouseDown={(e) => onClick(e, j.id)}
                  onDragStart={(e) => {
                    const ids = selected.includes(j.id) ? selected : [j.id];
                    e.dataTransfer.setData('text/wm-jobs', JSON.stringify(ids));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('text/wm-jobs')) {
                      e.preventDefault();
                      setDragOver(j.id);
                    }
                  }}
                  onDragLeave={() => setDragOver((d) => (d === j.id ? null : d))}
                  onDrop={(e) => {
                    const ids = JSON.parse(e.dataTransfer.getData('text/wm-jobs') || '[]');
                    setDragOver(null);
                    if (ids.length && !ids.includes(j.id)) moveJobs(ids, j.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}

function JobRow({ job: j, index, selected, dragOver, ...handlers }) {
  const [label, Icon] = STATUS[j.status] || STATUS.queued;
  const active = j.status === 'encoding' || j.status === 'preparing';
  const size = outputSize(j.preset, j.probe);
  const fname = j.outputPath.split('/').pop();
  const pct = Math.round((j.progress || 0) * 100);
  return (
    <tr
      className={`${selected ? 'sel' : ''} ${dragOver ? 'drop-before' : ''}`}
      draggable
      {...handlers}
      onDoubleClick={() => (j.status === 'done' ? window.wm.open(j.outputPath) : window.wm.reveal(j.sourcePath))}
    >
      <td className="idx">{index + 1}</td>
      <td>
        <div className="jobname" title={`${j.sourcePath}\n→ ${j.outputPath}`}>
          <span className="a">{j.sourceName}</span>
          {j.status === 'failed' && j.error ? (
            <span className="err-line" title={j.error}>
              {j.error.split('\n').pop()}
            </span>
          ) : (
            <span className="b">
              → {fname} · {codecSummary(j.preset)} · {size.w}×{size.h}
              {j.watermark ? '' : ' · clean'}
            </span>
          )}
        </div>
      </td>
      <td>
        <span className="chip" style={{ background: `${j.preset.color}26`, color: j.preset.color }} title={j.watermark ? `Watermark: ${j.watermark.name}` : 'No watermark'}>
          <span className="dot" style={{ background: j.preset.color }} />
          {j.preset.name}
        </span>
      </td>
      <td className="pcell">
        <div className={`pbar thin ${j.status === 'preparing' ? 'preparing' : active ? 'running' : j.status}`}>
          <div className="fill" style={{ width: `${j.status === 'done' ? 100 : pct}%` }} />
        </div>
        <div className="pinfo">
          {active ? (
            <>
              <span className={`status ${j.status}`}>
                <Icon /> {j.status === 'preparing' ? 'Preparing overlays…' : `${pct}% · ${Math.round(j.fps || 0)} fps · ${(j.speed || 0).toFixed(1)}×`}
              </span>
              <span>{j.eta != null ? `ETA ${secondsToClock(j.eta)}` : ''}</span>
            </>
          ) : j.status === 'done' ? (
            <>
              <span className="status done">
                <Icon /> Done in {secondsToClock(j.elapsed || (j.finishedAt - j.startedAt) / 1000)}
              </span>
              <span>{j.bytes ? `${(j.bytes / 1e6).toFixed(0)} MB` : ''}</span>
            </>
          ) : (
            <>
              <span className={`status ${j.status}`}>
                <Icon /> {label}
              </span>
              <span>{secondsToClock(j.probe.duration)}</span>
            </>
          )}
        </div>
      </td>
      <td>
        <div className="actions">
          {active || j.status === 'queued' ? (
            <button className="icon-btn" title={active ? 'Cancel' : 'Skip'} onClick={() => cancelJob(j.id)}>
              <I.x />
            </button>
          ) : (
            <button className="icon-btn" title="Re-queue" onClick={() => retryJobs([j.id])}>
              <I.retry />
            </button>
          )}
          <button className="icon-btn" title="Reveal in Finder" onClick={() => window.wm.reveal(j.status === 'done' ? j.outputPath : j.outputPath)}>
            <I.reveal />
          </button>
          <button className="icon-btn" title="Remove from queue" onClick={() => removeJobs([j.id])}>
            <I.trash />
          </button>
        </div>
      </td>
    </tr>
  );
}
