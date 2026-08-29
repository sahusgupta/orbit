import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, ImageUp, ScanLine, ShieldAlert } from 'lucide-react';
import { parseGovernmentIdScan, type ScannedGovernmentId } from '../../domain/governmentId';
import type { IdentityCaptureMethod } from '../../domain/types';
import { LocalImportValidationError } from '../../lib/fileImportValidation';
import {
  GovernmentIdImageReadError,
  readGovernmentIdImage,
  type GovernmentIdImageReadOptions
} from './governmentIdImage';

type IdEnrollmentPanelProps = {
  minimumAge: 18 | 21;
  onApply: (identity: ScannedGovernmentId, captureMethod: IdentityCaptureMethod) => void;
  readImage?: (file: File, options?: GovernmentIdImageReadOptions) => ReturnType<typeof readGovernmentIdImage>;
};

export default function IdEnrollmentPanel({
  minimumAge,
  onApply,
  readImage = readGovernmentIdImage
}: IdEnrollmentPanelProps) {
  const [rawScan, setRawScan] = useState('');
  const [identity, setIdentity] = useState<ScannedGovernmentId | null>(null);
  const [captureMethod, setCaptureMethod] = useState<IdentityCaptureMethod | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [ocrCompared, setOcrCompared] = useState(false);
  const [message, setMessage] = useState('Click the box, then scan the PDF417 barcode or swipe the ID.');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const imageAttemptRef = useRef(0);
  const imagePreviewUrlRef = useRef('');

  const replaceImagePreview = useCallback((nextUrl = '') => {
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    imagePreviewUrlRef.current = nextUrl;
    setImagePreviewUrl(nextUrl);
  }, []);

  const cancelImageRead = useCallback(() => {
    imageAttemptRef.current += 1;
    imageAbortRef.current?.abort();
    imageAbortRef.current = null;
    setIsReadingImage(false);
  }, []);

  const readScan = useCallback((value: string) => {
    const parsed = parseGovernmentIdScan(value);
    setRawScan('');
    setOcrCompared(false);
    replaceImagePreview();
    if (!parsed) {
      setIdentity(null);
      setCaptureMethod(null);
      setMessage('That scan was not recognized. Try again or use the local image fallback.');
      return;
    }
    setIdentity(parsed);
    setCaptureMethod('id-barcode');
    setMessage(parsed.fullName && parsed.dateOfBirth
      ? 'Scanner input detected and ID details extracted. Confirm them before continuing.'
      : 'Scanner input detected, but the scan was incomplete. Try the PDF417 barcode on the back of the ID.');
  }, [replaceImagePreview]);

  useEffect(() => {
    if (rawScan.length < 20) return undefined;
    const timer = window.setTimeout(() => readScan(rawScan), 450);
    return () => window.clearTimeout(timer);
  }, [rawScan, readScan]);

  useEffect(() => () => {
    imageAttemptRef.current += 1;
    imageAbortRef.current?.abort();
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
  }, []);

  const handleImage = async (file: File) => {
    cancelImageRead();
    replaceImagePreview();
    setRawScan('');
    setIdentity(null);
    setCaptureMethod(null);
    setOcrCompared(false);
    setIsReadingImage(true);
    setMessage('Checking the image locally for a PDF417 barcode…');

    const attempt = imageAttemptRef.current;
    const controller = new AbortController();
    imageAbortRef.current = controller;
    try {
      const result = await readImage(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (attempt !== imageAttemptRef.current) return;
          if (progress.stage === 'barcode') {
            setMessage('Checking the image locally for a PDF417 barcode…');
            return;
          }
          const percent = Math.round(progress.progress * 100);
          setMessage(`No PDF417 barcode found. Reading printed fields locally${percent ? `… ${percent}%` : '…'}`);
        }
      });
      if (attempt !== imageAttemptRef.current || controller.signal.aborted) return;
      setIdentity(result.identity);
      setCaptureMethod(result.captureMethod);
      replaceImagePreview(URL.createObjectURL(file));
      if (result.captureMethod === 'id-image-ocr') {
        setMessage('Printed ID details were read locally. Compare every field with the image before continuing.');
      } else {
        setMessage('PDF417 barcode detected in the image. Compare every field with the image before continuing.');
      }
    } catch (error) {
      if (attempt !== imageAttemptRef.current || controller.signal.aborted) return;
      setIdentity(null);
      setCaptureMethod(null);
      setMessage(error instanceof LocalImportValidationError || error instanceof GovernmentIdImageReadError
        ? error.message
        : 'The ID image could not be read locally. Try a clear photo of the barcode side.');
    } finally {
      if (attempt === imageAttemptRef.current) {
        imageAbortRef.current = null;
        setIsReadingImage(false);
      }
    }
  };

  const clearCapture = () => {
    cancelImageRead();
    replaceImagePreview();
    setRawScan('');
    setIdentity(null);
    setCaptureMethod(null);
    setOcrCompared(false);
    setMessage('Ready for another ID scan or local image.');
    inputRef.current?.focus();
  };

  const eligible = identity?.age != null && identity.age >= minimumAge;
  const complete = Boolean(identity?.fullName && identity.dateOfBirth && identity.address && identity.age != null);
  const needsImageComparison = captureMethod === 'id-image-pdf417' || captureMethod === 'id-image-ocr';
  const canApply = complete && eligible && Boolean(captureMethod) && (!needsImageComparison || ocrCompared);

  return (
    <div className="id-enrollment-panel">
      <button className="id-scan-target" type="button" onClick={() => inputRef.current?.focus()}>
        <ScanLine size={28} />
        <strong>Ready for ID scanner</strong>
        <span>USB barcode scanners and magnetic-stripe readers type into the secure field below.</span>
      </button>
      <label className="id-scan-input">
        <span>Scanner input</span>
        <textarea
          ref={inputRef}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={rawScan}
          onChange={(event) => {
            if (!rawScan && event.target.value) {
              cancelImageRead();
              replaceImagePreview();
              setIdentity(null);
              setCaptureMethod(null);
              setOcrCompared(false);
            }
            setRawScan(event.target.value);
            if (event.target.value) setMessage('Scanner input detected. Reading securely…');
          }}
          placeholder="Click here, then scan or swipe the ID"
          aria-label="Government ID scanner input"
        />
      </label>
      <div className="id-scan-actions">
        <button className="secondary-button" type="button" disabled={!rawScan.trim()} onClick={() => readScan(rawScan)}>Read scan</button>
        <button className="ghost-button" type="button" onClick={clearCapture}>Clear</button>
      </div>

      <section className="id-image-fallback" aria-labelledby="id-image-fallback-title">
        <div>
          <ImageUp size={20} />
          <span>
            <strong id="id-image-fallback-title">No scanner? Use an ID image</strong>
            <small>Orbit checks for the PDF417 barcode first, then reads printed fields entirely on this device.</small>
          </span>
        </div>
        <label>
          <span>Choose a JPG, PNG, or WebP image</span>
          <input
            aria-label="Choose government ID image"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            disabled={isReadingImage}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void handleImage(file);
            }}
          />
        </label>
      </section>

      <p className="membership-qr-message" role="status">{message}</p>

      {identity ? (
        <section className="id-scan-preview" aria-label="Extracted ID details">
          <div className={`id-age-status ${eligible ? 'eligible' : 'blocked'}`}>
            {eligible ? <BadgeCheck size={20} /> : <ShieldAlert size={20} />}
            <div>
              <strong>{identity.age == null ? 'Age unavailable' : `Age ${identity.age}`}</strong>
              <span>{eligible ? `Meets this club's ${minimumAge}+ requirement` : `Does not meet this club's ${minimumAge}+ requirement`}</span>
            </div>
          </div>
          <dl>
            <div><dt>Name</dt><dd>{identity.fullName || 'Not found'}</dd></div>
            <div><dt>Date of birth</dt><dd>{identity.dateOfBirth || 'Not found'}</dd></div>
            <div><dt>Address</dt><dd>{identity.address || 'Not found'}</dd></div>
          </dl>
          {needsImageComparison ? (
            <div className="id-ocr-review">
              {imagePreviewUrl ? <img src={imagePreviewUrl} alt="Selected government ID for local comparison" draggable={false} /> : null}
              <label>
                <input
                  type="checkbox"
                  checked={ocrCompared}
                  onChange={(event) => setOcrCompared(event.target.checked)}
                />
                <span>I compared the extracted name, date of birth, and address with this ID image.</span>
              </label>
              <small>{captureMethod === 'id-image-ocr' ? 'Image OCR' : 'Image barcode capture'} remains pending until the club completes its normal ID review.</small>
            </div>
          ) : null}
          <button
            className="primary-button"
            type="button"
            disabled={!canApply}
            onClick={() => {
              if (identity && captureMethod && canApply) onApply(identity, captureMethod);
            }}
          >
            Use details and continue
          </button>
        </section>
      ) : null}

      <p className="id-scan-privacy">The image, raw scan, barcode value, and ID number stay on this device and are discarded. Orbit keeps only the confirmed name, date of birth, address, and review status.</p>
    </div>
  );
}
