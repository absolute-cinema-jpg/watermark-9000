import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, setState, getState, updateWatermark, updateElement, toast } from '../store.js';
import { Panel, Row, Select, TextInput, NumberField, Slider, Toggle, Seg, ColorField, Dial } from '../ui/controls.jsx';
import { FontPicker } from '../ui/FontPicker.jsx';
import { I } from '../ui/icons.jsx';
import { makeElement, uid } from '../lib/defaults.js';
import { TOKENS, buildVars } from '../lib/tokens.js';
import { outputSize } from '../lib/codecs.js';
import { ensureFonts, primeImages, renderPreview, loadImage } from '../lib/render.js';
import { drawSourceFrame, drawPlaceholder, ffmpegPreview, imageFromUrl } from '../lib/preview.js';
import { framesToTC, tcToFrames, parseTC, canDropFrame, fpsLabel } from '../lib/timecode.js';

const TYPE_ICON = { text: I.text, timecode: I.tc, counter: I.counter, image: I.image };

function useCurrent() {
  const watermarks = useStore((s) => s.watermarks);
  const selectedId = useStore((s) => s.selectedWatermarkId);
  const elId = useStore((s) => s.selectedElementId);
  const wm = watermarks.find((w) => w.id === selectedId) || watermarks[0];
  const el = wm?.elements.find((e) => e.id === elId) || null;
  return { watermarks, wm, el };
}

export default function WatermarkPage() {
  return (
    <main className="page wm-page">
      <PresetsPanel />
      <LayersPanel />
      <StagePanel />
      <InspectorPanel />
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

function PresetsPanel() {
  const { watermarks, wm } = useCurrent();
  const outputs = useStore((s) => s.outputPresets);
  const [renaming, setRenaming] = useState(null);

  const add = () => {
    const w = { id: uid(), name: `Watermark ${watermarks.length + 1}`, elements: [makeElement('timecode')] };
    setState((s) => ({ watermarks: [...s.watermarks, w], selectedWatermarkId: w.id, selectedElementId: null }));
    setRenaming(w.id);
  };
  const dup = () => {
    if (!wm) return;
    const w = { ...structuredClone(wm), id: uid(), name: `${wm.name} copy` };
    w.elements = w.elements.map((e) => ({ ...e, id: uid() }));
    setState((s) => ({ watermarks: [...s.watermarks, w], selectedWatermarkId: w.id, selectedElementId: null }));
  };
  const del = () => {
    if (!wm || watermarks.length <= 1) return;
    const users = outputs.filter((o) => o.watermarkId === wm.id);
    if (!confirm(`Delete watermark “${wm.name}”?${users.length ? `\n\nUsed by: ${users.map((u) => u.name).join(', ')} (they will render clean).` : ''}`)) return;
    setState((s) => {
      const rest = s.watermarks.filter((w) => w.id !== wm.id);
      return {
        watermarks: rest,
        selectedWatermarkId: rest[0]?.id,
        selectedElementId: null,
        outputPresets: s.outputPresets.map((o) => (o.watermarkId === wm.id ? { ...o, watermarkId: null } : o)),
      };
    });
  };
  const exportPreset = async () => {
    if (!wm) return;
    // embed images so the preset travels between machines
    const copy = structuredClone(wm);
    for (const e of copy.elements) if (e.type === 'image' && e.src) e.src = await window.wm.readAsset(e.src);
    const ok = await window.wm.exportJson({ name: `${wm.name}.wm9.json`, data: { watermark9000: 1, preset: copy } });
    if (ok) toast(`Exported “${wm.name}”`);
  };
  const importPreset = async () => {
    const data = await window.wm.importJson();
    const p = data?.preset;
    if (!p?.elements) return data && toast('Not a Watermark 9000 preset', 'warn');
    p.id = uid();
    p.elements = p.elements.map((e) => ({ ...e, id: uid() }));
    setState((s) => ({ watermarks: [...s.watermarks, p], selectedWatermarkId: p.id, selectedElementId: null }));
    toast(`Imported “${p.name}”`);
  };

  return (
    <Panel
      className="p-presets"
      title="Watermark Presets"
      actions={
        <>
          <button className="icon-btn" title="New preset" onClick={add}>
            <I.plus />
          </button>
          <button className="icon-btn" title="Duplicate" onClick={dup}>
            <I.copy />
          </button>
          <button className="icon-btn" title="Import preset…" onClick={importPreset}>
            <I.import />
          </button>
          <button className="icon-btn" title="Export preset…" onClick={exportPreset}>
            <I.export />
          </button>
          <button className="icon-btn" title="Delete" onClick={del} disabled={watermarks.length <= 1}>
            <I.trash />
          </button>
        </>
      }
    >
      <div className="preset-list">
        {watermarks.map((w) => {
          const users = outputs.filter((o) => o.watermarkId === w.id);
          return (
            <div
              key={w.id}
              className={`preset-item ${w.id === wm?.id ? 'sel' : ''}`}
              onMouseDown={() => w.id !== wm?.id && setState({ selectedWatermarkId: w.id, selectedElementId: null })}
              onDoubleClick={() => setRenaming(w.id)}
            >
              <span className="ico" style={{ color: 'var(--accent-hi)', display: 'grid' }}>
                <I.watermark style={{ width: 16, height: 16 }} />
              </span>
              <div className="meta">
                {renaming === w.id ? (
                  <input
                    className="input"
                    autoFocus
                    defaultValue={w.name}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      updateWatermark(w.id, { name: e.target.value.trim() || w.name });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <div className="name">{w.name}</div>
                )}
                <div className="desc">
                  {w.elements.length} layer{w.elements.length === 1 ? '' : 's'}
                  {users.length ? ` · ${users.map((u) => u.recipient || u.name).join(', ')}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function elementLabel(e) {
  if (e.type === 'text') return (e.text || '').split('\n')[0] || '(empty)';
  if (e.type === 'timecode') return `${e.prefix || ''}${e.tcSource === 'custom' ? e.tcStart : e.tcSource === 'zero' ? '00:00:00:00' : 'source TC'}`;
  if (e.type === 'counter') return `${e.prefix || ''}${String(e.counterStart || 0).padStart(e.counterDigits || 6, '0')}`;
  if (e.type === 'image') return e.src ? e.src.split('/').pop() : 'no image';
  return '';
}

export async function addElement(type) {
  const { selectedWatermarkId } = getState();
  let el = makeElement(type);
  if (type === 'image') {
    const p = await window.wm.openImage();
    if (!p) return;
    const src = await window.wm.importAsset(p);
    const img = await loadImage(src);
    el = { ...el, src, aspect: img ? img.naturalHeight / img.naturalWidth : 1, name: p.split('/').pop().replace(/\.[^.]+$/, '') };
  }
  updateWatermark(selectedWatermarkId, (w) => ({ elements: [...w.elements, el] }));
  setState({ selectedElementId: el.id });
}

function LayersPanel() {
  const { wm, el: selEl } = useCurrent();
  const [dragOver, setDragOver] = useState(null);
  if (!wm) return <Panel className="p-layers" title="Layers" />;
  const list = [...wm.elements].reverse(); // top of the list = front-most
  const move = (id, dir) =>
    updateWatermark(wm.id, (w) => {
      const els = [...w.elements];
      const i = els.findIndex((e) => e.id === id);
      const j = i + dir;
      if (j < 0 || j >= els.length) return {};
      [els[i], els[j]] = [els[j], els[i]];
      return { elements: els };
    });
  const remove = (id) => {
    updateWatermark(wm.id, (w) => ({ elements: w.elements.filter((e) => e.id !== id) }));
    setState({ selectedElementId: null });
  };
  return (
    <Panel
      className="p-layers"
      title="Layers"
      sub={`${wm.elements.length}`}
      actions={
        <>
          <button className="icon-btn" title="Bring forward" disabled={!selEl} onClick={() => move(selEl.id, 1)}>
            <I.up />
          </button>
          <button className="icon-btn" title="Send backward" disabled={!selEl} onClick={() => move(selEl.id, -1)}>
            <I.down />
          </button>
          <button className="icon-btn" title="Delete layer (⌫)" disabled={!selEl} onClick={() => remove(selEl.id)}>
            <I.trash />
          </button>
        </>
      }
    >
      <div className="add-grid">
        <button onClick={() => addElement('text')} title="Free text — supports tokens like {filename}">
          <I.text /> Text
        </button>
        <button onClick={() => addElement('timecode')} title="Running timecode burn-in">
          <I.tc /> Timecode
        </button>
        <button onClick={() => addElement('filename')} title="Source file name">
          <I.file /> Filename
        </button>
        <button onClick={() => addElement('counter')} title="Running frame counter">
          <I.counter /> Frames
        </button>
        <button onClick={() => addElement('image')} title="Logo / bug image (PNG with alpha, JPG, SVG)">
          <I.image /> Image
        </button>
      </div>
      <div className="preset-list">
        {list.map((e) => {
          const Icon = e.type === 'text' && e.text === '{filename}' ? I.file : TYPE_ICON[e.type];
          return (
            <div
              key={e.id}
              className={`layer-item ${e.id === selEl?.id ? 'sel' : ''} ${e.visible === false ? 'hidden' : ''} ${dragOver === e.id ? 'drag-over' : ''}`}
              onMouseDown={() => setState({ selectedElementId: e.id })}
              draggable
              onDragStart={(ev) => ev.dataTransfer.setData('text/wm-layer', e.id)}
              onDragOver={(ev) => {
                if (ev.dataTransfer.types.includes('text/wm-layer')) {
                  ev.preventDefault();
                  setDragOver(e.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(ev) => {
                const id = ev.dataTransfer.getData('text/wm-layer');
                setDragOver(null);
                if (!id || id === e.id) return;
                updateWatermark(wm.id, (w) => {
                  const els = w.elements.filter((x) => x.id !== id);
                  const moving = w.elements.find((x) => x.id === id);
                  const idx = els.findIndex((x) => x.id === e.id);
                  els.splice(idx + 1, 0, moving); // dropping onto a row places it just in front of it
                  return { elements: els };
                });
              }}
            >
              <span className="ico">
                <Icon />
              </span>
              <span className="nm">
                {e.name}
                <small>{elementLabel(e)}</small>
              </span>
              <button
                className="icon-btn"
                title={e.visible === false ? 'Show' : 'Hide'}
                onMouseDown={(ev) => ev.stopPropagation()}
                onClick={() => updateElement(wm.id, e.id, { visible: e.visible === false })}
              >
                {e.visible === false ? <I.eyeOff /> : <I.eye />}
              </button>
            </div>
          );
        })}
        {!list.length && (
          <div className="hint" style={{ padding: 16, textAlign: 'center' }}>
            Add text, timecode, file name, frame counter or image layers above.
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Stage

const SNAP_X = [0.5, 0.05, 0.95, 0.1, 0.9];
const SNAP_Y = [0.5, 0.05, 0.95, 0.1, 0.9];

function StagePanel() {
  const { wm, el: selEl } = useCurrent();
  const sources = useStore((s) => s.sources);
  const outputs = useStore((s) => s.outputPresets);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const refId = useStore((s) => s.referenceSourceId);
  const [previewAsId, setPreviewAsId] = useState(null);
  const [guides, setGuides] = useState(true);
  const [frameUrl, setFrameUrl] = useState(null);
  const [exact, setExact] = useState(null);
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playFrame, setPlayFrame] = useState(0);
  const [fontsReady, setFontsReady] = useState(0);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const wrapRef = useRef();
  const canvasRef = useRef();
  const layoutsRef = useRef([]);
  const snapRef = useRef({ x: null, y: null });
  const dragRef = useRef(null);

  const ref = sources.find((s) => s.id === refId && s.probe) || null;
  const users = outputs.filter((o) => o.watermarkId === wm?.id);
  const previewAs = outputs.find((o) => o.id === previewAsId) || users[0] || outputs[0];
  const size = previewAs ? outputSize(previewAs, ref?.probe || { width: 1920, height: 1080, sar: '1:1' }) : { w: 1920, h: 1080 };
  const fps = ref?.probe?.fps || { num: 24000, den: 1001, value: 24000 / 1001 };
  const frame = Math.round(t * fps.value) + playFrame;

  // start the reference at its poster frame rather than frame 0 (often black / slate)
  useEffect(() => {
    setPlayFrame(0);
    setT(ref?.thumbT || 0);
  }, [ref?.id]);

  // container size
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // reference frame
  useEffect(() => {
    setExact(null);
    if (!ref) return setFrameUrl(null);
    const h = setTimeout(async () => {
      try {
        setFrameUrl(await window.wm.thumb(ref.path, t, 1280));
      } catch {}
    }, 80);
    return () => clearTimeout(h);
  }, [ref?.id, t]);

  // fonts / images
  useEffect(() => {
    if (!wm) return;
    let dead = false;
    Promise.all([ensureFonts(wm, 1080), primeImages(wm)]).then(() => !dead && setFontsReady((x) => x + 1));
    return () => {
      dead = true;
    };
  }, [wm]);

  // play: tick the frame counter at clip rate over the still frame, so running timecode can be judged
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const base = playFrame;
    let raf;
    const loop = () => {
      setPlayFrame(base + Math.floor(((performance.now() - start) / 1000) * fps.value));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const dpr = window.devicePixelRatio || 1;
  const aspect = size.w / size.h;
  const pad = 24;
  let dispW = Math.max(100, box.w - pad * 2);
  let dispH = dispW / aspect;
  if (dispH > box.h - pad * 2) {
    dispH = Math.max(60, box.h - pad * 2);
    dispW = dispH * aspect;
  }
  const W = Math.round(dispW * dpr);
  const H = Math.round(dispH * dpr);

  const env = useMemo(
    () => ({
      vars: buildVars({
        sourcePath: ref?.path,
        probe: ref?.probe,
        show: settings.show,
        recipient: previewAs?.recipient || 'SOUND',
        presetName: previewAs?.name,
        outW: size.w,
        outH: size.h,
        settings: previewAs,
        user: info.user,
      }),
      fps,
      sourceTC: ref?.probe?.timecode || '01:00:00:00',
      frame,
    }),
    [ref?.id, previewAs, settings.show, size.w, size.h, frame]
  );

  const [bgImg, setBgImg] = useState(null);
  useEffect(() => {
    let dead = false;
    imageFromUrl(exact || frameUrl).then((i) => !dead && setBgImg(i));
    return () => {
      dead = true;
    };
  }, [frameUrl, exact]);

  // draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !wm) return;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (exact && bgImg) {
      ctx.drawImage(bgImg, 0, 0, W, H);
      layoutsRef.current = [];
    } else {
      if (bgImg) drawSourceFrame(ctx, bgImg, W, H, previewAs?.scaleMode);
      else drawPlaceholder(ctx, W, H);
      layoutsRef.current = renderPreview(ctx, wm, W, H, env);
    }
    if (guides) drawGuides(ctx, W, H, dpr);
    // snap guides
    const sn = snapRef.current;
    ctx.save();
    ctx.strokeStyle = '#ff4fd8';
    ctx.lineWidth = dpr;
    ctx.setLineDash([]);
    if (sn.x != null) {
      ctx.beginPath();
      ctx.moveTo(sn.x * W, 0);
      ctx.lineTo(sn.x * W, H);
      ctx.stroke();
    }
    if (sn.y != null) {
      ctx.beginPath();
      ctx.moveTo(0, sn.y * H);
      ctx.lineTo(W, sn.y * H);
      ctx.stroke();
    }
    ctx.restore();
    // selection
    if (!exact && selEl) {
      const i = wm.elements.findIndex((e) => e.id === selEl.id);
      const L = layoutsRef.current[i];
      if (L) drawSelection(ctx, L, dpr);
    }
  });

  // ------------------------------------------------------------- interaction
  const toCanvas = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const toLocal = (L, p) => {
    const dx = p.x - L.ax;
    const dy = p.y - L.ay;
    const c = Math.cos(-L.rot);
    const s = Math.sin(-L.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };
  const handles = (L) => {
    const { x, y, w, h } = L.rect;
    const m = 6 * dpr;
    const corners = [
      [x - m, y - m],
      [x + w + m, y - m],
      [x + w + m, y + h + m],
      [x - m, y + h + m],
    ];
    const far = corners.reduce((a, b) => (Math.hypot(...b) > Math.hypot(...a) ? b : a));
    return { rot: [x + w / 2, y - m - 26 * dpr], scale: far };
  };

  const onMouseDown = (e) => {
    if (!wm || exact) return;
    const p = toCanvas(e);
    const layouts = layoutsRef.current;
    // handles of the selected element first
    if (selEl) {
      const i = wm.elements.findIndex((x) => x.id === selEl.id);
      const L = layouts[i];
      if (L) {
        const lp = toLocal(L, p);
        const hd = handles(L);
        const near = (pt) => Math.hypot(lp.x - pt[0], lp.y - pt[1]) < 9 * dpr;
        if (near(hd.rot)) return beginDrag(e, { kind: 'rotate', el: selEl, L });
        if (near(hd.scale)) return beginDrag(e, { kind: 'scale', el: selEl, L, startDist: Math.hypot(...hd.scale), start: selEl.type === 'image' ? selEl.width : selEl.size });
      }
    }
    for (let i = layouts.length - 1; i >= 0; i--) {
      const L = layouts[i];
      if (!L) continue;
      const lp = toLocal(L, p);
      const m = 4 * dpr;
      if (lp.x >= L.rect.x - m && lp.x <= L.rect.x + L.rect.w + m && lp.y >= L.rect.y - m && lp.y <= L.rect.y + L.rect.h + m) {
        const el = wm.elements[i];
        setState({ selectedElementId: el.id });
        return beginDrag(e, { kind: 'move', el, start: p, x0: el.x, y0: el.y });
      }
    }
    setState({ selectedElementId: null });
  };

  const beginDrag = (e, d) => {
    e.preventDefault();
    dragRef.current = d;
    const move = (ev) => {
      const D = dragRef.current;
      const p = toCanvas(ev);
      const W = canvasRef.current.width;
      const H = canvasRef.current.height;
      if (D.kind === 'move') {
        let nx = D.x0 + (p.x - D.start.x) / W;
        let ny = D.y0 + (p.y - D.start.y) / H;
        if (ev.shiftKey) {
          if (Math.abs(p.x - D.start.x) > Math.abs(p.y - D.start.y)) ny = D.y0;
          else nx = D.x0;
        }
        const tol = 7 * dpr;
        let sx = null;
        let sy = null;
        if (!ev.altKey) {
          for (const s of SNAP_X)
            if (Math.abs(nx - s) * W < tol) {
              nx = s;
              sx = s;
              break;
            }
          for (const s of SNAP_Y)
            if (Math.abs(ny - s) * H < tol) {
              ny = s;
              sy = s;
              break;
            }
        }
        snapRef.current = { x: sx, y: sy };
        updateElement(wm.id, D.el.id, { x: round4(nx), y: round4(ny) });
      } else if (D.kind === 'rotate') {
        let a = (Math.atan2(p.y - D.L.ay, p.x - D.L.ax) * 180) / Math.PI + 90;
        if (a > 180) a -= 360;
        a = ev.shiftKey ? Math.round(a / 15) * 15 : Math.round(a * 10) / 10;
        updateElement(wm.id, D.el.id, { rotation: a });
      } else if (D.kind === 'scale') {
        const lp = toLocal(D.L, p);
        const ratio = Math.max(0.05, Math.hypot(lp.x, lp.y) / Math.max(1, D.startDist));
        const v = Math.round(D.start * ratio * 100) / 100;
        updateElement(wm.id, D.el.id, D.el.type === 'image' ? { width: Math.max(0.5, Math.min(200, v)) } : { size: Math.max(0.3, Math.min(60, v)) });
      }
    };
    const up = () => {
      dragRef.current = null;
      snapRef.current = { x: null, y: null };
      setFontsReady((x) => x + 1);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const [hoverCursor, setHoverCursor] = useState('default');
  const onHover = (e) => {
    if (dragRef.current || !wm || exact) return;
    const p = toCanvas(e);
    let cur = 'default';
    if (selEl) {
      const i = wm.elements.findIndex((x) => x.id === selEl.id);
      const L = layoutsRef.current[i];
      if (L) {
        const lp = toLocal(L, p);
        const hd = handles(L);
        if (Math.hypot(lp.x - hd.rot[0], lp.y - hd.rot[1]) < 9 * dpr) cur = 'grab';
        else if (Math.hypot(lp.x - hd.scale[0], lp.y - hd.scale[1]) < 9 * dpr) cur = 'nwse-resize';
      }
    }
    if (cur === 'default') {
      for (const L of layoutsRef.current) {
        if (!L) continue;
        const lp = toLocal(L, p);
        if (lp.x >= L.rect.x && lp.x <= L.rect.x + L.rect.w && lp.y >= L.rect.y && lp.y <= L.rect.y + L.rect.h) cur = 'move';
      }
    }
    if (cur !== hoverCursor) setHoverCursor(cur);
  };

  // keyboard: nudge / delete / duplicate
  useEffect(() => {
    const k = (e) => {
      if (getState().page !== 'watermark') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const s = getState();
      const w = s.watermarks.find((x) => x.id === s.selectedWatermarkId);
      const el = w?.elements.find((x) => x.id === s.selectedElementId);
      if (!el) return;
      const step = (e.shiftKey ? 10 : 1) / 1000;
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (nudge) {
        e.preventDefault();
        updateElement(w.id, el.id, { x: round4(el.x + nudge[0]), y: round4(el.y + nudge[1]) });
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        updateWatermark(w.id, (ww) => ({ elements: ww.elements.filter((x) => x.id !== el.id) }));
        setState({ selectedElementId: null });
      } else if (e.key === 'd' && e.metaKey) {
        e.preventDefault();
        const copy = { ...structuredClone(el), id: uid(), name: `${el.name} copy`, y: Math.min(0.98, el.y + 0.04) };
        updateWatermark(w.id, (ww) => ({ elements: [...ww.elements, copy] }));
        setState({ selectedElementId: copy.id });
      } else if (e.key === 'Escape') setState({ selectedElementId: null });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const renderExact = async () => {
    if (!ref || !previewAs) return;
    setBusy(true);
    try {
      const url = await ffmpegPreview({
        sourcePath: ref.path,
        probe: ref.probe,
        preset: previewAs,
        watermark: wm,
        t,
        env: { ...env, frame: 0 },
        hwDecode: settings.hwDecode,
      });
      setExact(url);
    } catch (e) {
      toast('Preview failed: ' + String(e.message || e).slice(0, 200), 'warn');
    }
    setBusy(false);
  };

  const p = ref?.probe;
  const drop = p && canDropFrame(p.fps) && parseTC(p.timecode)?.drop;
  const tcNow = framesToTC(tcToFrames(p?.timecode || '01:00:00:00', fps, drop) + frame, fps, drop);

  return (
    <Panel
      className="p-stage"
      title="Canvas"
      sub={wm?.name}
      bodyProps={{ style: { display: 'flex', flexDirection: 'column' } }}
    >
      <div className="stage-tools">
          <span className="lbl">
            Reference
          </span>
          <Select
            
            value={ref?.id || ''}
            onChange={(v) => setState({ referenceSourceId: v || null })}
            options={[['', sources.some((s) => s.probe) ? 'Sample frame' : 'Sample frame — import clips to use one'], ...sources.filter((s) => s.probe).map((s) => [s.id, s.name])]}
          />
          <span className="lbl">
            Preview as
          </span>
          <Select  value={previewAs?.id || ''} onChange={(v) => setPreviewAsId(v)} options={outputs.map((o) => [o.id, o.name])} />
          <button className={`icon-btn ${guides ? 'on' : ''}`} title="Safe-area guides" onClick={() => setGuides(!guides)}>
            <I.grid />
          </button>
              </div>
      <div className="stage-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: dispW, height: dispH, cursor: hoverCursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onHover}
          onDoubleClick={() => selEl && document.getElementById('wm-text-input')?.focus()}
        />
        <div className={`stage-badge ${exact ? 'accent' : ''}`} style={{ cursor: exact ? 'pointer' : 'default' }} onClick={() => setExact(null)}>
          {exact ? (
            <>
              <I.bolt style={{ width: 12, height: 12 }} /> ffmpeg render — exact output · click to edit
            </>
          ) : (
            <>
              {size.w}×{size.h} · {previewAs?.recipient || previewAs?.name || ''}
            </>
          )}
        </div>
      </div>
      <div className="stage-bar">
        <button className="icon-btn" onClick={() => setPlaying(!playing)} title="Run the timecode / frame counter">
          {playing ? <I.pause /> : <I.play />}
        </button>
        <span className="mono" style={{ fontSize: 14, color: 'var(--text-hi)', letterSpacing: '0.04em' }}>
          {tcNow}
        </span>
        <span className="faint" style={{ fontSize: 11 }}>
          {fpsLabel(fps)} fps
        </span>
        <input
          type="range"
          className="scrubber"
          style={{ flex: 1, '--pct': `${p ? (t / Math.max(0.01, p.duration)) * 100 : 0}%` }}
          min={0}
          max={p ? Math.max(0, p.duration - 1 / fps.value) : 60}
          step={1 / fps.value}
          value={t}
          onChange={(e) => {
            setPlayFrame(0);
            setT(Number(e.target.value));
          }}
        />
        <button className="btn" onClick={renderExact} disabled={!ref || busy} title={ref ? 'Render this frame through ffmpeg exactly as it will export' : 'Choose a reference clip first'}>
          {busy ? <I.loader /> : <I.bolt />} Render Frame
        </button>
      </div>
    </Panel>
  );
}

const round4 = (v) => Math.round(v * 10000) / 10000;

function drawGuides(ctx, W, H, dpr) {
  ctx.save();
  ctx.lineWidth = dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); // action safe
  ctx.strokeStyle = 'rgba(155,92,255,0.35)';
  ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8); // title safe
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  const c = 10 * dpr;
  ctx.beginPath();
  ctx.moveTo(W / 2 - c, H / 2);
  ctx.lineTo(W / 2 + c, H / 2);
  ctx.moveTo(W / 2, H / 2 - c);
  ctx.lineTo(W / 2, H / 2 + c);
  ctx.stroke();
  ctx.restore();
}

function drawSelection(ctx, L, dpr) {
  const { x, y, w, h } = L.rect;
  const m = 6 * dpr;
  ctx.save();
  ctx.translate(L.ax, L.ay);
  ctx.rotate(L.rot);
  ctx.strokeStyle = '#b98bff';
  ctx.lineWidth = 1.25 * dpr;
  ctx.shadowColor = 'rgba(155,92,255,0.8)';
  ctx.shadowBlur = 6 * dpr;
  ctx.strokeRect(x - m, y - m, w + 2 * m, h + 2 * m);
  ctx.shadowBlur = 0;
  // rotation handle
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y - m);
  ctx.lineTo(x + w / 2, y - m - 20 * dpr);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + w / 2, y - m - 26 * dpr, 5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // scale handle (far corner from anchor)
  const corners = [
    [x - m, y - m],
    [x + w + m, y - m],
    [x + w + m, y + h + m],
    [x - m, y + h + m],
  ];
  const far = corners.reduce((a, b) => (Math.hypot(...b) > Math.hypot(...a) ? b : a));
  ctx.fillStyle = '#fff';
  ctx.fillRect(far[0] - 4 * dpr, far[1] - 4 * dpr, 8 * dpr, 8 * dpr);
  ctx.strokeRect(far[0] - 4 * dpr, far[1] - 4 * dpr, 8 * dpr, 8 * dpr);
  // anchor point
  ctx.fillStyle = '#9b5cff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(0, 0, 4 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Inspector

const WEIGHTS = [
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semibold'],
  [700, 'Bold'],
  [800, 'Heavy'],
  [900, 'Black'],
];

const QUICK_POS = [
  ['TL', 0.03, 0.05, 'left', 'top'],
  ['TC', 0.5, 0.05, 'center', 'top'],
  ['TR', 0.97, 0.05, 'right', 'top'],
  ['ML', 0.03, 0.5, 'left', 'middle'],
  ['C', 0.5, 0.5, 'center', 'middle'],
  ['MR', 0.97, 0.5, 'right', 'middle'],
  ['BL', 0.03, 0.95, 'left', 'bottom'],
  ['BC', 0.5, 0.95, 'center', 'bottom'],
  ['BR', 0.97, 0.95, 'right', 'bottom'],
];

function InspectorPanel() {
  const { wm, el } = useCurrent();
  const outputs = useStore((s) => s.outputPresets);
  if (!wm) return <Panel className="p-inspector" title="Inspector" />;
  if (!el) {
    const users = outputs.filter((o) => o.watermarkId === wm.id);
    return (
      <Panel className="p-inspector" title="Inspector" sub="Preset">
        <div className="section">
          <div className="section-title">Preset</div>
          <Row label="Name">
            <TextInput value={wm.name} onChange={(v) => updateWatermark(wm.id, { name: v })} />
          </Row>
          <Row label="Used by">
            <span className="dim">{users.length ? users.map((u) => u.name).join(', ') : 'No output presets yet'}</span>
          </Row>
        </div>
        <div className="section">
          <div className="section-title">Tips</div>
          <div className="hint" style={{ lineHeight: 1.7 }}>
            • Click a layer on the canvas to select it, drag to move.
            <br />• Drag the round handle to rotate (<span className="kbd">⇧</span> snaps 15°), the square handle to scale.
            <br />• Arrow keys nudge, <span className="kbd">⇧</span> for bigger steps. <span className="kbd">⌘D</span> duplicates, <span className="kbd">⌫</span> deletes.
            <br />• Hold <span className="kbd">⌥</span> while dragging to disable snapping.
            <br />• Sizes are relative to frame height, so one preset works at any output resolution.
            <br />• <b>Render Frame</b> runs the real ffmpeg pipeline to show the exact burn-in.
          </div>
        </div>
        <div className="section">
          <div className="section-title">Tokens</div>
          {TOKENS.map(([t, d]) => (
            <div key={t} style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 3 }}>
              <span className="mono" style={{ color: 'var(--accent-hi)', width: 110, flex: 'none' }}>
                {t}
              </span>
              <span className="dim">{d}</span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  return <ElementInspector wm={wm} el={el} />;
}

function ElementInspector({ wm, el }) {
  const up = (patch) => updateElement(wm.id, el.id, patch);
  const upSub = (key, patch) => up({ [key]: { ...(el[key] || {}), ...patch } });
  const isText = el.type !== 'image';
  const textRef = useRef();
  const Icon = TYPE_ICON[el.type];

  const insertToken = (tok) => {
    const ta = textRef.current;
    const v = el.text || '';
    if (ta && document.activeElement === ta) {
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      up({ text: v.slice(0, s) + tok + v.slice(e) });
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(s + tok.length, s + tok.length);
      });
    } else up({ text: v + (v && !v.endsWith(' ') ? ' ' : '') + tok });
  };

  return (
    <Panel
      className="p-inspector"
      title="Inspector"
      sub={el.type === 'counter' ? 'Frame Counter' : el.type[0].toUpperCase() + el.type.slice(1)}
      actions={
        <button className="icon-btn" title="Deselect" onClick={() => setState({ selectedElementId: null })}>
          <I.x />
        </button>
      }
    >
      <div className="section">
        <div className="section-title">
          <Icon style={{ width: 13, height: 13 }} /> Layer
        </div>
        <Row label="Name">
          <TextInput value={el.name} onChange={(v) => up({ name: v })} />
        </Row>

        {el.type === 'text' && (
          <>
            <Row label="Text">
              <textarea
                id="wm-text-input"
                ref={textRef}
                className="input"
                rows={2}
                value={el.text}
                spellCheck={false}
                onChange={(e) => up({ text: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Row>
            <div className="token-row" style={{ marginLeft: 106, marginBottom: 6 }}>
              {TOKENS.slice(0, 10).map(([t, d]) => (
                <button key={t} title={d} onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(t)}>
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        {el.type === 'timecode' && (
          <>
            <Row label="Source">
              <Select
                value={el.tcSource}
                onChange={(v) => up({ tcSource: v })}
                options={[
                  ['source', 'Source file timecode'],
                  ['zero', 'Start at 00:00:00:00'],
                  ['custom', 'Custom start…'],
                ]}
              />
            </Row>
            {el.tcSource === 'custom' && (
              <Row label="Start TC">
                <TextInput mono id="wm-text-input" value={el.tcStart} onChange={(v) => up({ tcStart: v })} placeholder="01:00:00:00 (use ; for drop-frame)" />
              </Row>
            )}
          </>
        )}

        {el.type === 'counter' && (
          <Row label="Start / digits">
            <NumberField value={el.counterStart} onChange={(v) => up({ counterStart: Math.max(0, Math.round(v)) })} min={0} step={1} precision={0} label="#" />
            <NumberField value={el.counterDigits} onChange={(v) => up({ counterDigits: Math.max(1, Math.min(9, Math.round(v))) })} min={1} max={9} precision={0} label="↔" />
          </Row>
        )}

        {(el.type === 'timecode' || el.type === 'counter') && (
          <Row label="Prefix / suffix">
            <TextInput id={el.type === 'counter' || el.tcSource !== 'custom' ? 'wm-text-input' : undefined} value={el.prefix} onChange={(v) => up({ prefix: v })} placeholder="e.g. TC " />
            <TextInput value={el.suffix} onChange={(v) => up({ suffix: v })} placeholder="suffix" />
          </Row>
        )}

        {el.type === 'image' && (
          <>
            <Row label="Image">
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={async () => {
                  const p = await window.wm.openImage();
                  if (!p) return;
                  const src = await window.wm.importAsset(p);
                  const img = await loadImage(src);
                  up({ src, aspect: img ? img.naturalHeight / img.naturalWidth : 1 });
                }}
              >
                <I.image /> {el.src ? 'Replace…' : 'Choose…'}
              </button>
            </Row>
            {el.src && (
              <Row label="">
                <span className="hint mono" style={{ wordBreak: 'break-all' }}>
                  {el.src.split('/').pop()}
                </span>
              </Row>
            )}
            <Row label="Width">
              <Slider value={el.width} onChange={(v) => up({ width: v })} min={1} max={100} step={0.1} precision={1} unit="%" />
            </Row>
          </>
        )}
      </div>

      {isText && (
        <div className="section">
          <div className="section-title">Typography</div>
          <Row label="Font">
            <FontPicker value={el.font} onChange={(v) => up({ font: v })} />
          </Row>
          <Row label="Style">
            <Select value={String(el.weight)} onChange={(v) => up({ weight: Number(v) })} options={WEIGHTS.map(([w, n]) => [String(w), `${n} ${w}`])} />
            <button className={`icon-btn ${el.italic ? 'on' : ''}`} style={{ background: el.italic ? 'var(--accent-deep)' : undefined }} title="Italic" onClick={() => up({ italic: !el.italic })}>
              <I.italic />
            </button>
          </Row>
          <Row label="Size" title="Percentage of frame height">
            <Slider value={el.size} onChange={(v) => up({ size: v })} min={0.5} max={25} step={0.1} precision={1} unit="%H" numStep={0.1} />
          </Row>
          <Row label="Colour">
            <ColorField value={el.color} onChange={(v) => up({ color: v })} />
          </Row>
          <Row label="Tracking">
            <Slider value={el.tracking || 0} onChange={(v) => up({ tracking: v })} min={-100} max={400} step={5} precision={0} />
          </Row>
          {el.type === 'text' && (el.text || '').includes('\n') && (
            <Row label="Line spacing">
              <Slider value={el.lineSpacing || 1.1} onChange={(v) => up({ lineSpacing: v })} min={0.7} max={2.5} step={0.05} precision={2} numStep={0.05} />
            </Row>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-title">Transform</div>
        <Row label="Quick place">
          <div className="pos-grid" style={{ flex: 1 }}>
            {QUICK_POS.map(([l, x, y, ax, ay]) => (
              <button key={l} onClick={() => up({ x, y, anchorX: ax, anchorY: ay })}>
                {l}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Position">
          <NumberField value={el.x * 100} onChange={(v) => up({ x: round4(v / 100) })} step={0.1} precision={1} unit="%" label="X" />
          <NumberField value={el.y * 100} onChange={(v) => up({ y: round4(v / 100) })} step={0.1} precision={1} unit="%" label="Y" />
        </Row>
        <Row label="Anchor" title="Which point of the layer sits at the position (also the rotation pivot and text alignment)">
          <div className="anchor-grid">
            {['top', 'middle', 'bottom'].map((ay) =>
              ['left', 'center', 'right'].map((ax) => (
                <button key={ax + ay} className={el.anchorX === ax && el.anchorY === ay ? 'on' : ''} onClick={() => up({ anchorX: ax, anchorY: ay })} title={`${ay} ${ax}`} />
              ))
            )}
          </div>
          <span className="hint">Pivot, alignment & where the layer grows from.</span>
        </Row>
        <Row label="Rotation">
          <Dial value={el.rotation || 0} onChange={(v) => up({ rotation: v })} />
          <NumberField value={el.rotation || 0} onChange={(v) => up({ rotation: Math.max(-180, Math.min(180, v)) })} step={0.5} precision={1} unit="°" label="∠" />
        </Row>
        <Row label="Opacity">
          <Slider value={el.opacity ?? 1} onChange={(v) => up({ opacity: v })} min={0} max={1} step={0.01} display={(v) => v * 100} parse={(v) => v / 100} unit="%" />
        </Row>
      </div>

      {isText && (
        <>
          <EffectSection title="Background Box" on={el.box?.on} onToggle={(v) => upSub('box', { on: v })}>
            <Row label="Colour">
              <ColorField value={el.box.color} onChange={(v) => upSub('box', { color: v })} />
            </Row>
            <Row label="Opacity">
              <Slider value={el.box.opacity ?? 0.6} onChange={(v) => upSub('box', { opacity: v })} min={0} max={1} step={0.01} display={(v) => v * 100} parse={(v) => v / 100} unit="%" />
            </Row>
            <Row label="Padding">
              <NumberField value={(el.box.padX ?? 0.4) * 100} onChange={(v) => upSub('box', { padX: Math.max(0, v / 100) })} min={0} step={1} precision={0} unit="%" label="X" />
              <NumberField value={(el.box.padY ?? 0.15) * 100} onChange={(v) => upSub('box', { padY: Math.max(0, v / 100) })} min={0} step={1} precision={0} unit="%" label="Y" />
            </Row>
            <Row label="Corners">
              <Slider value={el.box.radius || 0} onChange={(v) => upSub('box', { radius: v })} min={0} max={100} step={1} precision={0} />
            </Row>
          </EffectSection>

          <EffectSection title="Outline" on={el.stroke?.on} onToggle={(v) => upSub('stroke', { on: v })}>
            <Row label="Colour">
              <ColorField value={el.stroke.color} onChange={(v) => upSub('stroke', { color: v })} />
            </Row>
            <Row label="Width">
              <Slider value={el.stroke.width} onChange={(v) => upSub('stroke', { width: v })} min={0} max={30} step={0.5} precision={1} numStep={0.5} />
            </Row>
          </EffectSection>

          <EffectSection title="Drop Shadow" on={el.shadow?.on} onToggle={(v) => upSub('shadow', { on: v })}>
            <Row label="Colour">
              <ColorField value={el.shadow.color} onChange={(v) => upSub('shadow', { color: v })} />
            </Row>
            <Row label="Opacity">
              <Slider value={el.shadow.opacity ?? 0.8} onChange={(v) => upSub('shadow', { opacity: v })} min={0} max={1} step={0.01} display={(v) => v * 100} parse={(v) => v / 100} unit="%" />
            </Row>
            <Row label="Blur">
              <Slider value={el.shadow.blur} onChange={(v) => upSub('shadow', { blur: v })} min={0} max={60} step={1} precision={0} />
            </Row>
            <Row label="Offset">
              <NumberField value={el.shadow.x} onChange={(v) => upSub('shadow', { x: v })} step={1} precision={0} label="X" />
              <NumberField value={el.shadow.y} onChange={(v) => upSub('shadow', { y: v })} step={1} precision={0} label="Y" />
            </Row>
          </EffectSection>
        </>
      )}
    </Panel>
  );
}

function EffectSection({ title, on, onToggle, children }) {
  return (
    <div className="section" style={!on ? { paddingBottom: 2 } : undefined}>
      <div className="section-title">
        {title}
        <span className="grow" />
        <Toggle on={!!on} onChange={onToggle} />
      </div>
      {on && children}
    </div>
  );
}
