// Watermark renderer. One layout engine drives both the interactive editor preview
// and the overlay layers handed to ffmpeg, so what you see is what gets burned in.
import { resolveTokens } from './tokens.js';
import { tcToFrames, framesToTC, parseTC, canDropFrame, tcDigitExprs, counterDigitExprs } from './timecode.js';

const imageCache = new Map();

export async function loadImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const p = (async () => {
    const url = src.startsWith('data:') ? src : await window.wm.readAsset(src);
    if (!url) return null;
    // onload rather than img.decode(): decode() can be deferred while the window is hidden
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  })();
  p.then((img) => (p.__resolved = img));
  imageCache.set(src, p);
  return p;
}

export function getCachedImage(src) {
  return imageCache.get(src);
}

export function hexToRgba(hex, a = 1) {
  let h = (hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function fontString(el, px) {
  const fam = (el.font || 'Helvetica Neue').replace(/"/g, '');
  return `${el.italic ? 'italic ' : ''}${el.weight || 400} ${px}px "${fam}", "Helvetica Neue", sans-serif`;
}

export async function ensureFonts(preset, H = 1080) {
  const loads = [];
  for (const el of preset.elements || []) {
    if (el.type === 'image') loads.push(loadImage(el.src));
    else loads.push(document.fonts.load(fontString(el, Math.max(8, Math.round((el.size / 100) * H)))).catch(() => null));
  }
  await Promise.all(loads);
}

// ---------------------------------------------------------------------------------------------
// Timecode context

export function tcContext(el, env) {
  const fps = env.fps || { num: 24000, den: 1001, value: 23.976 };
  const src = env.sourceTC || '00:00:00:00';
  const srcParsed = parseTC(src);
  const drop = !!(canDropFrame(fps) && (el.tcSource === 'custom' ? parseTC(el.tcStart)?.drop : srcParsed?.drop));
  let start = 0;
  if (el.tcSource === 'custom') start = tcToFrames(el.tcStart || '00:00:00:00', fps, drop);
  else if (el.tcSource !== 'zero') start = tcToFrames(src, fps, drop);
  return { fps, drop, start };
}

// Build the list of runs (static strings and dynamic digit slots) for a text-ish element.
function buildLines(el, env) {
  if (el.type === 'text') {
    const txt = resolveTokens(el.text ?? '', env.vars || {});
    return txt.split('\n').map((l) => [{ kind: 'static', str: l }]);
  }
  const frame = env.frame || 0;
  const runs = [];
  const prefix = resolveTokens(el.prefix || '', env.vars || {});
  if (prefix) runs.push({ kind: 'static', str: prefix });
  if (el.type === 'timecode') {
    const c = tcContext(el, env);
    const tc = framesToTC(c.start + frame, c.fps, c.drop);
    let di = 0;
    for (const ch of tc) {
      if (/\d/.test(ch)) runs.push({ kind: 'digit', str: ch, index: di++ });
      else runs.push({ kind: 'static', str: ch });
    }
  } else if (el.type === 'counter') {
    const digits = Math.max(1, Math.min(9, el.counterDigits || 6));
    const v = String(Math.max(0, (el.counterStart || 0) + frame) % 10 ** digits).padStart(digits, '0');
    let di = 0;
    for (const ch of v) runs.push({ kind: 'digit', str: ch, index: di++ });
  }
  const suffix = resolveTokens(el.suffix || '', env.vars || {});
  if (suffix) runs.push({ kind: 'static', str: suffix });
  return [runs];
}

const DIGITS = '0123456789';

export function effectMargin(el, px) {
  let m = 2;
  if (el.stroke?.on) m += (el.stroke.width / 100) * px;
  if (el.shadow?.on) m += ((el.shadow.blur || 0) / 100) * px * 1.5 + ((Math.abs(el.shadow.x || 0) + Math.abs(el.shadow.y || 0)) / 100) * px;
  return Math.ceil(m);
}

/**
 * Computes the full geometry of an element at frame size W×H.
 * Returns { ax, ay, rot, rect:{x,y,w,h} (local, relative to anchor), margin, lines/runs, px, ... }
 */
export function layoutElement(ctx, el, W, H, env) {
  const ax = el.x * W;
  const ay = el.y * H;
  const rot = ((el.rotation || 0) * Math.PI) / 180;

  if (el.type === 'image') {
    const imgP = getCachedImage(el.src);
    const img = imgP && imgP.__resolved;
    const w = ((el.width || 15) / 100) * W;
    const ratio = img ? img.naturalHeight / img.naturalWidth : el.aspect || 0.5;
    const h = w * ratio;
    const ox = el.anchorX === 'left' ? 0 : el.anchorX === 'right' ? -w : -w / 2;
    const oy = el.anchorY === 'top' ? 0 : el.anchorY === 'bottom' ? -h : -h / 2;
    return { type: 'image', ax, ay, rot, rect: { x: ox, y: oy, w, h }, margin: 2, img };
  }

  const px = Math.max(1, ((el.size || 4) / 100) * H);
  ctx.save();
  ctx.font = fontString(el, px);
  const tracking = ((el.tracking || 0) / 1000) * px;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
  const fm = ctx.measureText('Hg0');
  const ascent = fm.fontBoundingBoxAscent || px * 0.8;
  const descent = fm.fontBoundingBoxDescent || px * 0.22;
  const lineH = ascent + descent;
  const lineAdv = lineH * (el.lineSpacing || 1.1);
  let slotW = 0;
  const digitW = {};
  for (const d of DIGITS) {
    digitW[d] = ctx.measureText(d).width;
    slotW = Math.max(slotW, digitW[d]);
  }
  const lines = buildLines(el, env).map((runs) => {
    let w = 0;
    for (const r of runs) {
      r.w = r.kind === 'digit' ? slotW : ctx.measureText(r.str).width;
      w += r.w;
    }
    return { runs, w };
  });
  ctx.restore();
  // trailing letter-spacing isn't visually part of the text
  const trim = tracking > 0 ? tracking : 0;
  const blockW = Math.max(1, ...lines.map((l) => l.w - trim));
  const blockH = lineH + (lines.length - 1) * lineAdv;
  const box = el.box?.on;
  const padX = box ? (el.box.padX ?? 0.4) * px : 0;
  const padY = box ? (el.box.padY ?? 0.15) * px : 0;
  const w = blockW + padX * 2;
  const h = blockH + padY * 2;
  const ox = el.anchorX === 'left' ? 0 : el.anchorX === 'right' ? -w : -w / 2;
  const oy = el.anchorY === 'top' ? 0 : el.anchorY === 'bottom' ? -h : -h / 2;
  lines.forEach((ln, i) => {
    const lw = ln.w - trim;
    let x = ox + padX + (el.anchorX === 'left' ? 0 : el.anchorX === 'right' ? blockW - lw : (blockW - lw) / 2);
    const baseline = oy + padY + ascent + i * lineAdv;
    for (const r of ln.runs) {
      r.x = x;
      r.baseline = baseline;
      x += r.w;
    }
  });
  return {
    type: el.type,
    ax,
    ay,
    rot,
    px,
    rect: { x: ox, y: oy, w, h },
    margin: effectMargin(el, px),
    lines,
    ascent,
    lineH,
    slotW,
    digitW,
    tracking,
  };
}

// Axis-aligned bounds in frame pixels, including stroke/shadow margins.
export function layoutBounds(L) {
  const { x, y, w, h } = L.rect;
  const m = L.margin;
  const pts = [
    [x - m, y - m],
    [x + w + m, y - m],
    [x + w + m, y + h + m],
    [x - m, y + h + m],
  ];
  const c = Math.cos(L.rot);
  const s = Math.sin(L.rot);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [px, py] of pts) {
    const gx = L.ax + px * c - py * s;
    const gy = L.ay + px * s + py * c;
    minX = Math.min(minX, gx);
    maxX = Math.max(maxX, gx);
    minY = Math.min(minY, gy);
    maxY = Math.max(maxY, gy);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function applyTextStyle(ctx, el, L, withShadow) {
  ctx.font = fontString(el, L.px);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${L.tracking}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = el.color || '#ffffff';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (withShadow && el.shadow?.on) {
    ctx.shadowColor = hexToRgba(el.shadow.color || '#000000', el.shadow.opacity ?? 0.8);
    ctx.shadowBlur = ((el.shadow.blur || 0) / 100) * L.px;
    ctx.shadowOffsetX = ((el.shadow.x || 0) / 100) * L.px;
    ctx.shadowOffsetY = ((el.shadow.y || 0) / 100) * L.px;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function drawGlyphs(ctx, el, L, items) {
  // items: [{str, x, baseline}]
  const stroke = el.stroke?.on && el.stroke.width > 0;
  if (stroke) {
    applyTextStyle(ctx, el, L, true);
    ctx.strokeStyle = el.stroke.color || '#000000';
    ctx.lineWidth = ((el.stroke.width || 0) / 100) * L.px * 2;
    for (const it of items) ctx.strokeText(it.str, it.x, it.baseline);
  }
  applyTextStyle(ctx, el, L, !stroke);
  for (const it of items) ctx.fillText(it.str, it.x, it.baseline);
}

/**
 * Draws one element onto ctx (already in frame-pixel space).
 * mode: 'all' | 'static' (skip dynamic digits)
 */
export function drawElement(ctx, el, L, mode = 'all') {
  ctx.save();
  ctx.translate(L.ax, L.ay);
  ctx.rotate(L.rot);
  ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity ?? 1));
  if (L.type === 'image') {
    if (L.img) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(L.img, L.rect.x, L.rect.y, L.rect.w, L.rect.h);
    }
    ctx.restore();
    return;
  }
  if (el.box?.on) {
    ctx.fillStyle = hexToRgba(el.box.color || '#000000', el.box.opacity ?? 0.6);
    const r = Math.min(((el.box.radius || 0) / 100) * L.px, L.rect.h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(L.rect.x, L.rect.y, L.rect.w, L.rect.h, r);
    else ctx.rect(L.rect.x, L.rect.y, L.rect.w, L.rect.h);
    ctx.fill();
  }
  const items = [];
  for (const ln of L.lines) {
    for (const r of ln.runs) {
      if (r.kind === 'digit') {
        if (mode === 'static') continue;
        items.push({ str: r.str, x: r.x + (L.slotW - L.digitW[r.str]) / 2, baseline: r.baseline });
      } else if (r.str) items.push({ str: r.str, x: r.x, baseline: r.baseline });
    }
  }
  drawGlyphs(ctx, el, L, items);
  ctx.restore();
}

export function renderPreview(ctx, preset, W, H, env) {
  const layouts = [];
  for (const el of preset.elements || []) {
    if (el.visible === false) {
      layouts.push(null);
      continue;
    }
    const L = layoutElement(ctx, el, W, H, env);
    drawElement(ctx, el, L, 'all');
    layouts.push(L);
  }
  return layouts;
}

// Resolve cached images synchronously for layout (images must be preloaded with ensureFonts).
export async function primeImages(preset) {
  for (const el of preset.elements || []) {
    if (el.type === 'image' && el.src) {
      const p = loadImage(el.src);
      p.__resolved = await p;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Export: render overlay layers for ffmpeg

// Synchronous encode: toBlob callbacks can be throttled while the window is in the background.
function canvasToBytes(canvas) {
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Returns { files: [{name, data}], layers: [...] } where each layer references files by index.
 * Static parts are cropped to their bounds; digits become a 10-cell vertical strip
 * that ffmpeg crops per frame with expressions derived from the frame number.
 */
export async function renderOverlayLayers(preset, W, H, env) {
  await ensureFonts(preset, H);
  await primeImages(preset);
  const measure = document.createElement('canvas').getContext('2d');
  const files = [];
  const layers = [];
  let n = 0;
  for (const el of preset.elements || []) {
    if (el.visible === false) continue;
    if ((el.opacity ?? 1) <= 0) continue;
    const L = layoutElement(measure, el, W, H, { ...env, frame: 0 });
    const hasDigits = L.lines?.some((ln) => ln.runs.some((r) => r.kind === 'digit'));
    const hasStatic = L.type === 'image' || el.box?.on || L.lines?.some((ln) => ln.runs.some((r) => r.kind === 'static' && r.str.trim()));

    if (hasStatic) {
      const b = layoutBounds(L);
      const x0 = Math.max(0, Math.floor(b.x));
      const y0 = Math.max(0, Math.floor(b.y));
      const x1 = Math.min(W, Math.ceil(b.x + b.w));
      const y1 = Math.min(H, Math.ceil(b.y + b.h));
      if (x1 > x0 && y1 > y0) {
        const c = document.createElement('canvas');
        c.width = x1 - x0;
        c.height = y1 - y0;
        const cx = c.getContext('2d');
        cx.translate(-x0, -y0);
        drawElement(cx, el, L, 'static');
        const name = `layer_${String(n++).padStart(2, '0')}.png`;
        files.push({ name, data: await canvasToBytes(c) });
        layers.push({ type: 'static', file: files.length - 1, x: x0, y: y0 });
      }
    }

    if (hasDigits) {
      const pad = L.margin + 2;
      const cellW = Math.ceil(L.slotW + pad * 2);
      const cellH = Math.ceil(L.lineH + pad * 2);
      const c = document.createElement('canvas');
      c.width = cellW;
      c.height = cellH * 10;
      const cx = c.getContext('2d');
      cx.globalAlpha = Math.max(0, Math.min(1, el.opacity ?? 1));
      const baseOff = (cellH - L.lineH) / 2 + L.ascent;
      const items = [];
      for (let d = 0; d < 10; d++) {
        const s = String(d);
        items.push({ str: s, x: (cellW - L.digitW[s]) / 2, baseline: d * cellH + baseOff });
      }
      // clip each cell so blur/shadow doesn't bleed into neighbouring digits
      for (let d = 0; d < 10; d++) {
        cx.save();
        cx.beginPath();
        cx.rect(0, d * cellH, cellW, cellH);
        cx.clip();
        drawGlyphs(cx, el, L, [items[d]]);
        cx.restore();
      }
      const name = `digits_${String(n++).padStart(2, '0')}.png`;
      files.push({ name, data: await canvasToBytes(c) });

      let exprs;
      if (el.type === 'timecode') {
        const t = tcContext(el, env);
        exprs = tcDigitExprs(t.start, t.fps, t.drop);
      } else {
        exprs = counterDigitExprs(el.counterStart || 0, Math.max(1, Math.min(9, el.counterDigits || 6)));
      }
      const cos = Math.cos(L.rot);
      const sin = Math.sin(L.rot);
      const cells = [];
      for (const ln of L.lines) {
        for (const r of ln.runs) {
          if (r.kind !== 'digit') continue;
          const lx = r.x + L.slotW / 2;
          const ly = r.baseline - L.ascent + L.lineH / 2;
          cells.push({
            cx: L.ax + lx * cos - ly * sin,
            cy: L.ay + lx * sin + ly * cos,
            yExpr: `${cellH}*(${exprs[r.index]})`,
          });
        }
      }
      layers.push({ type: 'digits', file: files.length - 1, cellW, cellH, rotation: el.rotation || 0, cells });
    }
  }
  return { files, layers };
}
