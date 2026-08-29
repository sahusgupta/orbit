import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseProfileWorkbookRecords } from './profileWorkbookImport';

const spreadsheetMlNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const toArrayBuffer = (bytes: ArrayBuffer | Uint8Array) => {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
};

const createProfileWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Players');
  sheet.addRow(['First Name', 'Last Name', 'DOB', 'Lifetime Hours']);
  sheet.addRow(['Alice', 'Smith', new Date('1990-02-03T00:00:00.000Z'), 7.5]);
  sheet.getCell('C2').numFmt = 'yyyy-mm-dd';
  return toArrayBuffer(await workbook.xlsx.writeBuffer());
};

const prefixSpreadsheetMlElements = (xml: string) => {
  const prefixed = xml.replace(
    /<(\/?)([A-Za-z_][A-Za-z0-9_.-]*)(?=[\s/>])/g,
    '<$1x:$2'
  );
  const root = prefixed.match(/<x:[A-Za-z_][A-Za-z0-9_.-]*/)?.[0];
  if (!root) throw new Error('Expected a SpreadsheetML document root');
  return prefixed.replace(root, `${root} xmlns:x="${spreadsheetMlNamespace}"`);
};

const createNamespacePrefixedWorkbook = async () => {
  const zip = await JSZip.loadAsync(await createProfileWorkbook());
  const spreadsheetParts = /^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !spreadsheetParts.test(name)) continue;
    zip.file(name, prefixSpreadsheetMlElements(await entry.async('string')));
  }
  return toArrayBuffer(await zip.generateAsync({ type: 'uint8array' }));
};

describe('profile XLSX workbook import', () => {
  it('reads ordinary XLSX values without changing their value types', async () => {
    const records = await parseProfileWorkbookRecords(await createProfileWorkbook());

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      'First Name': 'Alice',
      'Last Name': 'Smith',
      'Lifetime Hours': 7.5
    });
    expect(records[0].DOB).toBeInstanceOf(Date);
    expect((records[0].DOB as Date).toISOString()).toBe('1990-02-03T00:00:00.000Z');
  });

  it('normalizes namespace-prefixed SpreadsheetML produced by external exporters', async () => {
    const records = await parseProfileWorkbookRecords(await createNamespacePrefixedWorkbook());

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      'First Name': 'Alice',
      'Last Name': 'Smith',
      'Lifetime Hours': 7.5
    });
    expect(records[0].DOB).toBeInstanceOf(Date);
  });

  it('replaces raw ExcelJS failures with an actionable workbook error', async () => {
    const zip = await JSZip.loadAsync(await createProfileWorkbook());
    zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><notWorksheet/>');
    const malformed = toArrayBuffer(await zip.generateAsync({ type: 'uint8array' }));

    await expect(parseProfileWorkbookRecords(malformed)).rejects.toThrow(
      'Orbit could not read this XLSX workbook. Export the player data as CSV or re-save it as an XLSX workbook, then try again.'
    );
  });

  it('rejects archives with excessive entry counts before workbook parsing', async () => {
    const zip = new JSZip();
    for (let index = 0; index < 257; index += 1) zip.file(`entry-${index}.txt`, 'x');
    const excessive = toArrayBuffer(await zip.generateAsync({ type: 'uint8array' }));

    await expect(parseProfileWorkbookRecords(excessive)).rejects.toThrow(
      'The XLSX workbook exceeds Orbit\'s safe import limits.'
    );
  });
});
