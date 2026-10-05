// Factory defaults: element templates, starter watermark presets and output presets.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const baseText = {
  visible: true,
  x: 0.5,
  y: 0.5,
  anchorX: 'center',
  anchorY: 'middle',
  rotation: 0,
  opacity: 1,
  font: 'Helvetica Neue',
  weight: 500,
  italic: false,
  size: 3.6,
  color: '#ffffff',
  tracking: 0,
  lineSpacing: 1.1,
  stroke: { on: false, color: '#000000', width: 6 },
  shadow: { on: true, color: '#000000', opacity: 0.75, blur: 8, x: 0, y: 4 },
  box: { on: false, color: '#000000', opacity: 0.55, padX: 0.45, padY: 0.18, radius: 12 },
};

export function makeElement(type, over = {}) {
  const id = uid();
  switch (type) {
    case 'text':
      return { ...structuredClone(baseText), id, type, name: 'Text', text: 'CONFIDENTIAL', ...over };
    case 'filename':
      return { ...structuredClone(baseText), id, type: 'text', name: 'Filename', text: '{filename}', x: 0.03, y: 0.05, anchorX: 'left', anchorY: 'top', ...over };
    case 'timecode':
      return {
        ...structuredClone(baseText),
        id,
        type,
        name: 'Timecode',
        prefix: '',
        suffix: '',
        tcSource: 'source',
        tcStart: '01:00:00:00',
        font: 'Menlo',
        weight: 700,
        x: 0.5,
        y: 0.94,
        anchorY: 'bottom',
        box: { ...baseText.box, on: true },
        shadow: { ...baseText.shadow, on: false },
        ...over,
      };
    case 'counter':
      return {
        ...structuredClone(baseText),
        id,
        type,
        name: 'Frame Counter',
        prefix: 'FR ',
        suffix: '',
        counterStart: 0,
        counterDigits: 6,
        font: 'Menlo',
        weight: 700,
        x: 0.97,
        y: 0.94,
        anchorX: 'right',
        anchorY: 'bottom',
        box: { ...baseText.box, on: true },
        shadow: { ...baseText.shadow, on: false },
        ...over,
      };
    case 'image':
      return { id, type, name: 'Image', visible: true, src: null, x: 0.92, y: 0.08, anchorX: 'right', anchorY: 'top', rotation: 0, opacity: 0.8, width: 12, ...over };
    default:
      throw new Error(type);
  }
}

export function defaultWatermarks() {
  return [
    {
      id: uid(),
      name: 'Turnover Burn-in',
      elements: [
        makeElement('text', { name: 'Show', text: '{show}', x: 0.03, y: 0.05, anchorX: 'left', anchorY: 'top', size: 3, weight: 700, tracking: 60 }),
        makeElement('text', { name: 'Recipient', text: '{recipient} TURNOVER', x: 0.97, y: 0.05, anchorX: 'right', anchorY: 'top', size: 3, weight: 700, color: '#c9a7ff', tracking: 60 }),
        makeElement('filename', { x: 0.03, y: 0.94, anchorY: 'bottom', size: 2.6, weight: 500 }),
        makeElement('timecode', { size: 4 }),
        makeElement('text', { name: 'Date', text: '{date}', x: 0.97, y: 0.94, anchorX: 'right', anchorY: 'bottom', size: 2.6 }),
      ],
    },
    {
      id: uid(),
      name: 'Confidential Diagonal',
      elements: [
        makeElement('text', { name: 'Diagonal', text: 'CONFIDENTIAL\n{recipient}', size: 11, weight: 800, rotation: -24, opacity: 0.16, tracking: 80, shadow: { ...baseText.shadow, on: false } }),
        makeElement('text', { name: 'Filename', text: '{filename}', x: 0.5, y: 0.05, anchorY: 'top', size: 2.4 }),
        makeElement('timecode', { size: 3.4, x: 0.5, y: 0.95 }),
      ],
    },
    {
      id: uid(),
      name: 'VFX Reference',
      elements: [
        makeElement('filename', { x: 0.02, y: 0.035, size: 2.6, box: { ...baseText.box, on: true }, shadow: { ...baseText.shadow, on: false } }),
        makeElement('timecode', { x: 0.02, y: 0.965, anchorX: 'left', size: 3.2, prefix: 'SRC ' }),
        makeElement('counter', { x: 0.98, y: 0.965, size: 3.2, counterStart: 1001 }),
      ],
    },
    {
      id: uid(),
      name: 'Timecode Only',
      elements: [makeElement('timecode', { size: 4.2 })],
    },
  ];
}

export function makeOutputPreset(over = {}) {
  return {
    id: uid(),
    name: 'New Output',
    recipient: '',
    color: '#8b5cf6',
    container: 'mov',
    codec: 'h264',
    profile: 'lt',
    bitrate: 10,
    resolution: '1920x1080',
    width: 1920,
    height: 1080,
    scaleMode: 'fit',
    audio: 'pcm_all',
    watermarkId: null,
    fileName: '{filename}_{recipient}',
    subfolder: '{recipient}',
    keepTimecode: true,
    deinterlace: false,
    ...over,
  };
}

export function defaultOutputPresets(wms) {
  const byName = (n) => wms.find((w) => w.name === n)?.id || null;
  return [
    makeOutputPreset({ name: 'Sound — 1080p H.264 + TC', recipient: 'SOUND', color: '#22c3a6', codec: 'h264', bitrate: 12, audio: 'pcm_all', watermarkId: byName('Turnover Burn-in') }),
    makeOutputPreset({ name: 'Music — 1080p H.264', recipient: 'MUSIC', color: '#f5a524', codec: 'h264', bitrate: 10, audio: 'aac_stereo', watermarkId: byName('Turnover Burn-in') }),
    makeOutputPreset({ name: 'VFX — ProRes LT', recipient: 'VFX', color: '#3b82f6', codec: 'prores', profile: 'lt', resolution: 'source', audio: 'none', watermarkId: byName('VFX Reference') }),
    makeOutputPreset({ name: 'Avid — DNxHD LB MXF', recipient: 'EDIT', color: '#a855f7', codec: 'dnxhd', profile: 'lb', container: 'mxf', audio: 'pcm_all', watermarkId: byName('Timecode Only') }),
    makeOutputPreset({ name: 'Review — 720p MP4', recipient: 'PRODUCERS', color: '#ef4444', container: 'mp4', codec: 'h264', bitrate: 4, resolution: '1280x720', width: 1280, height: 720, audio: 'aac_stereo', watermarkId: byName('Confidential Diagonal'), subfolder: 'Review' }),
  ];
}

export const DEFAULT_SETTINGS = {
  destination: '',
  concurrency: 2,
  hwDecode: false,
  x264Preset: 'superfast',
  notify: true,
  show: 'MY FEATURE',
  overwrite: false,
  proresEncoder: 'hardware',
  avgSpeed: null,
};

export const PRESET_COLORS = ['#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#ef4444', '#f5a524', '#eab308', '#22c55e', '#22c3a6', '#06b6d4', '#3b82f6', '#94a3b8'];
