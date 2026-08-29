const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

globalThis.__orbitBlockedOcrRequests = 0;
let mainWindow;

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => {
      globalThis.__orbitBlockedOcrRequests += 1;
      callback({ cancel: true });
    }
  );

  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('closed', () => { mainWindow = undefined; });
  await mainWindow.loadFile(path.join(__dirname, 'ocr-file-smoke.html'));
});

app.on('window-all-closed', () => app.quit());
