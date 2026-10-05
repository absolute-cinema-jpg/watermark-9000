import { useSyncExternalStore, useRef } from 'react';
import { defaultWatermarks, defaultOutputPresets, DEFAULT_SETTINGS, uid } from './lib/defaults.js';

let state = {
  ready: false,
  info: {},
  page: 'queue',
  settings: { ...DEFAULT_SETTINGS },
  sources: [],
  selectedSources: [],
  outputPresets: [],
  checkedOutputs: [],
  selectedOutputId: null,
  watermarks: [],
  selectedWatermarkId: null,
  selectedElementId: null,
  referenceSourceId: null,
  jobs: [],
  selectedJobs: [],
  queueRunning: false,
  queueStartedAt: null,
  showSettings: false,
  toast: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  schedulePersist();
}

export function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore(selector = (s) => s) {
  const ref = useRef();
  return useSyncExternalStore(subscribe, () => {
    const v = selector(state);
    // cheap shallow memo for array/object selectors
    if (ref.current && shallowEqual(ref.current, v)) return ref.current;
    ref.current = v;
    return v;
  });
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Persistence

let persistTimer = null;
let lastSaved = {};

function schedulePersist() {
  if (!state.ready) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 400);
}

function persist() {
  const payload = {
    settings: state.settings,
    watermarks: state.watermarks,
    outputs: state.outputPresets,
    session: {
      sources: state.sources.filter((s) => s.probe).map(({ id, path, name, probe }) => ({ id, path, name, probe })),
      checkedOutputs: state.checkedOutputs,
      selectedOutputId: state.selectedOutputId,
      selectedWatermarkId: state.selectedWatermarkId,
      referenceSourceId: state.referenceSourceId,
      jobs: state.jobs.map((j) => {
        const { log, ...rest } = j;
        if (['encoding', 'preparing'].includes(j.status)) return { ...rest, status: 'queued', progress: 0, fps: 0, speed: 0, eta: null };
        return rest;
      }),
    },
  };
  for (const [k, v] of Object.entries(payload)) {
    if (lastSaved[k] === v) continue;
    lastSaved[k] = v;
    window.wm.save(k, v);
  }
}

export async function initStore() {
  const [info, settings, watermarks, outputs, session] = await Promise.all([
    window.wm.info(),
    window.wm.load('settings'),
    window.wm.load('watermarks'),
    window.wm.load('outputs'),
    window.wm.load('session'),
  ]);
  const wms = watermarks && watermarks.length ? watermarks : defaultWatermarks();
  const outs = outputs && outputs.length ? outputs : defaultOutputPresets(wms);
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!s.destination) s.destination = `${info.movies}/Watermark 9000`;
  if (!s.tuned2) Object.assign(s, { tuned2: true, hwDecode: false, x264Preset: 'superfast', concurrency: 2 });
  const sess = session || {};
  state = {
    ...state,
    info,
    settings: s,
    watermarks: wms,
    outputPresets: outs,
    selectedWatermarkId: sess.selectedWatermarkId && wms.some((w) => w.id === sess.selectedWatermarkId) ? sess.selectedWatermarkId : wms[0]?.id,
    selectedOutputId: sess.selectedOutputId && outs.some((o) => o.id === sess.selectedOutputId) ? sess.selectedOutputId : outs[0]?.id,
    checkedOutputs: (sess.checkedOutputs || []).filter((id) => outs.some((o) => o.id === id)),
    sources: (sess.sources || []).map((x) => ({ ...x, status: 'ready' })),
    referenceSourceId: sess.referenceSourceId || null,
    jobs: sess.jobs || [],
    ready: true,
  };
  listeners.forEach((l) => l());
  persist();
  // refresh thumbnails for restored sources
  for (const src of state.sources) loadThumb(src.id);
}

// ---------------------------------------------------------------------------------------------
// Sources

export async function addSourcePaths(paths) {
  const files = await window.wm.expandPaths(paths);
  const existing = new Set(state.sources.map((s) => s.path));
  const fresh = files.filter((p) => !existing.has(p));
  if (!fresh.length) {
    if (files.length) toast('Those files are already in the media pool');
    return;
  }
  const items = fresh.map((p) => ({ id: uid(), path: p, name: p.split('/').pop(), status: 'probing', probe: null, thumb: null }));
  setState((s) => ({ sources: [...s.sources, ...items], selectedSources: s.selectedSources.length ? s.selectedSources : [items[0].id] }));
  await Promise.all(
    items.map(async (it) => {
      try {
        const probe = await window.wm.probe(it.path);
        if (!probe.hasVideo) throw new Error('No video stream');
        updateSource(it.id, { probe, status: 'ready' });
        loadThumb(it.id);
      } catch (e) {
        updateSource(it.id, { status: 'error', error: String(e.message || e).split('\n').pop() });
      }
    })
  );
}

export function updateSource(id, patch) {
  setState((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

async function loadThumb(id) {
  const src = state.sources.find((s) => s.id === id);
  if (!src || !src.probe) return;
  try {
    const t = Math.min(src.probe.duration * 0.25, 5);
    const thumb = await window.wm.thumb(src.path, t, 640);
    updateSource(id, { thumb, thumbT: t });
  } catch (e) {
    updateSource(id, { thumb: null });
  }
}

export function removeSources(ids) {
  const set = new Set(ids);
  setState((s) => ({ sources: s.sources.filter((x) => !set.has(x.id)), selectedSources: s.selectedSources.filter((x) => !set.has(x)) }));
}

// ---------------------------------------------------------------------------------------------
// Presets

export function updateOutputPreset(id, patch) {
  setState((s) => ({ outputPresets: s.outputPresets.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
}

export function updateWatermark(id, patch) {
  setState((s) => ({ watermarks: s.watermarks.map((w) => (w.id === id ? { ...w, ...(typeof patch === 'function' ? patch(w) : patch) } : w)) }));
}

export function updateElement(wmId, elId, patch) {
  updateWatermark(wmId, (w) => ({
    elements: w.elements.map((e) => (e.id === elId ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e)),
  }));
}

export function updateSettings(patch) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

let toastTimer = null;
export function toast(msg, kind = 'info') {
  clearTimeout(toastTimer);
  setState({ toast: { msg, kind, id: uid() } });
  toastTimer = setTimeout(() => setState({ toast: null }), 3200);
}
