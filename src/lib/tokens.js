// Text tokens that can be used in watermark text and output file names.
import { fpsLabel, secondsToClock } from './timecode.js';
import { CODECS, codecSummary } from './codecs.js';

export const TOKENS = [
  ['{filename}', 'Source file name (no extension)'],
  ['{ext}', 'Source file extension'],
  ['{show}', 'Project / show name (Settings)'],
  ['{recipient}', 'Recipient / department (Output preset)'],
  ['{preset}', 'Output preset name'],
  ['{date}', 'Today’s date (YYYY-MM-DD)'],
  ['{date_uk}', 'Today’s date (DD/MM/YYYY)'],
  ['{time}', 'Current time (HH:MM)'],
  ['{start_tc}', 'Source start timecode'],
  ['{duration}', 'Clip duration'],
  ['{fps}', 'Frame rate'],
  ['{resolution}', 'Output resolution'],
  ['{src_resolution}', 'Source resolution'],
  ['{codec}', 'Output codec'],
  ['{src_codec}', 'Source codec'],
  ['{user}', 'macOS user name'],
];

const pad = (n) => String(n).padStart(2, '0');

export function buildVars({ sourcePath, probe, show, recipient, presetName, outW, outH, settings, user }) {
  const now = new Date();
  const base = sourcePath ? sourcePath.split('/').pop() : 'A001_C003_220415_R2KT';
  const dot = base.lastIndexOf('.');
  const filename = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1) : 'mov';
  return {
    filename,
    ext,
    show: show || 'SHOW NAME',
    recipient: recipient || '',
    preset: presetName || '',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    date_uk: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    start_tc: probe?.timecode || '00:00:00:00',
    duration: probe ? secondsToClock(probe.duration) : '00:00',
    fps: probe ? fpsLabel(probe.fps) : '23.976',
    resolution: outW ? `${outW}x${outH}` : probe ? `${probe.width}x${probe.height}` : '1920x1080',
    src_resolution: probe ? `${probe.width}x${probe.height}` : '1920x1080',
    codec: settings ? (CODECS[settings.codec] ? codecSummary(settings) : settings.codec) : 'H.264',
    src_codec: probe?.codec ? probe.codec.toUpperCase() : 'PRORES',
    user: user || 'editor',
  };
}

export function resolveTokens(str, vars) {
  return String(str ?? '').replace(/\{([a-z_]+)\}/gi, (m, k) => (k in vars ? vars[k] : m));
}

export function sanitizeFileName(s) {
  return s.replace(/[/:\\]/g, '-').replace(/[\u0000-\u001f]/g, '').replace(/\s+$/g, '').replace(/^\.+/, '') || 'output';
}
