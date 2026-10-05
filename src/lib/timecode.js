// SMPTE timecode helpers. The JS functions and the ffmpeg expression builders
// intentionally mirror each other so the editor preview matches the export.

export function tcBase(fps) {
  return Math.round(fps.value || fps);
}

// Drop-frame only makes sense for 29.97 / 59.94.
export function canDropFrame(fps) {
  const v = fps.value || fps;
  return Math.abs(v - 29.97) < 0.01 || Math.abs(v - 59.94) < 0.01;
}

export function dropCount(fps) {
  return tcBase(fps) === 60 ? 4 : 2;
}

export function parseTC(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})[:;.](\d{2})[:;.](\d{2})([:;.])(\d{2,3})$/);
  if (!m) return null;
  return { h: +m[1], m: +m[2], s: +m[3], f: +m[5], drop: m[4] === ';' };
}

// Timecode string -> absolute frame count (real frames).
export function tcToFrames(str, fps, forceDrop) {
  const t = parseTC(str);
  if (!t) return 0;
  const base = tcBase(fps);
  const drop = (forceDrop ?? t.drop) && canDropFrame(fps);
  let frames = ((t.h * 60 + t.m) * 60 + t.s) * base + t.f;
  if (drop) {
    const d = dropCount(fps);
    const totalMinutes = t.h * 60 + t.m;
    frames -= d * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

// Real frame count -> displayed frame count (accounts for drop frame).
export function displayFrames(F, fps, drop) {
  if (!drop || !canDropFrame(fps)) return F;
  const base = tcBase(fps);
  const d = dropCount(fps);
  const perMin = base * 60 - d;
  const per10 = base * 600 - 9 * d;
  const tens = Math.floor(F / per10);
  const m = F % per10;
  return F + 9 * d * tens + d * Math.floor(Math.max(m - d, 0) / perMin);
}

export function framesToTC(F, fps, drop) {
  const base = tcBase(fps);
  const D = displayFrames(Math.max(0, F), fps, drop);
  const ff = D % base;
  const ss = Math.floor(D / base) % 60;
  const mm = Math.floor(D / (base * 60)) % 60;
  const hh = Math.floor(D / (base * 3600)) % 24;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}${drop && canDropFrame(fps) ? ';' : ':'}${p(ff)}`;
}

// ffmpeg expression (string) for displayed frame count, given expression F for real frames.
function displayExpr(F, fps, drop) {
  if (!drop || !canDropFrame(fps)) return F;
  const base = tcBase(fps);
  const d = dropCount(fps);
  const perMin = base * 60 - d;
  const per10 = base * 600 - 9 * d;
  return `(${F}+${9 * d}*floor(${F}/${per10})+${d}*floor(max(mod(${F},${per10})-${d},0)/${perMin}))`;
}

/**
 * Returns 8 ffmpeg expressions (HH MM SS FF, tens/ones) evaluating to a digit 0-9.
 * `FN` is substituted by the engine with the frame index expression.
 */
export function tcDigitExprs(startFrames, fps, drop) {
  const base = tcBase(fps);
  const D = displayExpr(`(FN+${startFrames})`, fps, drop);
  const fields = [
    `mod(floor(${D}/${base * 3600}),24)`,
    `mod(floor(${D}/${base * 60}),60)`,
    `mod(floor(${D}/${base}),60)`,
    `mod(${D},${base})`,
  ];
  const out = [];
  for (const f of fields) {
    out.push(`mod(floor((${f})/10),10)`);
    out.push(`mod(${f},10)`);
  }
  return out;
}

export function counterDigitExprs(start, digits) {
  const out = [];
  for (let i = digits - 1; i >= 0; i--) out.push(`mod(floor((FN+${start})/${10 ** i}),10)`);
  return out;
}

export function secondsToClock(sec) {
  if (!isFinite(sec) || sec < 0) return '--:--';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function fpsLabel(fps) {
  if (!fps) return '';
  const v = fps.value;
  if (Math.abs(v - 23.976) < 0.01) return '23.976';
  if (Math.abs(v - 29.97) < 0.01) return '29.97';
  if (Math.abs(v - 59.94) < 0.01) return '59.94';
  return String(Math.round(v * 1000) / 1000);
}
