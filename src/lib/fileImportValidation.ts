export type LocalImportKind = 'profile-csv' | 'profile-xlsx' | 'backup-json' | 'pilot-key-json';

const constraints: Record<LocalImportKind, {
  extensions: string[];
  maximumBytes: number;
  mimeTypes: string[];
}> = {
  'profile-csv': {
    extensions: ['.csv'],
    maximumBytes: 5 * 1024 * 1024,
    mimeTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']
  },
  'profile-xlsx': {
    extensions: ['.xlsx'],
    maximumBytes: 10 * 1024 * 1024,
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']
  },
  'backup-json': {
    extensions: ['.json'],
    maximumBytes: 10 * 1024 * 1024,
    mimeTypes: ['application/json', 'text/json', 'text/plain']
  },
  'pilot-key-json': {
    extensions: ['.json', '.key'],
    maximumBytes: 64 * 1024,
    mimeTypes: ['application/json', 'text/json', 'text/plain', 'application/octet-stream']
  }
};

export class LocalImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalImportValidationError';
  }
}

const fileExtension = (name: string) => {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
};

const isZipSignature = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );

export async function validateLocalImport(file: File, kind: LocalImportKind) {
  const rule = constraints[kind];
  if (file.size <= 0) throw new LocalImportValidationError('The selected file is empty.');
  if (file.size > rule.maximumBytes) {
    throw new LocalImportValidationError(`The selected file exceeds the ${Math.round(rule.maximumBytes / 1024 / 1024 * 10) / 10} MB limit.`);
  }
  if (!rule.extensions.includes(fileExtension(file.name))) {
    throw new LocalImportValidationError(`Allowed file types: ${rule.extensions.join(', ')}.`);
  }
  const mime = file.type.trim().toLowerCase();
  if (mime && !rule.mimeTypes.includes(mime)) throw new LocalImportValidationError('The file content type is not allowed.');

  const headerBuffer = await file.slice(0, Math.min(file.size, 1024)).arrayBuffer();
  const bytes = new Uint8Array(headerBuffer);
  if (kind === 'profile-xlsx' && !isZipSignature(bytes)) {
    throw new LocalImportValidationError('The workbook does not have a valid XLSX signature.');
  }
  if (kind === 'profile-csv') {
    if (bytes.includes(0)) throw new LocalImportValidationError('The CSV contains binary data.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.includes(',')) throw new LocalImportValidationError('The CSV must contain a comma-separated header row.');
  }
  if (kind === 'backup-json' || kind === 'pilot-key-json') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trimStart();
    if (!text.startsWith('{')) throw new LocalImportValidationError('The selected file is not a JSON object.');
  }
}
