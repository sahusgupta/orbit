import { describe, expect, it } from 'vitest';
import { validateLocalImport } from './fileImportValidation';

describe('local import validation', () => {
  it('checks file size before reading and rejects extension/MIME mismatches', async () => {
    const oversized = {
      name: 'profiles.csv',
      size: 5 * 1024 * 1024 + 1,
      type: 'text/csv',
      slice: () => { throw new Error('must not read'); }
    } as unknown as File;
    await expect(validateLocalImport(oversized, 'profile-csv')).rejects.toThrow('exceeds');
    await expect(validateLocalImport(new File(['name,email'], 'profiles.exe', { type: 'text/csv' }), 'profile-csv')).rejects.toThrow('Allowed file types');
    await expect(validateLocalImport(new File(['name,email'], 'profiles.csv', { type: 'image/png' }), 'profile-csv')).rejects.toThrow('content type');
  });

  it('recognizes JSON objects, text CSV, and ZIP-based XLSX signatures', async () => {
    await expect(validateLocalImport(new File(['{"state":{}}'], 'backup.json', { type: 'application/json' }), 'backup-json')).resolves.toBeUndefined();
    await expect(validateLocalImport(new File(['[]'], 'backup.json', { type: 'application/json' }), 'backup-json')).rejects.toThrow('JSON object');
    await expect(validateLocalImport(new File(['name,email\nAlex,alex@example.com'], 'profiles.csv', { type: 'text/csv' }), 'profile-csv')).resolves.toBeUndefined();
    await expect(validateLocalImport(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'profiles.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'profile-xlsx')).resolves.toBeUndefined();
    await expect(validateLocalImport(new File(['not a zip'], 'profiles.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'profile-xlsx')).rejects.toThrow('XLSX signature');
  });

  it('accepts bounded government ID images only when their extension, MIME, and signature agree', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'license.jpg', { type: 'image/jpeg' });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'license.png', { type: 'image/png' });
    const webp = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], 'license.webp', { type: 'image/webp' });

    await expect(validateLocalImport(jpeg, 'government-id-image')).resolves.toBeUndefined();
    await expect(validateLocalImport(png, 'government-id-image')).resolves.toBeUndefined();
    await expect(validateLocalImport(webp, 'government-id-image')).resolves.toBeUndefined();
    await expect(validateLocalImport(new File(['not an image'], 'license.png', { type: 'image/png' }), 'government-id-image'))
      .rejects.toThrow('valid JPEG, PNG, or WebP');
    await expect(validateLocalImport(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'license.png', { type: 'image/png' }), 'government-id-image'))
      .rejects.toThrow('valid JPEG, PNG, or WebP');
    await expect(validateLocalImport(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'license.pdf', { type: 'image/jpeg' }), 'government-id-image'))
      .rejects.toThrow('Allowed file types');
  });

  it('rejects an oversized government ID image before reading it', async () => {
    const oversized = {
      name: 'license.jpg',
      size: 12 * 1024 * 1024 + 1,
      type: 'image/jpeg',
      slice: () => { throw new Error('must not read'); }
    } as unknown as File;

    await expect(validateLocalImport(oversized, 'government-id-image')).rejects.toThrow('12 MB limit');
  });
});
