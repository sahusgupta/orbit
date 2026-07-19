const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tableManagerDesktop', {
  platform: process.platform,
  isDesktop: true,
  openWindow: (route, context) => ipcRenderer.invoke('open-route-window', route, context),
  loadState: () => ipcRenderer.invoke('load-state'),
  loadStateForAccount: (access) => ipcRenderer.invoke('load-state-for-account', access),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  submitAnalyticalReport: (report) => ipcRenderer.invoke('submit-analytical-report', report),
  sendTextMessages: (payload) => ipcRenderer.invoke('send-text-messages', payload),
  recordClientEvent: (event, category, details, route) => ipcRenderer.invoke('record-client-event', event, category, details, route),
  recordClientError: (payload) => ipcRenderer.invoke('record-client-error', payload)
});
