const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('wm', {
  openFiles: invoke('dialog:openFiles'),
  openImage: invoke('dialog:openImage'),
  chooseFolder: invoke('dialog:chooseFolder'),
  exportJson: invoke('dialog:exportJson'),
  importJson: invoke('dialog:importJson'),
  probe: invoke('media:probe'),
  thumb: invoke('media:thumb'),
  expandPaths: invoke('fs:expandPaths'),
  exists: invoke('fs:exists'),
  load: invoke('store:load'),
  save: invoke('store:save'),
  importAsset: invoke('asset:import'),
  readAsset: invoke('asset:read'),
  writeOverlay: invoke('overlay:write'),
  cleanOverlay: invoke('overlay:clean'),
  encode: invoke('encode:start'),
  cancel: invoke('encode:cancel'),
  cancelAll: invoke('encode:cancelAll'),
  previewFrame: invoke('encode:preview'),
  buildArgs: invoke('encode:args'),
  outputSize: invoke('encode:outputSize'),
  reveal: invoke('shell:reveal'),
  open: invoke('shell:open'),
  info: invoke('app:info'),
  queueState: invoke('app:queueState'),
  notify: invoke('app:notify'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (cb) => {
    const h = (e, p) => cb(p);
    ipcRenderer.on('encode:progress', h);
    return () => ipcRenderer.removeListener('encode:progress', h);
  },
});
