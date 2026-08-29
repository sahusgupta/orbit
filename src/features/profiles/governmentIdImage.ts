import {
  parseGovernmentIdOcrText,
  parseGovernmentIdScan,
  type ScannedGovernmentId
} from '../../domain/governmentId';
import type { IdentityCaptureMethod } from '../../domain/types';
import { validateLocalImport } from '../../lib/fileImportValidation';

export type GovernmentIdImageReadResult = {
  identity: ScannedGovernmentId;
  captureMethod: Extract<IdentityCaptureMethod, 'id-image-pdf417' | 'id-image-ocr'>;
};

export type GovernmentIdImageProgress =
  | { stage: 'barcode'; progress: number }
  | { stage: 'ocr'; progress: number };

type GovernmentIdOcrWorker = {
  recognize: (image: File, options: { rotateAuto: boolean }) => Promise<{ data: { text: string } }>;
  setParameters?: (parameters: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

export type GovernmentIdOcrWorkerFactory = (
  onProgress: (progress: number) => void
) => Promise<GovernmentIdOcrWorker>;

export type GovernmentIdImageDimensions = {
  width: number;
  height: number;
};

export type GovernmentIdImageDependencies = {
  createObjectUrl: (file: File) => string;
  decodePdf417: (imageUrl: string, today: Date, signal?: AbortSignal) => Promise<ScannedGovernmentId | null>;
  inspectImageDimensions: (file: File) => Promise<GovernmentIdImageDimensions>;
  recognizeOcr: (
    file: File,
    today: Date,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ) => Promise<ScannedGovernmentId | null>;
  revokeObjectUrl: (imageUrl: string) => void;
  validateImage: (file: File) => Promise<void>;
};

export type GovernmentIdImageReadOptions = {
  dependencies?: GovernmentIdImageDependencies;
  onProgress?: (progress: GovernmentIdImageProgress) => void;
  signal?: AbortSignal;
  today?: Date;
};

export class GovernmentIdImageReadError extends Error {
  readonly code: 'cancelled' | 'unreadable';

  constructor(code: 'cancelled' | 'unreadable', message: string) {
    super(message);
    this.name = 'GovernmentIdImageReadError';
    this.code = code;
  }
}

const boundedProgress = (value: number) => Math.min(Math.max(Number(value) || 0, 0), 1);
const MAX_GOVERNMENT_ID_IMAGE_PIXELS = 20_000_000;

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new GovernmentIdImageReadError('cancelled', 'Government ID image reading was cancelled.');
  }
};

const localOcrAssetUrl = (path: string) => new URL(path, new URL('./ocr/', document.baseURI)).href;

const createLocalTesseractWorker: GovernmentIdOcrWorkerFactory = async (onProgress) => {
  const { createWorker, OEM } = await import('tesseract.js');
  return createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: localOcrAssetUrl('worker-entry.js'),
    corePath: localOcrAssetUrl('core/'),
    langPath: localOcrAssetUrl('lang/'),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    logger: (message) => onProgress(boundedProgress(message.progress))
  });
};

const uint16BigEndian = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const uint24LittleEndian = (bytes: Uint8Array, offset: number) => (
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
);

export function inspectGovernmentIdImageDimensions(bytes: Uint8Array): GovernmentIdImageDimensions | null {
  if (
    bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
    ]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      if (offset + 2 >= bytes.length) break;
      const segmentLength = uint16BigEndian(bytes, offset + 1);
      if (segmentLength < 2 || offset + segmentLength >= bytes.length) break;
      if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
        return {
          width: uint16BigEndian(bytes, offset + 6),
          height: uint16BigEndian(bytes, offset + 4)
        };
      }
      offset += segmentLength + 1;
    }
    return null;
  }

  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      return {
        width: uint24LittleEndian(bytes, 24) + 1,
        height: uint24LittleEndian(bytes, 27) + 1
      };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const packed = (
        bytes[21]
        | (bytes[22] << 8)
        | (bytes[23] << 16)
        | (bytes[24] << 24)
      ) >>> 0;
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1
      };
    }
  }

  return null;
}

async function inspectImageFileDimensions(file: File) {
  return inspectGovernmentIdImageDimensions(new Uint8Array(await file.arrayBuffer()))
    ?? Promise.reject(new GovernmentIdImageReadError(
      'unreadable',
      'The image dimensions could not be read safely. Try a standard JPG, PNG, or WebP image.'
    ));
}

export function createGovernmentIdOcrRecognizer(
  createWorker: GovernmentIdOcrWorkerFactory = createLocalTesseractWorker
) {
  return async (
    file: File,
    today: Date,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<ScannedGovernmentId | null> => {
    let worker: GovernmentIdOcrWorker | null = null;
    let termination: Promise<unknown> | null = null;
    const terminate = () => {
      if (!worker) return Promise.resolve();
      termination ??= Promise.resolve(worker.terminate());
      return termination;
    };
    const handleAbort = () => {
      void terminate().catch(() => undefined);
    };

    try {
      throwIfAborted(signal);
      worker = await createWorker(onProgress);
      throwIfAborted(signal);
      signal?.addEventListener('abort', handleAbort, { once: true });
      await worker.setParameters?.({ user_defined_dpi: '300' });
      throwIfAborted(signal);
      let rawText = '';
      try {
        const result = await worker.recognize(file, { rotateAuto: true });
        throwIfAborted(signal);
        rawText = String(result.data.text || '');
        return parseGovernmentIdOcrText(rawText, today);
      } finally {
        rawText = '';
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof GovernmentIdImageReadError && error.code === 'cancelled')) {
        throw new GovernmentIdImageReadError('cancelled', 'Government ID image reading was cancelled.');
      }
      throw new GovernmentIdImageReadError('unreadable', 'The ID image could not be read locally. Try a clearer image.');
    } finally {
      signal?.removeEventListener('abort', handleAbort);
      try {
        await terminate();
      } catch {
        throw new GovernmentIdImageReadError(
          signal?.aborted ? 'cancelled' : 'unreadable',
          signal?.aborted
            ? 'Government ID image reading was cancelled.'
            : 'The local ID image reader could not shut down safely. Try again.'
        );
      }
    }
  };
}

async function decodePdf417Image(imageUrl: string, today: Date, signal?: AbortSignal) {
  throwIfAborted(signal);
  let rawBarcode = '';
  try {
    const { BrowserPDF417Reader } = await import('@zxing/browser');
    const result = await new BrowserPDF417Reader().decodeFromImageUrl(imageUrl);
    throwIfAborted(signal);
    rawBarcode = result.getText();
    return parseGovernmentIdScan(rawBarcode, today);
  } catch (error) {
    if (signal?.aborted || (error instanceof GovernmentIdImageReadError && error.code === 'cancelled')) throw error;
    return null;
  } finally {
    rawBarcode = '';
  }
}

const defaultDependencies: GovernmentIdImageDependencies = {
  createObjectUrl: (file) => URL.createObjectURL(file),
  decodePdf417: decodePdf417Image,
  inspectImageDimensions: inspectImageFileDimensions,
  recognizeOcr: createGovernmentIdOcrRecognizer(),
  revokeObjectUrl: (imageUrl) => URL.revokeObjectURL(imageUrl),
  validateImage: (file) => validateLocalImport(file, 'government-id-image')
};

/**
 * Reads an image entirely in the renderer. Only the three profile-safe fields
 * and their capture method cross this boundary; raw barcode/OCR text does not.
 */
export async function readGovernmentIdImage(
  file: File,
  options: GovernmentIdImageReadOptions = {}
): Promise<GovernmentIdImageReadResult> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const today = options.today ?? new Date();
  await dependencies.validateImage(file);
  throwIfAborted(options.signal);
  const dimensions = await dependencies.inspectImageDimensions(file);
  throwIfAborted(options.signal);
  if (
    !Number.isSafeInteger(dimensions.width)
    || !Number.isSafeInteger(dimensions.height)
    || dimensions.width <= 0
    || dimensions.height <= 0
    || dimensions.width * dimensions.height > MAX_GOVERNMENT_ID_IMAGE_PIXELS
  ) {
    throw new GovernmentIdImageReadError(
      'unreadable',
      'The image is too large to read safely. Choose an image under 20 megapixels.'
    );
  }

  options.onProgress?.({ stage: 'barcode', progress: 0 });
  const imageUrl = dependencies.createObjectUrl(file);
  let barcodeIdentity: ScannedGovernmentId | null = null;
  try {
    try {
      barcodeIdentity = await dependencies.decodePdf417(imageUrl, today, options.signal);
    } catch (error) {
      if (options.signal?.aborted || (error instanceof GovernmentIdImageReadError && error.code === 'cancelled')) throw error;
      barcodeIdentity = null;
    }
  } finally {
    dependencies.revokeObjectUrl(imageUrl);
  }
  throwIfAborted(options.signal);
  if (barcodeIdentity) {
    options.onProgress?.({ stage: 'barcode', progress: 1 });
    return { identity: barcodeIdentity, captureMethod: 'id-image-pdf417' };
  }

  options.onProgress?.({ stage: 'ocr', progress: 0 });
  let ocrIdentity: ScannedGovernmentId | null;
  try {
    ocrIdentity = await dependencies.recognizeOcr(
      file,
      today,
      (progress) => options.onProgress?.({ stage: 'ocr', progress: boundedProgress(progress) }),
      options.signal
    );
  } catch (error) {
    if (options.signal?.aborted || (error instanceof GovernmentIdImageReadError && error.code === 'cancelled')) throw error;
    throw new GovernmentIdImageReadError('unreadable', 'The ID image could not be read locally. Try a clearer image.');
  }
  throwIfAborted(options.signal);
  if (!ocrIdentity) {
    throw new GovernmentIdImageReadError(
      'unreadable',
      'The image did not contain a complete readable name, date of birth, and address.'
    );
  }
  options.onProgress?.({ stage: 'ocr', progress: 1 });
  return { identity: ocrIdentity, captureMethod: 'id-image-ocr' };
}
