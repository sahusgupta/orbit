const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tableManagerDesktop', {
  platform: process.platform,
  isDesktop: true,
  openWindow: (route, context) => ipcRenderer.invoke('open-route-window', route, context),
  loadState: () => ipcRenderer.invoke('load-state'),
  loadStateForAccount: (access) => ipcRenderer.invoke('load-state-for-account', access),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  preserveStateForUpdate: (requestId, state) => ipcRenderer.invoke('preserve-state-for-update', requestId, state),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  installDownloadedUpdate: () => ipcRenderer.invoke('install-downloaded-update'),
  onPrepareForUpdate: (callback) => {
    const listener = (_event, requestId) => callback(requestId);
    ipcRenderer.on('prepare-for-update', listener);
    return () => ipcRenderer.removeListener('prepare-for-update', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  validatePilotAccess: (access) => ipcRenderer.invoke('validate-pilot-access', access),
  verifyStaffPin: (payload) => ipcRenderer.invoke('verify-staff-pin', payload),
  authorizeStaffAction: (payload) => ipcRenderer.invoke('authorize-staff-action', payload),
  submitAnalyticalReport: (report) => ipcRenderer.invoke('submit-analytical-report', report),
  sendTextMessages: (payload, staffToken) => ipcRenderer.invoke('send-text-messages', payload, staffToken),
  recordClientEvent: (event, category, details, route) => ipcRenderer.invoke('record-client-event', event, category, details, route),
  recordClientError: (payload) => ipcRenderer.invoke('record-client-error', payload)
});
