import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type PdfDestinationResult =
  | { ok: true; filePath: string }
  | { ok: false; canceled?: boolean; error?: string };

const kit = require('../../electron/selfCheckInKit.cjs') as {
  buildQrSvg: (value: string) => string;
  buildSelfCheckInPrintHtml: (input: { clubName: string; checkInUrl: string; expiresAt: string }) => string;
  createSelfCheckInPdf: (
    input: { clubName: string; checkInUrl: string; expiresAt: string },
    dependencies: Record<string, unknown>
  ) => Promise<PdfDestinationResult>;
  selectSelfCheckInPdfDestination: (
    clubName: string,
    dependencies?: Record<string, unknown>
  ) => Promise<PdfDestinationResult>;
};

const checkInUrl = 'https://api.example.test/check-in#v1.signed-capability';

const createAtomicFileSystem = (pdf: Buffer) => {
  const closeSync = vi.fn();
  const fsyncSync = vi.fn();
  const openSync = vi.fn(() => 41);
  const readFileSync = vi.fn(() => Buffer.from(pdf));
  const renameSync = vi.fn();
  const statSync = vi.fn(() => ({ size: pdf.length, isFile: () => true }));
  const unlinkSync = vi.fn();
  const writeFileSync = vi.fn();
  return {
    closeSync,
    fileSystem: { closeSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync },
    fsyncSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
  };
};

describe('club self-check-in PDF kit', () => {
  it('renders a vector QR with a quiet zone and keeps the bearer capability out of visible text', () => {
    const svg = kit.buildQrSvg(checkInUrl);
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('<path');
    expect(svg).toContain('fill="#111827"');
    expect(svg).not.toContain(checkInUrl);

    const html = kit.buildSelfCheckInPrintHtml({
      clubName: 'River & Rail <Club>',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    });
    expect(html).toContain('River &amp; Rail &lt;Club&gt;');
    expect(html).toContain('Scan to check in');
    expect(html).toContain('Enter your name exactly as it appears in the club');
    expect(html).toContain('Valid through August 24, 2027');
    expect(html).not.toContain('signed-capability');
  });

  it('prints one Letter page through a hidden sandboxed Electron window and saves the chosen PDF', async () => {
    const pdf = Buffer.from('%PDF-test');
    const atomic = createAtomicFileSystem(pdf);
    const loadURL = vi.fn(async () => undefined);
    const printToPDF = vi.fn(async () => pdf);
    const destroy = vi.fn();
    const BrowserWindow = vi.fn(function BrowserWindow(this: Record<string, unknown>) {
      this.loadURL = loadURL;
      this.webContents = { printToPDF };
      this.destroy = destroy;
    });
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf' }));

    const result = await kit.createSelfCheckInPdf({
      clubName: 'Orbit Room',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      dialog: { showSaveDialog },
      fileSystem: atomic.fileSystem,
      randomUUID: () => 'pdf-test'
    });

    const temporaryFilePath = 'C:\\safe\\.orbit-self-check-in-pdf-test.tmp';
    expect(result).toEqual({ ok: true, filePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf' });
    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: expect.objectContaining({ sandbox: true, nodeIntegration: false, contextIsolation: true })
    }));
    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/));
    expect(printToPDF).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 'Letter', printBackground: true, preferCSSPageSize: true }));
    expect(atomic.openSync).toHaveBeenCalledWith(temporaryFilePath, 'wx', 0o600);
    expect(atomic.writeFileSync).toHaveBeenCalledWith(41, pdf);
    expect(atomic.fsyncSync).toHaveBeenCalledWith(41);
    expect(atomic.closeSync).toHaveBeenCalledWith(41);
    expect(atomic.statSync).toHaveBeenCalledWith(temporaryFilePath);
    expect(atomic.readFileSync).toHaveBeenCalledWith(temporaryFilePath);
    expect(atomic.renameSync).toHaveBeenCalledWith(temporaryFilePath, 'C:\\safe\\Orbit-Room-self-check-in.pdf');
    expect(atomic.unlinkSync).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preselects a sanitized PDF destination and does not open a second dialog during creation', async () => {
    const outputFilePath = 'C:\\safe\\River-Rail-Club-self-check-in.pdf';
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: outputFilePath }));
    const selection = await kit.selectSelfCheckInPdfDestination('River & Rail <Club>', {
      dialog: { showSaveDialog }
    });

    expect(selection).toEqual({ ok: true, filePath: outputFilePath });
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'River-Rail-Club-self-check-in.pdf'
    }));
    if (!selection.ok) throw new Error('Expected the PDF destination to be selected.');

    const pdf = Buffer.from('%PDF-preselected');
    const atomic = createAtomicFileSystem(pdf);
    const printToPDF = vi.fn(async () => pdf);
    const destroy = vi.fn();
    const BrowserWindow = vi.fn(function BrowserWindow(this: Record<string, unknown>) {
      this.loadURL = vi.fn(async () => undefined);
      this.webContents = { printToPDF };
      this.destroy = destroy;
    });
    const result = await kit.createSelfCheckInPdf({
      clubName: 'River & Rail <Club>',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      dialog: { showSaveDialog },
      fileSystem: atomic.fileSystem,
      outputFilePath: selection.filePath,
      randomUUID: () => 'preselected'
    });

    expect(result).toEqual({ ok: true, filePath: outputFilePath });
    expect(showSaveDialog).toHaveBeenCalledOnce();
    expect(atomic.renameSync).toHaveBeenCalledWith(
      'C:\\safe\\.orbit-self-check-in-preselected.tmp',
      outputFilePath
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preserves an existing destination and removes the verified temp file when rename fails', async () => {
    const outputFilePath = 'C:\\safe\\Orbit-Room-self-check-in.pdf';
    const temporaryFilePath = 'C:\\safe\\.orbit-self-check-in-rename-failure.tmp';
    const priorPdf = Buffer.from('%PDF-prior-destination');
    const nextPdf = Buffer.from('%PDF-next-destination');
    const files = new Map<string, Buffer>([[outputFilePath, Buffer.from(priorPdf)]]);
    const openSync = vi.fn((filePath: string, flag: string) => {
      expect(flag).toBe('wx');
      expect(files.has(filePath)).toBe(false);
      files.set(filePath, Buffer.alloc(0));
      return 51;
    });
    const writeFileSync = vi.fn((_descriptor: number, value: Buffer) => {
      files.set(temporaryFilePath, Buffer.from(value));
    });
    const renameSync = vi.fn(() => {
      throw new Error('destination is locked');
    });
    const unlinkSync = vi.fn((filePath: string) => files.delete(filePath));
    const BrowserWindow = vi.fn(function BrowserWindow(this: Record<string, unknown>) {
      this.loadURL = vi.fn(async () => undefined);
      this.webContents = { printToPDF: vi.fn(async () => nextPdf) };
      this.destroy = vi.fn();
    });

    const result = await kit.createSelfCheckInPdf({
      clubName: 'Orbit Room',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      fileSystem: {
        closeSync: vi.fn(),
        fsyncSync: vi.fn(),
        openSync,
        readFileSync: (filePath: string) => Buffer.from(files.get(filePath) ?? []),
        renameSync,
        statSync: (filePath: string) => ({ size: files.get(filePath)?.length ?? 0, isFile: () => true }),
        unlinkSync,
        writeFileSync
      },
      outputFilePath,
      randomUUID: () => 'rename-failure'
    });

    expect(result).toEqual({ ok: false, error: 'Orbit could not create the self-check-in PDF.' });
    expect(writeFileSync).toHaveBeenCalledWith(51, nextPdf);
    expect(renameSync).toHaveBeenCalledWith(temporaryFilePath, outputFilePath);
    expect(files.get(outputFilePath)).toEqual(priorPdf);
    expect(files.has(temporaryFilePath)).toBe(false);
    expect(unlinkSync).toHaveBeenCalledWith(temporaryFilePath);
  });

  it('removes a partially written owned temp file without touching an existing destination', async () => {
    const outputFilePath = 'C:\\safe\\Orbit-Room-self-check-in.pdf';
    const temporaryFilePath = 'C:\\safe\\.orbit-self-check-in-partial-write.tmp';
    const priorPdf = Buffer.from('%PDF-prior-destination');
    const nextPdf = Buffer.from('%PDF-next-destination');
    const files = new Map<string, Buffer>([[outputFilePath, Buffer.from(priorPdf)]]);
    const writeFileSync = vi.fn((_descriptor: number, value: Buffer) => {
      files.set(temporaryFilePath, value.subarray(0, 7));
      throw new Error('disk full');
    });
    const renameSync = vi.fn();
    const unlinkSync = vi.fn((filePath: string) => files.delete(filePath));
    const BrowserWindow = vi.fn(function BrowserWindow(this: Record<string, unknown>) {
      this.loadURL = vi.fn(async () => undefined);
      this.webContents = { printToPDF: vi.fn(async () => nextPdf) };
      this.destroy = vi.fn();
    });

    const result = await kit.createSelfCheckInPdf({
      clubName: 'Orbit Room',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      fileSystem: {
        closeSync: vi.fn(),
        fsyncSync: vi.fn(),
        openSync: vi.fn((filePath: string) => {
          files.set(filePath, Buffer.alloc(0));
          return 61;
        }),
        readFileSync: vi.fn(),
        renameSync,
        statSync: vi.fn(),
        unlinkSync,
        writeFileSync
      },
      outputFilePath,
      randomUUID: () => 'partial-write'
    });

    expect(result).toEqual({ ok: false, error: 'Orbit could not create the self-check-in PDF.' });
    expect(files.get(outputFilePath)).toEqual(priorPdf);
    expect(files.has(temporaryFilePath)).toBe(false);
    expect(unlinkSync).toHaveBeenCalledWith(temporaryFilePath);
    expect(renameSync).not.toHaveBeenCalled();
  });

  it('rejects an invalid preselected destination before opening a dialog or print window', async () => {
    const BrowserWindow = vi.fn();
    const showSaveDialog = vi.fn();
    const result = await kit.createSelfCheckInPdf({
      clubName: 'Orbit Room',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      dialog: { showSaveDialog },
      fileSystem: { writeFileSync: vi.fn() },
      outputFilePath: 'relative-output.pdf'
    });

    expect(result).toEqual({ ok: false, error: 'The PDF destination must be an absolute .pdf path.' });
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it('does not create a window when the save dialog is canceled', async () => {
    const BrowserWindow = vi.fn();
    const result = await kit.createSelfCheckInPdf({
      clubName: 'Orbit Room',
      checkInUrl,
      expiresAt: '2027-08-24T12:00:00.000Z'
    }, {
      BrowserWindow,
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      fileSystem: { writeFileSync: vi.fn() }
    });
    expect(result).toEqual({ ok: false, canceled: true });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
});
