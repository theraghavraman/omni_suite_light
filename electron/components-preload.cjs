/**
 * OmniConverter Studio — Component Manager preload (electron/components-preload.cjs)
 * Narrow IPC surface for electron/components.html; no Node primitives are exposed.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omniComponents', Object.freeze({
  list: () => ipcRenderer.invoke('omni-components:list'),
  install: (ids) => ipcRenderer.invoke('omni-components:install', Array.isArray(ids) ? ids.map(String) : []),
  cancel: (id) => ipcRenderer.invoke('omni-components:cancel', String(id)),
  remove: (id) => ipcRenderer.invoke('omni-components:remove', String(id)),
  finish: () => ipcRenderer.invoke('omni-components:finish'),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('omni-components:progress', listener);
    return () => ipcRenderer.removeListener('omni-components:progress', listener);
  },
}));
