// Render queue engine: runs up to N ffmpeg jobs in parallel, tracks progress and ETA.
import { getState, setState, toast, updateSettings } from './store.js';
import { uid } from './lib/defaults.js';
import { buildVars, resolveTokens, sanitizeFileName } from './lib/tokens.js';
import { outputSize } from './lib/codecs.js';
import { renderOverlayLayers } from './lib/render.js';

const FINAL = ['done', 'failed', 'cancelled'];
const ACTIVE = ['preparing', 'encoding'];

function patchJob(id, patch) {
  setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)) }));
}

export function jobVars(job) {
  const s = getState();
  const { w, h } = outputSize(job.preset, job.probe);
  return buildVars({
    sourcePath: job.sourcePath,
    probe: job.probe,
    show: s.settings.show,
    recipient: job.preset.recipient,
    presetName: job.preset.name,
    outW: w,
    outH: h,
    settings: job.preset,
    user: s.info.user,
  });
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}

function dirname(p) {
  return p.slice(0, p.lastIndexOf('/')) || '/';
}

export function resolveOutputPath(job, taken) {
  const s = getState();
  const vars = jobVars(job);
  const ext = job.preset.container === 'mxf' ? 'mxf' : job.preset.container;
  const name = sanitizeFileName(resolveTokens(job.preset.fileName || '{filename}', vars)) || vars.filename;
  const sub = (job.preset.subfolder || '')
    .split('/')
    .map((p) => sanitizeFileName(resolveTokens(p, vars)).trim())
    .filter((p) => p && p !== 'output')
    .join('/');
  const root = s.settings.destMode === 'source' ? dirname(job.sourcePath) : s.settings.destination;
  let out = joinPath(root, sub, `${name}.${ext}`);
  if (taken) {
    let i = 2;
    const base = out.slice(0, -ext.length - 1);
    while (taken.has(out)) out = `${base}_${i++}.${ext}`;
    taken.add(out);
  }
  return out;
}

export function addJobs(sourceIds, outputIds) {
  const s = getState();
  const sources = s.sources.filter((x) => sourceIds.includes(x.id) && x.probe);
  const outputs = outputIds.map((id) => s.outputPresets.find((o) => o.id === id)).filter(Boolean);
  if (!sources.length) return toast('Select one or more sources in the media pool', 'warn');
  if (!outputs.length) return toast('Tick one or more output presets', 'warn');
  const taken = new Set(s.jobs.filter((j) => !FINAL.includes(j.status)).map((j) => j.outputPath));
  const jobs = [];
  // Group by output preset so the queue reads department by department.
  for (const o of outputs) {
    for (const src of sources) {
      const wm = o.watermarkId ? s.watermarks.find((w) => w.id === o.watermarkId) : null;
      const job = {
        id: uid(),
        sourceId: src.id,
        sourcePath: src.path,
        sourceName: src.name,
        probe: src.probe,
        preset: structuredClone(o),
        watermark: wm ? structuredClone(wm) : null,
        status: 'queued',
        progress: 0,
        createdAt: Date.now(),
      };
      job.outputPath = resolveOutputPath(job, taken);
      jobs.push(job);
    }
  }
  setState((st) => ({ jobs: [...st.jobs, ...jobs] }));
  toast(`Added ${jobs.length} job${jobs.length === 1 ? '' : 's'} to the render queue`);
  if (getState().queueRunning) pump();
}

// ---------------------------------------------------------------------------------------------

let pumping = false;

export function startQueue() {
  const s = getState();
  const pending = s.jobs.filter((j) => j.status === 'queued');
  if (!pending.length && !s.jobs.some((j) => ACTIVE.includes(j.status))) {
    toast('Nothing queued — add jobs first', 'warn');
    return;
  }
  setState({ queueRunning: true, queueStartedAt: s.queueStartedAt && s.jobs.some((j) => ACTIVE.includes(j.status)) ? s.queueStartedAt : Date.now(), queueDoneAt: null });
  pump();
}

export function pauseQueue() {
  setState({ queueRunning: false });
  toast('Queue paused — running jobs will finish, nothing new will start');
  reportState();
}

export async function stopQueue() {
  setState({ queueRunning: false });
  const active = getState().jobs.filter((j) => ACTIVE.includes(j.status));
  for (const j of active) {
    j.__stopping = true;
    stopping.add(j.id);
    await window.wm.cancel(j.id);
  }
  reportState();
}

const stopping = new Set();

export async function cancelJob(id) {
  const j = getState().jobs.find((x) => x.id === id);
  if (!j) return;
  if (ACTIVE.includes(j.status)) {
    await window.wm.cancel(id);
    patchJob(id, { status: 'cancelled', finishedAt: Date.now() });
  } else if (j.status === 'queued') patchJob(id, { status: 'cancelled' });
}

export function retryJobs(ids) {
  setState((s) => ({
    jobs: s.jobs.map((j) => (ids.includes(j.id) && ['failed', 'cancelled', 'done'].includes(j.status) ? { ...j, status: 'queued', progress: 0, error: null, eta: null, fps: 0, speed: 0, startedAt: null, finishedAt: null } : j)),
  }));
  if (getState().queueRunning) pump();
}

export function removeJobs(ids) {
  const set = new Set(ids);
  const s = getState();
  for (const j of s.jobs) if (set.has(j.id) && ACTIVE.includes(j.status)) window.wm.cancel(j.id);
  setState({ jobs: s.jobs.filter((j) => !set.has(j.id)), selectedJobs: s.selectedJobs.filter((id) => !set.has(id)) });
}

export function clearFinished() {
  setState((s) => ({ jobs: s.jobs.filter((j) => !FINAL.includes(j.status)) }));
}

export function moveJobs(ids, beforeId) {
  setState((s) => {
    const moving = s.jobs.filter((j) => ids.includes(j.id));
    const rest = s.jobs.filter((j) => !ids.includes(j.id));
    let idx = beforeId ? rest.findIndex((j) => j.id === beforeId) : rest.length;
    if (idx < 0) idx = rest.length;
    rest.splice(idx, 0, ...moving);
    return { jobs: rest };
  });
}

function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const s = getState();
    if (!s.queueRunning) return;
    const running = s.jobs.filter((j) => ACTIVE.includes(j.status)).length;
    const slots = Math.max(1, s.settings.concurrency || 2) - running;
    const next = s.jobs.filter((j) => j.status === 'queued').slice(0, Math.max(0, slots));
    for (const j of next) runJob(j.id);
    if (!running && !next.length) finishQueue();
  } finally {
    pumping = false;
    reportState();
  }
}

function finishQueue() {
  const s = getState();
  setState({ queueRunning: false, queueDoneAt: Date.now() });
  const done = s.jobs.filter((j) => j.status === 'done' && j.finishedAt >= (s.queueStartedAt || 0)).length;
  const failed = s.jobs.filter((j) => j.status === 'failed' && j.finishedAt >= (s.queueStartedAt || 0)).length;
  const took = s.queueStartedAt ? Math.round((Date.now() - s.queueStartedAt) / 1000) : 0;
  const mins = Math.floor(took / 60);
  const msg = `${done} export${done === 1 ? '' : 's'} finished${failed ? `, ${failed} failed` : ''} in ${mins ? `${mins}m ` : ''}${took % 60}s`;
  toast(msg, failed ? 'warn' : 'ok');
  if (s.settings.notify) window.wm.notify({ title: 'Watermark 9000 — Queue complete', body: msg });
}

async function runJob(id) {
  const s = getState();
  const job = s.jobs.find((j) => j.id === id);
  if (!job) return;
  patchJob(id, { status: 'preparing', progress: 0, startedAt: Date.now(), error: null, eta: null, fps: 0, speed: 0 });
  let result;
  try {
    const { w, h } = outputSize(job.preset, job.probe);
    let layers = [];
    if (job.watermark && job.watermark.elements?.length) {
      const env = { vars: jobVars(job), fps: job.probe.fps, sourceTC: job.probe.timecode };
      const r = await renderOverlayLayers(job.watermark, w, h, env);
      if (r.files.length) {
        const paths = await window.wm.writeOverlay(id, r.files);
        layers = r.layers.map((L) => ({ ...L, path: paths[L.file] }));
      }
    }
    if (stopping.has(id)) throw Object.assign(new Error('stopped'), { stopped: true });
    const st = getState().settings;
    // re-resolve destination at start (settings may have changed since queuing)
    const spec = {
      jobId: id,
      input: job.sourcePath,
      probe: job.probe,
      output: job.outputPath,
      overwrite: !!st.overwrite,
      settings: { ...job.preset, hwDecode: st.hwDecode, proresEncoder: st.proresEncoder, x264Preset: st.x264Preset },
      overlay: { layers },
    };
    patchJob(id, { status: 'encoding' });
    result = await window.wm.encode(spec);
  } catch (e) {
    result = { ok: false, error: e.stopped ? 'Cancelled' : String(e.message || e), cancelled: !!e.stopped };
  }
  window.wm.cleanOverlay(id);
  const wasStopped = stopping.delete(id);
  const now = Date.now();
  if (result.ok) {
    const cur = getState().jobs.find((j) => j.id === id);
    const elapsed = (now - (cur?.startedAt || now)) / 1000;
    patchJob(id, { status: 'done', progress: 1, finishedAt: now, outputPath: result.output, eta: 0, elapsed });
    // remember throughput for pre-run ETA estimates
    const sp = job.probe.duration / Math.max(0.5, elapsed);
    const prev = getState().settings.avgSpeed;
    updateSettings({ avgSpeed: prev ? prev * 0.7 + sp * 0.3 : sp });
  } else if (wasStopped) {
    patchJob(id, { status: 'queued', progress: 0, eta: null, fps: 0, speed: 0, startedAt: null });
  } else {
    const cur = getState().jobs.find((j) => j.id === id);
    if (cur && cur.status !== 'cancelled') patchJob(id, { status: result.cancelled ? 'cancelled' : 'failed', error: result.error, finishedAt: now });
  }
  pump();
}

// progress events from main
window.wm.onProgress((p) => {
  const j = getState().jobs.find((x) => x.id === p.jobId);
  if (!j || !ACTIVE.includes(j.status)) return;
  const dur = j.probe.duration || 0;
  const smooth = j.speed ? j.speed * 0.8 + p.speed * 0.2 : p.speed;
  const remaining = Math.max(0, dur - p.outSec);
  const eta = smooth > 0.01 ? remaining / smooth : null;
  patchJob(p.jobId, { progress: p.progress, fps: p.fps, speed: smooth, eta, frame: p.frame, outSec: p.outSec, bytes: p.size });
  reportStateThrottled();
});

// ---------------------------------------------------------------------------------------------
// Aggregate stats

export function queueStats(s = getState()) {
  const relevant = s.jobs.filter((j) => j.status !== 'cancelled');
  const active = s.jobs.filter((j) => ACTIVE.includes(j.status));
  const queued = s.jobs.filter((j) => j.status === 'queued');
  const done = s.jobs.filter((j) => j.status === 'done');
  const failed = s.jobs.filter((j) => j.status === 'failed');
  let totalDur = 0;
  let doneDur = 0;
  for (const j of relevant) {
    const d = j.probe?.duration || 0;
    if (j.status === 'failed') continue;
    totalDur += d;
    if (j.status === 'done') doneDur += d;
    else if (ACTIVE.includes(j.status)) doneDur += d * (j.progress || 0);
  }
  const remainingDur = totalDur - doneDur;
  // throughput: media seconds encoded per wall second across all running jobs
  let throughput = active.reduce((a, j) => a + (j.speed || 0), 0);
  const conc = Math.max(1, s.settings.concurrency || 2);
  if (active.length && active.length < conc && queued.length) throughput *= Math.min(conc, active.length + queued.length) / active.length;
  if (!throughput && s.settings.avgSpeed) throughput = s.settings.avgSpeed * Math.min(conc, queued.length + active.length || 1);
  const eta = throughput > 0 && remainingDur > 0 ? remainingDur / throughput : remainingDur > 0 ? null : 0;
  return {
    total: relevant.length,
    active: active.length,
    queued: queued.length,
    done: done.length,
    failed: failed.length,
    progress: totalDur ? doneDur / totalDur : 0,
    eta,
    throughput,
    remaining: queued.length + active.length,
  };
}

let lastReport = 0;
function reportStateThrottled() {
  const now = Date.now();
  if (now - lastReport < 1000) return;
  lastReport = now;
  reportState();
}

function reportState() {
  const s = getState();
  const st = queueStats(s);
  window.wm.queueState({ running: s.queueRunning || st.active > 0, progress: st.progress, remaining: st.remaining });
}
