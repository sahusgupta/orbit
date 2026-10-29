const { contextBridge, ipcRenderer } = require('electron');
let nextManagementStateSubscription = 0;
// Correlation only; authentication remains in main. Reloads must not reuse IDs
// while an older document's unsubscribe IPC may still be in flight.
const managementStateContext = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

contextBridge.exposeInMainWorld('tableManagerDesktop', {
  platform: process.platform,
  isDesktop: true,
  openWindow: (route, context) => ipcRenderer.invoke('open-route-window', route, context),
  loadState: () => ipcRenderer.invoke('load-state'),
  loadStateForAccount: (access) => ipcRenderer.invoke('load-state-for-account', access),
  subscribeToManagementState: (access, callback) => {
    if (typeof callback !== 'function') throw new Error('A management state callback is required.');
    const subscriptionId = `management-${managementStateContext}-${++nextManagementStateSubscription}`;
    let disposed = false;
    const listener = (_event, eventId, value) => {
      if (disposed || eventId !== subscriptionId || !value || typeof value !== 'object' || Array.isArray(value)) return;
      if (value.type === 'change' && Number.isSafeInteger(value.revision) && value.revision >= 0) {
        callback({ type: 'change', revision: value.revision });
      } else if (value.type === 'status' && typeof value.connected === 'boolean') {
        callback({ type: 'status', connected: value.connected });
      }
    };
    ipcRenderer.on('management-state-event', listener);
    void ipcRenderer.invoke('subscribe-management-state', subscriptionId, access).catch(() => {
      if (!disposed) callback({ type: 'status', connected: false });
    });
    return () => {
      if (disposed) return;
      disposed = true;
      ipcRenderer.removeListener('management-state-event', listener);
      void ipcRenderer.invoke('unsubscribe-management-state', subscriptionId).catch(() => undefined);
    };
  },
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
  getManagementRecoveryStatus: (access) => ipcRenderer.invoke('get-management-recovery-status', access),
  completeManagementRecovery: (payload) => ipcRenderer.invoke('complete-management-recovery', payload),
  generateSelfCheckInKit: (payload) => ipcRenderer.invoke('generate-self-check-in-kit', payload),
  redeemMembershipQr: (payload) => ipcRenderer.invoke('redeem-membership-qr', payload),
  persistManagementSession: (binding) => ipcRenderer.invoke('persist-management-session', binding),
  restoreManagementSession: (binding) => ipcRenderer.invoke('restore-management-session', binding),
  clearManagementSession: (accountKey) => ipcRenderer.invoke('clear-management-session', accountKey),
  verifyStaffPin: (payload) => ipcRenderer.invoke('verify-staff-pin', payload),
  authorizeStaffAction: (payload) => ipcRenderer.invoke('authorize-staff-action', payload),
  submitAnalyticalReport: (report) => ipcRenderer.invoke('submit-analytical-report', report),
  sendTextMessages: (payload, staffToken) => ipcRenderer.invoke('send-text-messages', payload, staffToken),
  recordClientEvent: (event, category, details, route) => ipcRenderer.invoke('record-client-event', event, category, details, route),
  recordClientError: (payload) => ipcRenderer.invoke('record-client-error', payload)
});
