const path = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, session } = require('electron');

const userData = process.env.ORBIT_OCR_SMOKE_USER_DATA_DIR;
if (!userData || !path.isAbsolute(userData) || path.dirname(path.resolve(userData)) !== path.resolve(tmpdir())
  || !path.basename(userData).startsWith('orbit-ocr-file-smoke-')) throw new Error('Isolated OCR fixture profile required.');
app.setPath('userData', path.resolve(userData));

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
