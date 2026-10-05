// Output format definitions shown in the Render Settings panel.

export const CODECS = {
  h264: {
    label: 'H.264 — x264 (fastest)',
    short: 'H.264',
    containers: ['mov', 'mp4'],
    bitrate: true,
    defaultBitrate: 10,
  },
  h264_vt: {
    label: 'H.264 — Apple hardware',
    short: 'H.264 VT',
    containers: ['mov', 'mp4'],
    bitrate: true,
    defaultBitrate: 10,
  },
  hevc: {
    label: 'H.265 / HEVC — Apple hardware',
    short: 'HEVC',
    containers: ['mov', 'mp4'],
    bitrate: true,
    defaultBitrate: 8,
  },
  prores: {
    label: 'Apple ProRes',
    short: 'ProRes',
    containers: ['mov'],
    profiles: [
      ['proxy', 'ProRes 422 Proxy'],
      ['lt', 'ProRes 422 LT'],
      ['422', 'ProRes 422'],
      ['hq', 'ProRes 422 HQ'],
      ['4444', 'ProRes 4444'],
    ],
    defaultProfile: 'lt',
  },
  dnxhd: {
    label: 'Avid DNxHD (1080)',
    short: 'DNxHD',
    containers: ['mxf', 'mov'],
    fixedSize: [1920, 1080],
    profiles: [
      ['lb', 'DNxHD LB (36 / 45)'],
      ['sq', 'DNxHD SQ (115 / 120 / 145)'],
      ['hq', 'DNxHD HQ (175 / 185 / 220)'],
      ['hqx', 'DNxHD HQX 10-bit'],
    ],
    defaultProfile: 'lb',
  },
  dnxhr: {
    label: 'Avid DNxHR',
    short: 'DNxHR',
    containers: ['mxf', 'mov'],
    profiles: [
      ['lb', 'DNxHR LB'],
      ['sq', 'DNxHR SQ'],
      ['hq', 'DNxHR HQ'],
      ['hqx', 'DNxHR HQX 10-bit'],
      ['444', 'DNxHR 444'],
    ],
    defaultProfile: 'lb',
  },
};

export const CONTAINERS = {
  mov: 'QuickTime (.mov)',
  mp4: 'MP4 (.mp4)',
  mxf: 'MXF OP1a (.mxf)',
};

export const RESOLUTIONS = [
  ['source', 'Same as source'],
  ['3840x2160', '3840 × 2160 UHD'],
  ['2048x1080', '2048 × 1080 DCI 2K'],
  ['1920x1080', '1920 × 1080 HD'],
  ['1280x720', '1280 × 720 HD'],
  ['1024x576', '1024 × 576 PAL WS'],
  ['960x540', '960 × 540 qHD'],
  ['640x360', '640 × 360'],
  ['custom', 'Custom…'],
];

export const AUDIO_MODES = [
  ['pcm_all', 'All tracks — PCM 24-bit'],
  ['aac_all', 'All tracks — AAC'],
  ['aac_stereo', 'Stereo mix — AAC (A1+A2)'],
  ['none', 'No audio'],
];

export const SCALE_MODES = [
  ['fit', 'Scale to fit (letterbox)'],
  ['fill', 'Scale to fill (crop)'],
  ['stretch', 'Stretch'],
];

export function codecSummary(s) {
  const c = CODECS[s.codec === 'h264_sw' ? 'h264' : s.codec];
  if (!c) return s.codec;
  let t = c.short;
  if (c.profiles) {
    const p = c.profiles.find((x) => x[0] === s.profile);
    t = p ? p[1] : t;
  } else if (c.bitrate) t += ` ${s.bitrate} Mb/s`;
  return t;
}

export function resolutionSummary(s) {
  if (s.codec === 'dnxhd') return '1920×1080';
  if (s.resolution === 'source') return 'Source res';
  return `${s.width}×${s.height}`;
}

export function estimateSizeMB(s, probe, outW, outH) {
  const dur = probe?.duration || 0;
  let mbps;
  const px = (outW * outH) / (1920 * 1080);
  const fps = probe?.fps?.value || 24;
  const fk = fps / 24;
  switch (s.codec) {
    case 'h264':
    case 'hevc':
    case 'h264_sw':
    case 'h264_vt':
      mbps = Number(s.bitrate) || 10;
      break;
    case 'prores':
      mbps = { proxy: 36, lt: 82, '422': 117, hq: 176, '4444': 264 }[s.profile] * px * fk;
      break;
    case 'dnxhr':
      mbps = { lb: 36, sq: 116, hq: 176, hqx: 176, '444': 352 }[s.profile] * px * fk;
      break;
    case 'dnxhd':
      mbps = { lb: 36, sq: 115, hq: 175, hqx: 175 }[s.profile] * fk;
      break;
    default:
      mbps = 10;
  }
  return (mbps * dur) / 8;
}

const even = (n) => {
  n = Math.round(n);
  return n % 2 ? n + 1 : n;
};

// Mirrors outputSize() in electron/ffmpeg.cjs
export function outputSize(s, probe) {
  if (s.codec === 'dnxhd') return { w: 1920, h: 1080 };
  if (!probe) return { w: s.width || 1920, h: s.height || 1080 };
  if (s.resolution === 'source' || !s.width || !s.height) {
    let w = probe.width;
    const [sn, sd] = (probe.sar || '1:1').split(':').map(Number);
    if (sn && sd && sn !== sd) w = Math.round((w * sn) / sd);
    return { w: even(w), h: even(probe.height) };
  }
  return { w: even(s.width), h: even(s.height) };
}
