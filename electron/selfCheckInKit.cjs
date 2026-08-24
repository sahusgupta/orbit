const fileSystemDefault = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  BarcodeFormat,
  EncodeHintType,
  QRCodeWriter
} = require('@zxing/library');

const quietZoneModules = 4;
const maximumClubNameLength = 120;
const maximumCheckInUrlLength = 4096;
const maximumOutputFilePathLength = 4096;
const maximumTemporaryFileAttempts = 8;

class SelfCheckInInputError extends Error {}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function normalizeClubName(value) {
  if (typeof value !== 'string') {
    throw new SelfCheckInInputError('A club name is required.');
  }
  if (hasControlCharacters(value)) {
    throw new SelfCheckInInputError('The club name is invalid.');
  }

  const clubName = value.normalize('NFC').trim();
  if (!clubName || clubName.length > maximumClubNameLength) {
    throw new SelfCheckInInputError('The club name is invalid.');
  }
  return clubName;
}

function normalizeCheckInUrl(value) {
  if (typeof value !== 'string') {
    throw new SelfCheckInInputError('A self-check-in URL is required.');
  }
  if (hasControlCharacters(value)) {
    throw new SelfCheckInInputError('The self-check-in URL is invalid.');
  }

  const checkInUrl = value.trim();
  if (!checkInUrl || checkInUrl.length > maximumCheckInUrlLength || /\s/u.test(checkInUrl)) {
    throw new SelfCheckInInputError('The self-check-in URL is invalid.');
  }

  let parsed;
  try {
    parsed = new URL(checkInUrl);
  } catch {
    throw new SelfCheckInInputError('The self-check-in URL is invalid.');
  }

  const isLoopbackHttp = parsed.protocol === 'http:' && (
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]'
  );
  if ((parsed.protocol !== 'https:' && !isLoopbackHttp) || parsed.username || parsed.password) {
    throw new SelfCheckInInputError('The self-check-in URL is invalid.');
  }
  if (!parsed.hash || parsed.hash === '#') {
    throw new SelfCheckInInputError('The self-check-in URL has no capability.');
  }

  return checkInUrl;
}

function normalizeExpiry(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64 || hasControlCharacters(value)) {
    throw new SelfCheckInInputError('The self-check-in expiration is invalid.');
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new SelfCheckInInputError('The self-check-in expiration is invalid.');
  }
  return new Date(timestamp);
}

function normalizePrintInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SelfCheckInInputError('Self-check-in PDF details are required.');
  }

  return {
    clubName: normalizeClubName(input.clubName),
    checkInUrl: normalizeCheckInUrl(input.checkInUrl),
    expiresAt: normalizeExpiry(input.expiresAt)
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildQrSvg(value) {
  const checkInUrl = normalizeCheckInUrl(value);
  /** @type {Map<import('@zxing/library').EncodeHintType, unknown>} */
  const hints = new Map();
  hints.set(EncodeHintType.CHARACTER_SET, 'UTF-8');
  hints.set(EncodeHintType.ERROR_CORRECTION, 'M');
  hints.set(EncodeHintType.MARGIN, quietZoneModules);
  const matrix = new QRCodeWriter().encode(
    checkInUrl,
    BarcodeFormat.QR_CODE,
    0,
    0,
    hints
  );
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const pathSegments = [];

  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!matrix.get(x, y)) {
        x += 1;
        continue;
      }

      const runStart = x;
      while (x < width && matrix.get(x, y)) x += 1;
      pathSegments.push(`M${runStart} ${y}h${x - runStart}v1H${runStart}z`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Self-check-in QR code" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#ffffff"/><path d="${pathSegments.join('')}" fill="#111827"/></svg>`;
}

function formatExpiryDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric'
  }).format(date);
}

function buildSelfCheckInPrintHtml(input) {
  const normalized = normalizePrintInput(input);
  const clubName = escapeHtml(normalized.clubName);
  const expiryDate = escapeHtml(formatExpiryDate(normalized.expiresAt));
  const qrSvg = buildQrSvg(normalized.checkInUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orbit self-check-in</title>
  <style>
    @page { size: Letter portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 8.5in; height: 11in; margin: 0; padding: 0; }
    body {
      overflow: hidden;
      background: #f8fafc;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      align-items: center;
      background: linear-gradient(155deg, #ffffff 0%, #f8fafc 72%, #e2e8f0 100%);
      display: flex;
      flex-direction: column;
      height: 11in;
      justify-content: space-between;
      overflow: hidden;
      padding: 0.58in 0.68in 0.48in;
      text-align: center;
      width: 8.5in;
    }
    .brand {
      color: #475569;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.18em;
      margin: 0 0 10px;
      text-transform: uppercase;
    }
    h1 { font-size: 34px; line-height: 1.08; margin: 0; }
    .club {
      color: #334155;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.25;
      margin: 10px auto 0;
      max-width: 6.7in;
      overflow-wrap: anywhere;
    }
    .qr-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 24px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      margin: 0.22in 0 0.16in;
      padding: 0.23in;
    }
    .qr-card svg { display: block; height: 4.65in; width: 4.65in; }
    .instructions { margin: 0; max-width: 6.4in; }
    .instructions strong { display: block; font-size: 21px; line-height: 1.3; }
    .instructions span {
      color: #475569;
      display: block;
      font-size: 16px;
      line-height: 1.45;
      margin-top: 6px;
    }
    .validity {
      background: #e2e8f0;
      border-radius: 999px;
      color: #334155;
      display: inline-block;
      font-size: 13px;
      font-weight: 700;
      margin-top: 14px;
      padding: 7px 14px;
    }
    footer { color: #64748b; font-size: 11px; line-height: 1.4; }
  </style>
</head>
<body>
  <main class="sheet">
    <header>
      <p class="brand">Orbit</p>
      <h1>Scan to check in</h1>
      <p class="club">${clubName}</p>
    </header>
    <section class="qr-card" aria-label="Self-check-in code">${qrSvg}</section>
    <section class="instructions">
      <strong>Open your camera and scan the code</strong>
      <span>Enter your name exactly as it appears in the club, then choose from the tables with space available.</span>
      <div class="validity">Valid through ${expiryDate}</div>
    </section>
    <footer>Need help? Ask a member of the club staff.</footer>
  </main>
</body>
</html>`;
}

function buildDefaultFilename(clubName) {
  const baseName = clubName
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '') || 'Orbit-Club';
  return `${baseName}-self-check-in.pdf`;
}

function normalizeOutputFilePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > maximumOutputFilePathLength ||
    hasControlCharacters(value)
  ) {
    throw new SelfCheckInInputError('The PDF destination is invalid.');
  }

  const isAbsolute = path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
  if (!isAbsolute || !/\.pdf$/iu.test(value)) {
    throw new SelfCheckInInputError('The PDF destination must be an absolute .pdf path.');
  }
  return value;
}

function getSuppliedDependencies(dependencies) {
  return dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)
    ? dependencies
    : {};
}

function resolveDialog(dependencies) {
  const supplied = getSuppliedDependencies(dependencies);
  const dialog = supplied.dialog || require('electron')?.dialog;
  if (typeof dialog?.showSaveDialog !== 'function') {
    throw new Error('The self-check-in PDF destination picker is unavailable.');
  }
  return dialog;
}

function resolvePdfCreationDependencies(dependencies) {
  const supplied = getSuppliedDependencies(dependencies);
  let electron;
  if (!supplied.BrowserWindow) {
    electron = require('electron');
  }

  const BrowserWindow = supplied.BrowserWindow || electron?.BrowserWindow;
  const fileSystem = supplied.fileSystem || fileSystemDefault;
  const randomUUID = supplied.randomUUID || crypto.randomUUID;
  if (
    typeof BrowserWindow !== 'function' ||
    typeof randomUUID !== 'function' ||
    typeof fileSystem?.closeSync !== 'function' ||
    typeof fileSystem?.fsyncSync !== 'function' ||
    typeof fileSystem?.openSync !== 'function' ||
    typeof fileSystem?.readFileSync !== 'function' ||
    typeof fileSystem?.renameSync !== 'function' ||
    typeof fileSystem?.statSync !== 'function' ||
    typeof fileSystem?.unlinkSync !== 'function' ||
    typeof fileSystem?.writeFileSync !== 'function'
  ) {
    throw new Error('Self-check-in PDF services are unavailable.');
  }
  return { BrowserWindow, fileSystem, randomUUID };
}

function buildSaveDialogOptions(clubName) {
  return {
    buttonLabel: 'Save PDF',
    defaultPath: buildDefaultFilename(clubName),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    title: 'Save club self-check-in QR code'
  };
}

async function promptForSelfCheckInPdfDestination(clubName, dependencies) {
  const normalizedClubName = normalizeClubName(clubName);
  const dialog = resolveDialog(dependencies);
  const saveResult = await dialog.showSaveDialog(buildSaveDialogOptions(normalizedClubName));
  if (saveResult?.canceled || typeof saveResult?.filePath !== 'string' || !saveResult.filePath.trim()) {
    return { ok: false, canceled: true };
  }
  return { ok: true, filePath: saveResult.filePath };
}

async function selectSelfCheckInPdfDestination(clubName, dependencies = {}) {
  try {
    const selection = await promptForSelfCheckInPdfDestination(clubName, dependencies);
    if (!selection.ok) return selection;
    return { ok: true, filePath: normalizeOutputFilePath(selection.filePath) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof SelfCheckInInputError
        ? error.message
        : 'Orbit could not choose the self-check-in PDF destination.'
    };
  }
}

function destroyPrintWindow(printWindow) {
  if (!printWindow || typeof printWindow.destroy !== 'function') return;
  try {
    if (typeof printWindow.isDestroyed !== 'function' || !printWindow.isDestroyed()) {
      printWindow.destroy();
    }
  } catch {
    // PDF creation has already succeeded or failed; cleanup must not replace that result.
  }
}

function outputPathImplementation(outputFilePath) {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/u.test(outputFilePath) || outputFilePath.startsWith('\\\\');
  return isWindowsPath ? path.win32 : path.posix;
}

function temporaryFileToken(value) {
  const token = String(value || '').replace(/[^a-zA-Z0-9_-]+/gu, '').slice(0, 80);
  if (!token) throw new Error('A unique PDF temporary file name could not be created.');
  return token;
}

function openTemporaryPdfFile(outputFilePath, fileSystem, randomUUID) {
  const pathImplementation = outputPathImplementation(outputFilePath);
  const outputDirectory = pathImplementation.dirname(outputFilePath);
  for (let attempt = 0; attempt < maximumTemporaryFileAttempts; attempt += 1) {
    const token = temporaryFileToken(randomUUID());
    const attemptSuffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const temporaryFilePath = pathImplementation.join(
      outputDirectory,
      `.orbit-self-check-in-${token}${attemptSuffix}.tmp`
    );
    try {
      const descriptor = fileSystem.openSync(temporaryFilePath, 'wx', 0o600);
      return { descriptor, temporaryFilePath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('A unique PDF temporary file could not be created.');
}

function writeAndVerifyTemporaryPdf(outputFilePath, pdf, fileSystem, randomUUID) {
  const opened = openTemporaryPdfFile(outputFilePath, fileSystem, randomUUID);
  try {
    let closeError;
    try {
      fileSystem.writeFileSync(opened.descriptor, pdf);
      fileSystem.fsyncSync(opened.descriptor);
    } finally {
      try {
        fileSystem.closeSync(opened.descriptor);
      } catch (error) {
        closeError = error;
      }
    }
    if (closeError) throw closeError;

    const statistics = fileSystem.statSync(opened.temporaryFilePath);
    const written = fileSystem.readFileSync(opened.temporaryFilePath);
    if (
      !statistics ||
      statistics.size !== pdf.length ||
      (typeof statistics.isFile === 'function' && !statistics.isFile()) ||
      !Buffer.isBuffer(written) ||
      written.length !== pdf.length ||
      written.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !written.equals(pdf)
    ) {
      throw new Error('The temporary PDF did not pass verification.');
    }
    return opened.temporaryFilePath;
  } catch (error) {
    removeTemporaryPdf(fileSystem, opened.temporaryFilePath);
    throw error;
  }
}

function removeTemporaryPdf(fileSystem, temporaryFilePath) {
  if (!fileSystem || !temporaryFilePath || typeof fileSystem.unlinkSync !== 'function') return;
  try {
    fileSystem.unlinkSync(temporaryFilePath);
  } catch {
    // Cleanup is best-effort and must not replace the original PDF result.
  }
}

async function createSelfCheckInPdf(input, dependencies = {}) {
  let printWindow;
  let resolvedFileSystem;
  let temporaryFilePath;
  try {
    const normalized = normalizePrintInput(input);
    const supplied = getSuppliedDependencies(dependencies);
    let outputFilePath;
    if (supplied.outputFilePath === undefined) {
      const selection = await promptForSelfCheckInPdfDestination(normalized.clubName, supplied);
      if (!selection.ok) return selection;
      outputFilePath = selection.filePath;
    } else {
      outputFilePath = normalizeOutputFilePath(supplied.outputFilePath);
    }
    const { BrowserWindow, fileSystem, randomUUID } = resolvePdfCreationDependencies(supplied);
    resolvedFileSystem = fileSystem;

    const html = buildSelfCheckInPrintHtml(input);
    printWindow = new BrowserWindow({
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      height: 1056,
      show: false,
      webPreferences: {
        contextIsolation: true,
        javascript: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true
      },
      width: 816
    });

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await printWindow.webContents.printToPDF({
      displayHeaderFooter: false,
      landscape: false,
      margins: { bottom: 0, left: 0, right: 0, top: 0 },
      pageSize: 'Letter',
      preferCSSPageSize: true,
      printBackground: true
    });
    if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Electron did not create a PDF document.');
    }

    temporaryFilePath = writeAndVerifyTemporaryPdf(outputFilePath, pdf, fileSystem, randomUUID);
    fileSystem.renameSync(temporaryFilePath, outputFilePath);
    temporaryFilePath = undefined;
    return { ok: true, filePath: outputFilePath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof SelfCheckInInputError
        ? error.message
        : 'Orbit could not create the self-check-in PDF.'
    };
  } finally {
    removeTemporaryPdf(resolvedFileSystem, temporaryFilePath);
    destroyPrintWindow(printWindow);
  }
}

module.exports = {
  buildQrSvg,
  buildSelfCheckInPrintHtml,
  createSelfCheckInPdf,
  selectSelfCheckInPdfDestination
};
