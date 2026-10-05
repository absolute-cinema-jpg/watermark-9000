const { app, BrowserWindow, ipcMain, dialog, shell, Notification, powerSaveBlocker, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const engine = require('./ffmpeg.cjs');

app.setName('Watermark 9000');

let win = null;
let blockerId = null;
const USER = app.getPath('userData');
const STORE_DIR = path.join(USER, 'store');
const ASSET_DIR = path.join(USER, 'assets');
const TMP_DIR = path.join(os.tmpdir(), 'watermark-9000');
for (const d of [STORE_DIR, ASSET_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: Math.min(1760, wa.width),
    height: Math.min(1100, wa.height),
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#141417',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // the queue must keep running while the window is hidden behind Avid / Pro Tools
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  // Allow the renderer to enumerate locally installed fonts (Local Font Access API).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (!app.isPackaged && app.dock && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine.cancelAll();
  app.quit();
});

app.on('before-quit', () => engine.cancelAll());

const send = (ch, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
};

// ---------------------------------------------------------------------------------------------
// IPC

const VIDEO_EXT = ['mov', 'mp4', 'm4v', 'mxf', 'mkv', 'avi', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'webm', 'r3d', 'braw', 'dv', 'flv', 'wmv', '3gp', 'y4m'];

ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import Media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video', extensions: VIDEO_EXT },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:openImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose Image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'tif', 'tiff', 'bmp'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:chooseFolder', async (e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose Destination',
    defaultPath: defaultPath || app.getPath('videos'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:exportJson', async (e, { name, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'Preset', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('dialog:importJson', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Preset', extensions: ['json'] }] });
  if (r.canceled) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
});

ipcMain.handle('media:probe', async (e, file) => engine.probe(file));
ipcMain.handle('media:thumb', async (e, file, t, width) => engine.thumbnail(file, t, width));

ipcMain.handle('fs:expandPaths', async (e, paths) => {
  // Expand dropped folders into the video files they contain (one level + recursive).
  const out = [];
  const walk = (p, depth) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      if (depth > 4) return;
      for (const f of fs.readdirSync(p).sort()) if (!f.startsWith('.')) walk(path.join(p, f), depth + 1);
    } else if (VIDEO_EXT.includes(path.extname(p).slice(1).toLowerCase())) out.push(p);
  };
  for (const p of paths) walk(p, 0);
  return out;
});

ipcMain.handle('fs:exists', (e, p) => fs.existsSync(p));

ipcMain.handle('store:load', (e, name) => {
  const f = path.join(STORE_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:save', (e, name, data) => {
  const f = path.join(STORE_DIR, `${name}.json`);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
  return true;
});

ipcMain.handle('asset:import', (e, src) => {
  const ext = path.extname(src).toLowerCase();
  const hash = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 12);
  const dest = path.join(ASSET_DIR, `${path.basename(src, ext).replace(/[^\w.-]+/g, '_')}_${hash}${ext}`);
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  return dest;
});

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
ipcMain.handle('asset:read', (e, p) => {
  try {
    const mime = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  } catch {
    return null;
  }
});

// Overlay layers are rendered by the renderer (canvas) and written here as PNGs.
ipcMain.handle('overlay:write', (e, jobId, files) => {
  const dir = path.join(TMP_DIR, String(jobId));
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    const p = path.join(dir, f.name);
    fs.writeFileSync(p, Buffer.from(f.data));
    return p;
  });
});

ipcMain.handle('overlay:clean', (e, jobId) => {
  try {
    fs.rmSync(path.join(TMP_DIR, String(jobId)), { recursive: true, force: true });
  } catch {}
  return true;
});

ipcMain.handle('encode:start', async (e, spec) => {
  const res = await engine.encode(spec, (p) => send('encode:progress', { jobId: spec.jobId, ...p }));
  return res;
});

ipcMain.handle('encode:cancel', (e, jobId) => engine.cancel(jobId));
ipcMain.handle('encode:cancelAll', () => engine.cancelAll());
ipcMain.handle('encode:preview', async (e, spec) => engine.previewFrame(spec));
ipcMain.handle('encode:args', (e, spec) => engine.buildArgs(spec).args);
ipcMain.handle('encode:outputSize', (e, settings, probe) => engine.outputSize(settings, probe));

ipcMain.handle('shell:reveal', (e, p) => {
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(path.dirname(p));
});
ipcMain.handle('shell:open', (e, p) => shell.openPath(p));

ipcMain.handle('app:info', () => ({
  ffmpeg: engine.FFMPEG,
  ffprobe: engine.FFPROBE,
  ffmpegVersion: engine.ffmpegVersion(),
  cpus: os.cpus().length,
  cpuModel: os.cpus()[0] && os.cpus()[0].model,
  movies: app.getPath('videos'),
  desktop: app.getPath('desktop'),
  user: os.userInfo().username,
  version: app.getVersion(),
}));

ipcMain.handle('app:queueState', (e, { running, progress, remaining }) => {
  if (!win) return;
  if (running) {
    if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
    win.setProgressBar(Math.max(0.001, Math.min(1, progress || 0)));
    if (app.dock) app.dock.setBadge(remaining ? String(remaining) : '');
  } else {
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    win.setProgressBar(-1);
    if (app.dock) app.dock.setBadge('');
  }
});

ipcMain.handle('app:notify', (e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  if (app.dock && win && !win.isFocused()) app.dock.bounce('informational');
});
