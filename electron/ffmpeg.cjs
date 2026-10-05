// ffmpeg / ffprobe engine: probing, thumbnails, argument building and encode processes.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// WM_NO_SYSTEM_FFMPEG=1 simulates a Mac without Homebrew (testing the bundled binaries)
const SYSTEM_DIRS = process.env.WM_NO_SYSTEM_FFMPEG ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin'];

// The packaged app ships its own self-contained ffmpeg/ffprobe (Contents/Resources/bin; build/bin
// in development) so it runs on Macs without Homebrew. A system ffmpeg is preferred when it has
// everything we need, because current Homebrew builds encode x264 ~30% faster than the bundled 6.0.
const BUNDLED_DIRS = [process.resourcesPath && path.join(process.resourcesPath, 'bin'), path.join(__dirname, '..', 'build', 'bin')].filter(Boolean);

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isCapableFfmpeg(bin) {
  try {
    const enc = execFileSync(bin, ['-hide_banner', '-encoders'], { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return ['libx264', 'prores_videotoolbox', 'dnxhd', 'aac'].every((e) => enc.includes(e));
  } catch {
    return false;
  }
}

function findTools() {
  const envFfmpeg = process.env.WM_FFMPEG;
  const systemDirs = [...SYSTEM_DIRS];
  const candidates = [envFfmpeg, ...systemDirs.map((d) => path.join(d, 'ffmpeg')), ...BUNDLED_DIRS.map((d) => path.join(d, 'ffmpeg'))].filter(Boolean);
  let ffmpeg = null;
  for (const c of candidates) {
    if (isExecutable(c) && isCapableFfmpeg(c)) {
      ffmpeg = c;
      break;
    }
  }
  // ffprobe: prefer the one next to the chosen ffmpeg, then bundled, then anything on the system
  const probeCandidates = [
    process.env.WM_FFPROBE,
    ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe'),
    ...BUNDLED_DIRS.map((d) => path.join(d, 'ffprobe')),
    ...systemDirs.map((d) => path.join(d, 'ffprobe')),
  ].filter(Boolean);
  const ffprobe = probeCandidates.find(isExecutable) || null;
  return { ffmpeg, ffprobe };
}

const { ffmpeg: FFMPEG, ffprobe: FFPROBE } = findTools();

function ffmpegVersion() {
  try {
    return execFileSync(FFMPEG, ['-hide_banner', '-version']).toString().split('\n')[0];
  } catch {
    return null;
  }
}

function run(bin, args, { collect = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error('ffmpeg/ffprobe not found — reinstall Watermark 9000'));
    const p = spawn(bin, args);
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => collect && out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(Buffer.concat(err).toString().trim().split('\n').slice(-4).join('\n') || `exit ${code}`));
    });
  });
}

function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = r.split('/').map(Number);
  if (!n || !d) return null;
  return { num: n, den: d, value: n / d };
}

async function probe(file) {
  const buf = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(buf.toString());
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const tmcd = streams.find((s) => s.tags && s.tags.timecode);
  const tc =
    (v && v.tags && v.tags.timecode) ||
    (j.format && j.format.tags && j.format.tags.timecode) ||
    (tmcd && tmcd.tags.timecode) ||
    null;
  const fps = v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) : null;
  // Prefer r_frame_rate when avg is slightly off (common in mov with edit lists)
  const rfr = v ? parseRate(v.r_frame_rate) : null;
  const rate = rfr && rfr.value <= 120 ? rfr : fps;
  let duration = parseFloat((j.format && j.format.duration) || (v && v.duration) || 0) || 0;
  if (v && v.duration && parseFloat(v.duration) > 0) duration = parseFloat(v.duration);
  let sar = v && v.sample_aspect_ratio && v.sample_aspect_ratio !== '0:1' ? v.sample_aspect_ratio : '1:1';
  return {
    file,
    hasVideo: !!v,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    sar,
    codec: v ? v.codec_name : null,
    codecLong: v ? v.codec_long_name : null,
    profile: v ? v.profile : null,
    pixFmt: v ? v.pix_fmt : null,
    fieldOrder: v ? v.field_order : null,
    fps: rate ? { num: rate.num, den: rate.den, value: rate.value } : { num: 25, den: 1, value: 25 },
    duration,
    nbFrames: v && v.nb_frames ? parseInt(v.nb_frames, 10) : Math.round(duration * (rate ? rate.value : 25)),
    timecode: tc,
    bitRate: parseInt((j.format && j.format.bit_rate) || 0, 10),
    formatName: j.format ? j.format.format_name : '',
    size: parseInt((j.format && j.format.size) || 0, 10),
    audio: audio.map((a, i) => ({ index: i, codec: a.codec_name, channels: a.channels, sampleRate: a.sample_rate, layout: a.channel_layout })),
  };
}

async function thumbnail(file, t, width) {
  const args = ['-v', 'error', '-ss', String(Math.max(0, t || 0)), '-i', file, '-frames:v', '1'];
  args.push('-vf', `scale=${width || 640}:-2:flags=bicubic`, '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1');
  const buf = await run(FFMPEG, args);
  if (!buf.length) throw new Error('no frame');
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

// ---------------------------------------------------------------------------------------------
// Argument building

const PRORES_PROFILE = { proxy: 0, lt: 1, '422': 2, hq: 3, '4444': 4, xq: 5 };
const PRORES_KS_PROFILE = { proxy: 0, lt: 1, '422': 2, hq: 3, '4444': 4, xq: 5 };

// Avid DNxHD bitrates (Mbps) by nominal frame rate for 1920x1080.
const DNXHD_TABLE = {
  lb: { 23.976: 36, 24: 36, 25: 36, 29.97: 45, 50: 75, 59.94: 90, 60: 90 },
  sq: { 23.976: 115, 24: 115, 25: 120, 29.97: 145, 50: 240, 59.94: 290, 60: 290 },
  hq: { 23.976: 175, 24: 175, 25: 185, 29.97: 220, 50: 365, 59.94: 440, 60: 440 },
  hqx: { 23.976: 175, 24: 175, 25: 185, 29.97: 220, 50: 365, 59.94: 440, 60: 440 },
};

function nearestRate(v) {
  const keys = [23.976, 24, 25, 29.97, 50, 59.94, 60];
  return keys.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

function even(n) {
  n = Math.round(n);
  return n % 2 ? n + 1 : n;
}

// Returns output frame size for a job.
function outputSize(settings, probeInfo) {
  if (settings.codec === 'dnxhd') return { w: 1920, h: 1080 };
  if (settings.resolution === 'source' || !settings.width || !settings.height) {
    // account for anamorphic sources
    let w = probeInfo.width;
    const [sn, sd] = (probeInfo.sar || '1:1').split(':').map(Number);
    if (sn && sd && sn !== sd) w = Math.round((w * sn) / sd);
    return { w: even(w), h: even(probeInfo.height) };
  }
  return { w: even(settings.width), h: even(settings.height) };
}

function scaleChain(settings, probeInfo, size) {
  const { w, h } = size;
  const sameSize = w === probeInfo.width && h === probeInfo.height && (probeInfo.sar || '1:1') === '1:1';
  const chain = [];
  if (settings.deinterlace && probeInfo.fieldOrder && !['progressive', 'unknown'].includes(probeInfo.fieldOrder)) {
    chain.push('bwdif=mode=send_frame');
  }
  if (!sameSize) {
    const mode = settings.scaleMode || 'fit';
    if (mode === 'stretch') chain.push(`scale=${w}:${h}:flags=bicubic`);
    else if (mode === 'fill') chain.push(`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic`, `crop=${w}:${h}`);
    else chain.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
  }
  chain.push('setsar=1');
  return chain;
}

function videoCodecArgs(settings, probeInfo) {
  const s = settings;
  const mbps = Math.max(0.5, Number(s.bitrate) || 10);
  switch (s.codec) {
    case 'h264':
    case 'h264_sw': {
      // x264 on Apple silicon CPUs is ~3x faster than the single shared VideoToolbox H.264 engine
      const preset = s.x264Preset || 'superfast';
      return { pixFmt: 'yuv420p', args: ['-c:v', 'libx264', '-preset', preset, '-b:v', `${mbps}M`, '-maxrate', `${mbps * 1.5}M`, '-bufsize', `${mbps * 2}M`, '-profile:v', 'high'] };
    }
    case 'h264_vt':
      return { pixFmt: 'yuv420p', args: ['-c:v', 'h264_videotoolbox', '-b:v', `${mbps}M`, '-maxrate', `${mbps * 1.5}M`, '-bufsize', `${mbps * 2}M`, '-profile:v', 'high', '-allow_sw', '1', '-prio_speed', '1'] };
    case 'hevc':
      return { pixFmt: 'yuv420p', args: ['-c:v', 'hevc_videotoolbox', '-b:v', `${mbps}M`, '-tag:v', 'hvc1', '-allow_sw', '1', '-prio_speed', '1'] };
    case 'prores': {
      const prof = s.profile || '422';
      const is4444 = prof === '4444' || prof === 'xq';
      if (s.proresEncoder === 'software') {
        return { pixFmt: is4444 ? 'yuva444p10le' : 'yuv422p10le', args: ['-c:v', 'prores_ks', '-profile:v', String(PRORES_KS_PROFILE[prof]), '-vendor', 'apl0'] };
      }
      return { pixFmt: is4444 ? 'p410le' : 'p210le', args: ['-c:v', 'prores_videotoolbox', '-profile:v', String(PRORES_PROFILE[prof]), '-allow_sw', '1'] };
    }
    case 'dnxhr': {
      const prof = s.profile || 'sq';
      const pixFmt = prof === 'hqx' ? 'yuv422p10le' : prof === '444' ? 'yuv444p10le' : 'yuv422p';
      return { pixFmt, args: ['-c:v', 'dnxhd', '-profile:v', `dnxhr_${prof}`] };
    }
    case 'dnxhd': {
      const prof = s.profile || 'lb';
      const rate = nearestRate(probeInfo.fps.value);
      const br = (DNXHD_TABLE[prof] || DNXHD_TABLE.lb)[rate];
      return { pixFmt: prof === 'hqx' ? 'yuv422p10le' : 'yuv422p', args: ['-c:v', 'dnxhd', '-b:v', `${br}M`] };
    }
    default:
      throw new Error('Unknown codec ' + s.codec);
  }
}

function audioArgs(settings, probeInfo, container) {
  const a = probeInfo.audio || [];
  const mode = settings.audio || 'pcm_all';
  if (!a.length || mode === 'none') return { maps: [], args: ['-an'], filters: [] };
  const pcmOk = container === 'mov' || container === 'mxf';
  if (mode === 'aac_stereo') {
    if (a[0].channels >= 2 || a.length === 1) {
      return { maps: ['0:a:0'], args: ['-c:a', 'aac', '-b:a', '320k', '-ac', '2', '-ar', '48000'], filters: [] };
    }
    return {
      maps: ['[aout]'],
      filters: ['[0:a:0][0:a:1]amerge=inputs=2[aout]'],
      args: ['-c:a', 'aac', '-b:a', '320k', '-ac', '2', '-ar', '48000'],
    };
  }
  const maps = a.map((_, i) => `0:a:${i}`);
  if (mode === 'aac_all' || !pcmOk) return { maps, args: ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000'], filters: [] };
  return { maps, args: ['-c:a', container === 'mxf' ? 'pcm_s24le' : 'pcm_s24le', '-ar', '48000'], filters: [] };
}

function q(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * spec = {
 *   input, probe, output, settings,
 *   overlay: { layers: [ {type:'static', path, x, y} | {type:'digits', path, cellW, cellH, rotation, cells:[{cx,cy,yExpr}]} ] },
 *   preview: { t } (optional) -> single PNG frame
 * }
 */
function buildArgs(spec) {
  const { input, probe: p, settings } = spec;
  const container = settings.container || 'mov';
  const size = outputSize(settings, p);
  const preview = spec.preview;
  const args = ['-hide_banner', '-y', '-nostdin'];
  if (settings.hwDecode === true && ['h264', 'hevc', 'prores', 'mpeg2video', 'mpeg4', 'vp9', 'av1'].includes(p.codec)) {
    args.push('-hwaccel', 'videotoolbox');
  }
  if (preview) args.push('-ss', String(preview.t || 0));
  args.push('-i', input);

  const rate = `${p.fps.num}/${p.fps.den}`;
  const layers = (spec.overlay && spec.overlay.layers) || [];
  let inputIndex = 1;
  const graph = [];
  let cur = 'v0';
  graph.push(`[0:v]setpts=PTS-STARTPTS,${scaleChain(settings, p, size).join(',')}[v0]`);
  let step = 0;
  const offset = preview ? Math.round((preview.t || 0) * p.fps.value) : 0;
  const fnExpr = offset ? `(n+${offset})` : 'n';

  for (const L of layers) {
    if (L.type === 'static') {
      args.push('-i', L.path);
      const next = `v${++step}`;
      graph.push(`[${cur}][${inputIndex}:v]overlay=x=${Math.round(L.x)}:y=${Math.round(L.y)}:format=auto:eof_action=repeat[${next}]`);
      cur = next;
      inputIndex++;
    } else if (L.type === 'digits') {
      args.push('-loop', '1', '-framerate', rate, '-i', L.path);
      const k = L.cells.length;
      const labels = L.cells.map((_, j) => `d${inputIndex}_${j}`);
      graph.push(`[${inputIndex}:v]format=rgba,split=${k}${labels.map((l) => `[${l}]`).join('')}`);
      const rot = ((L.rotation || 0) * Math.PI) / 180;
      L.cells.forEach((c, j) => {
        const yExpr = c.yExpr.replace(/FN/g, fnExpr);
        let f = `[${labels[j]}]crop=w=${L.cellW}:h=${L.cellH}:x=0:y='${yExpr}':exact=1`;
        if (Math.abs(rot) > 1e-4) f += `,rotate=a=${rot.toFixed(6)}:ow='hypot(iw,ih)':oh=ow:c=none`;
        f += `[c${inputIndex}_${j}]`;
        graph.push(f);
        const next = `v${++step}`;
        graph.push(
          `[${cur}][c${inputIndex}_${j}]overlay=x='${c.cx.toFixed(2)}-overlay_w/2':y='${c.cy.toFixed(2)}-overlay_h/2':format=auto:shortest=1[${next}]`
        );
        cur = next;
      });
      inputIndex++;
    }
  }

  if (preview) {
    graph.push(`[${cur}]format=rgb24[vout]`);
    args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1');
    return { args, size };
  }

  const vc = videoCodecArgs(settings, p);
  graph.push(`[${cur}]format=${vc.pixFmt}[vout]`);
  const au = audioArgs(settings, p, container);
  graph.push(...au.filters);
  args.push('-filter_complex', graph.join(';'), '-map', '[vout]');
  for (const m of au.maps) args.push('-map', m);
  args.push(...vc.args, ...au.args);
  // keep the source frame rate and timecode so refs line up in the edit / sound session
  args.push('-r', rate);
  if (p.timecode && settings.keepTimecode !== false) args.push('-timecode', p.timecode);
  args.push('-map_metadata', '-1', '-metadata', 'encoder=Watermark 9000');
  if (container === 'mp4') args.push('-movflags', '+faststart');
  if (container === 'mov' && ['h264', 'h264_sw', 'h264_vt', 'hevc'].includes(settings.codec)) args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', '-stats_period', '0.25', '-nostats', '-f', container === 'mxf' ? 'mxf' : container, spec.output);
  return { args, size };
}

// ---------------------------------------------------------------------------------------------
// Running

const running = new Map(); // jobId -> child

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 10000; i++) {
    const cand = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return p;
}

function encode(spec, onProgress) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(spec.output), { recursive: true });
    if (!spec.overwrite) spec.output = uniquePath(spec.output);
    let built;
    try {
      built = buildArgs(spec);
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    if (!FFMPEG) {
      resolve({ ok: false, error: 'ffmpeg not found — reinstall Watermark 9000' });
      return;
    }
    const child = spawn(FFMPEG, built.args);
    running.set(spec.jobId, child);
    const duration = spec.duration || spec.probe.duration || 0;
    let buf = '';
    let stats = {};
    const errTail = [];
    const started = Date.now();
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        const val = line.slice(eq + 1);
        stats[key] = val;
        if (key === 'progress') {
          const outUs = parseInt(stats.out_time_us || stats.out_time_ms || '0', 10);
          const outSec = outUs > 0 ? outUs / 1e6 : 0;
          const frame = parseInt(stats.frame || '0', 10);
          const elapsed = (Date.now() - started) / 1000;
          const fps = parseFloat(stats.fps) || (elapsed > 0 ? frame / elapsed : 0);
          const progress = duration > 0 ? Math.min(1, outSec / duration) : 0;
          const speed = elapsed > 0 ? outSec / elapsed : 0;
          onProgress({ progress, frame, fps, speed, outSec, elapsed, size: parseInt(stats.total_size || '0', 10) });
          stats = {};
        }
      }
    });
    child.stderr.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      errTail.push(...lines);
      if (errTail.length > 40) errTail.splice(0, errTail.length - 40);
    });
    child.on('error', (e) => {
      running.delete(spec.jobId);
      resolve({ ok: false, error: e.message, output: spec.output });
    });
    child.on('close', (code, signal) => {
      running.delete(spec.jobId);
      if (code === 0) {
        resolve({ ok: true, output: spec.output, elapsed: (Date.now() - started) / 1000, args: built.args });
      } else {
        try {
          fs.unlinkSync(spec.output);
        } catch {}
        const cancelled = child.__cancelled || signal === 'SIGKILL' || signal === 'SIGTERM';
        const msg = errTail.filter((l) => !/^\s*(ffmpeg stats|Stream|Input|Output|Metadata|Duration|encoder|handler_name|vendor_id|timecode|major_brand|minor_version|compatible_brands|creation_time|Side data|cpb|Press)/.test(l.trim()));
        resolve({ ok: false, cancelled, error: cancelled ? 'Cancelled' : msg.slice(-6).join('\n') || `ffmpeg exited with code ${code}`, output: spec.output });
      }
    });
  });
}

function cancel(jobId) {
  const c = running.get(jobId);
  if (!c) return false;
  c.__cancelled = true;
  try {
    c.stdin && c.stdin.write('q');
  } catch {}
  c.kill('SIGTERM');
  setTimeout(() => {
    try {
      c.kill('SIGKILL');
    } catch {}
  }, 1500);
  return true;
}

function cancelAll() {
  for (const id of running.keys()) cancel(id);
}

async function previewFrame(spec) {
  const built = buildArgs(spec);
  const buf = await run(FFMPEG, built.args);
  return 'data:image/png;base64,' + buf.toString('base64');
}

module.exports = { FFMPEG, FFPROBE, ffmpegVersion, probe, thumbnail, buildArgs, encode, cancel, cancelAll, previewFrame, outputSize };
