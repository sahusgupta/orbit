const SPREADSHEETML_NAMESPACE_URIS = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main'
]);

const MAX_ARCHIVE_ENTRIES = 256;
const MAX_XML_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_OTHER_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_WORKSHEET_COLUMNS = 256;
const MAX_WORKSHEET_DATA_ROWS = 50_000;

const UNREADABLE_WORKBOOK_MESSAGE =
  'Orbit could not read this XLSX workbook. Export the player data as CSV or re-save it as an XLSX workbook, then try again.';
const WORKBOOK_LIMIT_MESSAGE = 'The XLSX workbook exceeds Orbit\'s safe import limits.';

type ZipStream = {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'end', callback: () => void): ZipStream;
  on(event: 'error', callback: (error: Error) => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
};

type ZipEntry = {
  name: string;
  dir: boolean;
  unsafeOriginalName?: string;
};

type ImportBudget = { uncompressedBytes: number };

export class ProfileWorkbookImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileWorkbookImportError';
  }
}

const workbookLimitError = () => new ProfileWorkbookImportError(WORKBOOK_LIMIT_MESSAGE);
const unreadableWorkbookError = () => new ProfileWorkbookImportError(UNREADABLE_WORKBOOK_MESSAGE);

const readEntryWithinLimit = (
  entry: ZipEntry,
  budget: ImportBudget,
  maximumEntryBytes: number,
  collect: boolean
) => new Promise<Uint8Array | null>((resolve, reject) => {
  const chunks: Uint8Array[] = [];
  let entryBytes = 0;
  let settled = false;
  const internalStream = Reflect.get(entry, 'internalStream');
  if (typeof internalStream !== 'function') {
    reject(unreadableWorkbookError());
    return;
  }
  const streamValue: unknown = Reflect.apply(internalStream, entry, ['uint8array']);
  if (
    typeof streamValue !== 'object' ||
    streamValue === null ||
    typeof Reflect.get(streamValue, 'on') !== 'function' ||
    typeof Reflect.get(streamValue, 'pause') !== 'function' ||
    typeof Reflect.get(streamValue, 'resume') !== 'function'
  ) {
    reject(unreadableWorkbookError());
    return;
  }
  const stream = streamValue as ZipStream;

  const rejectOnce = (error: Error) => {
    if (settled) return;
    settled = true;
    stream.pause();
    reject(error);
  };

  stream
    .on('data', (chunk) => {
      if (settled) return;
      if (
        entryBytes + chunk.byteLength > maximumEntryBytes ||
        budget.uncompressedBytes + chunk.byteLength > MAX_TOTAL_UNCOMPRESSED_BYTES
      ) {
        rejectOnce(workbookLimitError());
        return;
      }
      entryBytes += chunk.byteLength;
      budget.uncompressedBytes += chunk.byteLength;
      if (collect) chunks.push(chunk.slice());
    })
    .on('error', (error) => rejectOnce(error))
    .on('end', () => {
      if (settled) return;
      settled = true;
      if (!collect) {
        resolve(null);
        return;
      }
      const bytes = new Uint8Array(entryBytes);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      resolve(bytes);
    })
    .resume();
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSpreadsheetMlElementPrefixes = (xml: string) => {
  const namespaceDeclarations = /\bxmlns:([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(["'])([^"']+)\2/g;
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(namespaceDeclarations)) {
    if (SPREADSHEETML_NAMESPACE_URIS.has(match[3])) prefixes.add(match[1]);
  }

  let normalized = xml;
  prefixes.forEach((prefix) => {
    const elementPrefix = new RegExp(`<(\\/?)${escapeRegExp(prefix)}:(?=[A-Za-z_])`, 'g');
    normalized = normalized.replace(elementPrefix, '<$1');
  });
  return normalized;
};

const toArrayBuffer = (bytes: Uint8Array) => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const preflightAndNormalizeWorkbook = async (buffer: ArrayBuffer) => {
  const jsZipModule = await import('jszip');
  let zip: Awaited<ReturnType<typeof jsZipModule.default.loadAsync>>;
  try {
    zip = await jsZipModule.default.loadAsync(buffer);
  } catch {
    throw unreadableWorkbookError();
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw workbookLimitError();

  const budget: ImportBudget = { uncompressedBytes: 0 };
  let normalizedPartCount = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw workbookLimitError();

    const archivePath = entry.name.replace(/^\/+/, '');
    const isSpreadsheetXml = /^xl\/(?:.*\/)?[^/]+\.xml$/.test(archivePath);
    const bytes = await readEntryWithinLimit(
      entry,
      budget,
      isSpreadsheetXml ? MAX_XML_ENTRY_BYTES : MAX_OTHER_ENTRY_BYTES,
      isSpreadsheetXml
    );
    if (!isSpreadsheetXml || !bytes) continue;

    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw unreadableWorkbookError();
    }
    const normalizedXml = normalizeSpreadsheetMlElementPrefixes(xml);
    if (normalizedXml !== xml) {
      zip.file(entry.name, normalizedXml);
      normalizedPartCount += 1;
    }
  }

  if (!normalizedPartCount) return buffer;
  try {
    const normalizedBytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    return toArrayBuffer(normalizedBytes);
  } catch {
    throw unreadableWorkbookError();
  }
};

export async function parseProfileWorkbookRecords(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  let safeBuffer: ArrayBuffer;
  try {
    safeBuffer = await preflightAndNormalizeWorkbook(buffer);
  } catch (error) {
    if (error instanceof ProfileWorkbookImportError) throw error;
    throw unreadableWorkbookError();
  }

  try {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx.load as (data: ArrayBuffer) => Promise<unknown>)(safeBuffer);
    const sheet = workbook.worksheets.find((candidate) => {
      const firstRow = candidate.getRow(1);
      return Array.from({ length: firstRow.cellCount }, (_, index) => firstRow.getCell(index + 1).text)
        .some((value) => value.trim());
    });
    if (!sheet) {
      throw new ProfileWorkbookImportError('The XLSX workbook does not contain a readable worksheet.');
    }

    const headerRow = sheet.getRow(1);
    if (!headerRow.cellCount) {
      throw new ProfileWorkbookImportError('The XLSX worksheet does not contain a header row.');
    }
    if (headerRow.cellCount > MAX_WORKSHEET_COLUMNS) throw workbookLimitError();
    const headers = Array.from(
      { length: headerRow.cellCount },
      (_, index) => headerRow.getCell(index + 1).text.trim()
    );
    if (!headers.some(Boolean)) {
      throw new ProfileWorkbookImportError('The XLSX worksheet does not contain a header row.');
    }

    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (rowNumber > MAX_WORKSHEET_DATA_ROWS + 1 || rows.length >= MAX_WORKSHEET_DATA_ROWS) {
        throw workbookLimitError();
      }
      const record = headers.reduce<Record<string, unknown>>((next, header, index) => {
        if (header) next[header] = row.getCell(index + 1).value ?? '';
        return next;
      }, {});
      if (Object.values(record).some((value) => String(value ?? '').trim())) rows.push(record);
    });
    return rows;
  } catch (error) {
    if (error instanceof ProfileWorkbookImportError) throw error;
    throw unreadableWorkbookError();
  }
}
