/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScannedGovernmentId } from '../../domain/governmentId';
import {
  createGovernmentIdOcrRecognizer,
  GovernmentIdImageReadError,
  inspectGovernmentIdImageDimensions,
  readGovernmentIdImage,
  type GovernmentIdImageDependencies,
  type GovernmentIdOcrWorkerFactory
} from './governmentIdImage';

const safeIdentity: ScannedGovernmentId = {
  fullName: 'CASEY EXAMPLE',
  dateOfBirth: '1990-01-02',
  address: '100 TEST WAY, AUSTIN, TX 78701',
  age: 36
};

const imageFile = new File(
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'synthetic.png',
  { type: 'image/png' }
);

function dependencies(overrides: Partial<GovernmentIdImageDependencies> = {}): GovernmentIdImageDependencies {
  return {
    createObjectUrl: vi.fn(() => 'blob:local-id-image'),
    decodePdf417: vi.fn(async () => null),
    inspectImageDimensions: vi.fn(async () => ({ width: 3000, height: 2000 })),
    recognizeOcr: vi.fn(async () => safeIdentity),
    revokeObjectUrl: vi.fn(),
    validateImage: vi.fn(async () => undefined),
    ...overrides
  };
}

describe('local government ID image reader', () => {
  it('reads intrinsic dimensions from image headers without decoding image pixels', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 5000);
    new DataView(png.buffer).setUint32(20, 4000);

    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x13, 0x88,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
    ]);

    expect(inspectGovernmentIdImageDimensions(png)).toEqual({ width: 5000, height: 4000 });
    expect(inspectGovernmentIdImageDimensions(jpeg)).toEqual({ width: 5000, height: 4000 });
    expect(inspectGovernmentIdImageDimensions(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('rejects images over 20 megapixels before creating a URL or starting either reader', async () => {
    const deps = dependencies({
      inspectImageDimensions: vi.fn(async () => ({ width: 5001, height: 4000 }))
    });

    await expect(readGovernmentIdImage(imageFile, { dependencies: deps })).rejects.toThrow('under 20 megapixels');
    expect(deps.createObjectUrl).not.toHaveBeenCalled();
    expect(deps.decodePdf417).not.toHaveBeenCalled();
    expect(deps.recognizeOcr).not.toHaveBeenCalled();
  });

  it('uses PDF417 first, never starts OCR after a barcode match, and revokes the image URL', async () => {
    const deps = dependencies({
      decodePdf417: vi.fn(async () => safeIdentity)
    });

    const result = await readGovernmentIdImage(imageFile, {
      dependencies: deps,
      today: new Date(2026, 7, 27)
    });

    expect(result).toEqual({ identity: safeIdentity, captureMethod: 'id-image-pdf417' });
    expect(deps.decodePdf417).toHaveBeenCalledWith('blob:local-id-image', new Date(2026, 7, 27), undefined);
    expect(deps.recognizeOcr).not.toHaveBeenCalled();
    expect(deps.revokeObjectUrl).toHaveBeenCalledExactlyOnceWith('blob:local-id-image');
  });

  it('revokes the barcode URL before using OCR and returns only profile-safe fields', async () => {
    const deps = dependencies({
      decodePdf417: vi.fn(async () => { throw new Error('decoder internals'); })
    });
    const stages: string[] = [];

    const result = await readGovernmentIdImage(imageFile, {
      dependencies: deps,
      onProgress: ({ stage }) => stages.push(stage)
    });

    expect(result).toEqual({ identity: safeIdentity, captureMethod: 'id-image-ocr' });
    expect(deps.revokeObjectUrl).toHaveBeenCalledBefore(vi.mocked(deps.recognizeOcr));
    expect(stages).toEqual(['barcode', 'ocr', 'ocr']);
    expect(JSON.stringify(result)).not.toMatch(/decoder internals|raw|license number/i);
  });

  it('returns a generic failure when neither local reader finds safe identity fields', async () => {
    const deps = dependencies({ recognizeOcr: vi.fn(async () => null) });

    await expect(readGovernmentIdImage(imageFile, { dependencies: deps })).rejects.toMatchObject({
      code: 'unreadable'
    });
    expect(deps.revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it('does not expose OCR engine errors through the reader boundary', async () => {
    const deps = dependencies({
      recognizeOcr: vi.fn(async () => { throw new Error('RAW-ID-SECRET'); })
    });
    let failure: unknown;

    try {
      await readGovernmentIdImage(imageFile, { dependencies: deps });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GovernmentIdImageReadError);
    expect(String(failure)).not.toContain('RAW-ID-SECRET');
  });
});

describe('local Tesseract lifecycle', () => {
  it('parses safe OCR fields, drops raw text, and terminates the worker', async () => {
    const terminate = vi.fn(async () => undefined);
    const setParameters = vi.fn(async () => undefined);
    const createWorker: GovernmentIdOcrWorkerFactory = vi.fn(async () => ({
      recognize: vi.fn(async () => ({
        data: {
          text: [
            'DRIVER LICENSE ID-NUMBER-SECRET',
            'LAST NAME EXAMPLE',
            'FIRST NAME CASEY',
            'DOB 01/02/1990',
            'ADDRESS 100 TEST WAY',
            'AUSTIN, TX 78701'
          ].join('\n')
        }
      })),
      setParameters,
      terminate
    }));

    const recognize = createGovernmentIdOcrRecognizer(createWorker);
    const result = await recognize(imageFile, new Date(2026, 7, 27), vi.fn());

    expect(result).toEqual(safeIdentity);
    expect(JSON.stringify(result)).not.toContain('ID-NUMBER-SECRET');
    expect(setParameters).toHaveBeenCalledExactlyOnceWith({ user_defined_dpi: '300' });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('terminates after OCR failure and replaces sensitive engine errors with a generic error', async () => {
    const terminate = vi.fn(async () => undefined);
    const createWorker: GovernmentIdOcrWorkerFactory = vi.fn(async () => ({
      recognize: vi.fn(async () => { throw new Error('RAW-ID-SECRET'); }),
      terminate
    }));

    const recognize = createGovernmentIdOcrRecognizer(createWorker);
    let failure: unknown;
    try {
      await recognize(imageFile, new Date(2026, 7, 27), vi.fn());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GovernmentIdImageReadError);
    expect(String(failure)).not.toContain('RAW-ID-SECRET');
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('terminates an active worker when the caller cancels OCR', async () => {
    const controller = new AbortController();
    const terminate = vi.fn(async () => undefined);
    const createWorker: GovernmentIdOcrWorkerFactory = vi.fn(async () => ({
      recognize: vi.fn(async () => {
        controller.abort();
        throw new Error('cancelled engine detail');
      }),
      terminate
    }));

    const recognize = createGovernmentIdOcrRecognizer(createWorker);
    await expect(recognize(imageFile, new Date(2026, 7, 27), vi.fn(), controller.signal)).rejects.toMatchObject({
      code: 'cancelled'
    });
    expect(terminate).toHaveBeenCalledOnce();
  });
});
