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
});
