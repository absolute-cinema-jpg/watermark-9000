// Helpers shared by the queue viewer and the watermark editor.
import { renderOverlayLayers, renderPreview, ensureFonts, primeImages } from './render.js';
import { outputSize } from './codecs.js';

let previewSeq = 0;

/** Render one frame through the real ffmpeg pipeline (exact output). */
export async function ffmpegPreview({ sourcePath, probe, preset, watermark, t, env, hwDecode }) {
  const { w, h } = outputSize(preset, probe);
  const id = `preview_${++previewSeq}`;
  let layers = [];
  if (watermark?.elements?.length) {
    const r = await renderOverlayLayers(watermark, w, h, env);
    if (r.files.length) {
      const paths = await window.wm.writeOverlay(id, r.files);
      layers = r.layers.map((L) => ({ ...L, path: paths[L.file] }));
    }
  }
  try {
    return await window.wm.previewFrame({
      jobId: id,
      input: sourcePath,
      probe,
      settings: { ...preset, hwDecode },
      overlay: { layers },
      preview: { t },
    });
  } finally {
    window.wm.cleanOverlay(id);
  }
}

/** Draws `img` into a W×H frame following the preset's scale mode. */
export function drawSourceFrame(ctx, img, W, H, scaleMode = 'fit') {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!img) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (scaleMode === 'stretch') return ctx.drawImage(img, 0, 0, W, H);
  const s = scaleMode === 'fill' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** A neutral placeholder frame for when no reference clip is loaded. */
export function drawPlaceholder(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#2a2438');
  g.addColorStop(0.5, '#1c2230');
  g.addColorStop(1, '#2b1f2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // soft "scene" shapes so text legibility can be judged
  const r = ctx.createRadialGradient(W * 0.68, H * 0.38, 0, W * 0.68, H * 0.38, H * 0.6);
  r.addColorStop(0, 'rgba(255,190,120,0.55)');
  r.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8,8,12,0.75)';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.78);
  ctx.bezierCurveTo(W * 0.25, H * 0.66, W * 0.45, H * 0.86, W * 0.7, H * 0.72);
  ctx.bezierCurveTo(W * 0.85, H * 0.64, W * 0.95, H * 0.7, W, H * 0.68);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.fill();
}

export async function drawWatermarkPreview(ctx, watermark, W, H, env) {
  if (!watermark) return [];
  await ensureFonts(watermark, H);
  await primeImages(watermark);
  return renderPreview(ctx, watermark, W, H, env);
}

const imgCache = new Map();
export function imageFromUrl(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = url;
  });
  imgCache.set(url, p);
  if (imgCache.size > 40) imgCache.delete(imgCache.keys().next().value);
  return p;
}
