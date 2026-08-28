import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

type StaffPinDialogProps = {
  staffName: string;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
};

const validStaffPin = /^\d{4,12}$/;
export default function StaffPinDialog({ staffName, onCancel, onSubmit }: StaffPinDialogProps) {
  const [pin, setPin] = useState('');
  const canSubmit = validStaffPin.test(pin);

  return (
    <Dialog.Root open onOpenChange={(open) => {
      if (!open) onCancel();
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="command-overlay" />
        <Dialog.Content
          className="command-dialog staff-pin-dialog"
          aria-describedby="staff-pin-dialog-description"
        >
          <form
            className="staff-pin-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) onSubmit(pin);
            }}
          >
            <div className="staff-pin-dialog-heading">
              <Dialog.Title>Verify {staffName}</Dialog.Title>
              <Dialog.Description id="staff-pin-dialog-description">
                Enter this staff member&apos;s PIN to activate their account on this station.
              </Dialog.Description>
            </div>
            <label>
              <span>Staff PIN</span>
              <input
                autoFocus
                autoComplete="off"
                inputMode="numeric"
                maxLength={12}
                minLength={4}
                name="staff-pin"
                pattern="[0-9]{4,12}"
                required
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </label>
            <div className="staff-pin-dialog-actions">
              <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
              <button className="primary-button" type="submit" disabled={!canSubmit}>Verify staff</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
