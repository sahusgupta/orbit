export type LocalImportKind = 'profile-csv' | 'profile-xlsx' | 'backup-json' | 'pilot-key-json' | 'government-id-image';

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
  },
  'government-id-image': {
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maximumBytes: 12 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp']
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

const isPngSignature = (bytes: Uint8Array) =>
  bytes.length >= 8 &&
  bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
  bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;

const isJpegSignature = (bytes: Uint8Array) =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const isWebpSignature = (bytes: Uint8Array) =>
  bytes.length >= 12 &&
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
  bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

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
  if (kind === 'government-id-image') {
    const detected = isJpegSignature(bytes) ? 'jpeg' : isPngSignature(bytes) ? 'png' : isWebpSignature(bytes) ? 'webp' : '';
    const extension = fileExtension(file.name);
    const expectedExtension = detected === 'jpeg'
      ? ['.jpg', '.jpeg'].includes(extension)
      : extension === `.${detected}`;
    const expectedMime = !mime || mime === `image/${detected}`;
    if (!detected || !expectedExtension || !expectedMime) {
      throw new LocalImportValidationError('The selected file is not a valid JPEG, PNG, or WebP image.');
    }
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
