import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, ScanLine, ShieldAlert } from 'lucide-react';
import { parseGovernmentIdScan, type ScannedGovernmentId } from '../../domain/governmentId';

type IdEnrollmentPanelProps = {
  minimumAge: 18 | 21;
  onApply: (identity: ScannedGovernmentId) => void;
};

export default function IdEnrollmentPanel({ minimumAge, onApply }: IdEnrollmentPanelProps) {
  const [rawScan, setRawScan] = useState('');
  const [identity, setIdentity] = useState<ScannedGovernmentId | null>(null);
  const [message, setMessage] = useState('Click the box, then scan the PDF417 barcode or swipe the ID.');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const readScan = (value = rawScan) => {
    const parsed = parseGovernmentIdScan(value);
    setRawScan('');
    if (!parsed) {
      setIdentity(null);
      setMessage('That scan was not recognized. Try again or use the regular Add member form.');
      return;
    }
    setIdentity(parsed);
    setMessage(parsed.fullName && parsed.dateOfBirth
      ? 'ID details extracted. Confirm them before continuing.'
      : 'The scan was incomplete. Try the PDF417 barcode on the back of the ID.');
  };

  useEffect(() => {
    if (rawScan.length < 20) return undefined;
    const timer = window.setTimeout(() => readScan(rawScan), 180);
    return () => window.clearTimeout(timer);
  }, [rawScan]);

  const eligible = identity?.age != null && identity.age >= minimumAge;
  const complete = Boolean(identity?.fullName && identity.dateOfBirth && identity.address && identity.age != null);

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
          onChange={(event) => setRawScan(event.target.value)}
          placeholder="Click here, then scan or swipe the ID"
          aria-label="Government ID scanner input"
        />
      </label>
      <div className="id-scan-actions">
        <button className="secondary-button" type="button" disabled={!rawScan.trim()} onClick={() => readScan()}>Read scan</button>
        <button className="ghost-button" type="button" onClick={() => { setRawScan(''); setIdentity(null); setMessage('Ready for another ID scan.'); inputRef.current?.focus(); }}>Clear</button>
      </div>
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
          <button className="primary-button" type="button" disabled={!complete || !eligible} onClick={() => onApply(identity)}>
            Use details and continue
          </button>
        </section>
      ) : null}

      <p className="id-scan-privacy">Orbit keeps only the confirmed name, date of birth, and address. The raw scan and ID number are discarded and are not added to the player profile.</p>
    </div>
  );
}
