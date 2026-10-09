import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactElement, type RefObject } from 'react';

type OperationalDialogProps = {
  children: ReactElement;
  backdropClassName: string;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  dismissOnOutside?: boolean;
};

/** Registers body-portaled operational forms with Radix's modal and focus stack. */
export default function OperationalDialog({
  children,
  backdropClassName,
  onClose,
  fallbackFocusRef,
  dismissOnOutside = false
}: OperationalDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={backdropClassName}>
          <Dialog.Content
            asChild
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              const content = event.target;
              if (!(content instanceof HTMLElement)) return;
              const activeElement = content.ownerDocument.activeElement;
              openerRef.current = activeElement instanceof HTMLElement && activeElement !== content.ownerDocument.body
                ? activeElement
                : null;
              const initialFocus = content.querySelector<HTMLElement>('[data-dialog-initial-focus]');
              if (initialFocus) {
                event.preventDefault();
                initialFocus.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = openerRef.current?.isConnected ? openerRef.current : fallbackFocusRef?.current;
              if (target?.isConnected) target.focus();
            }}
            onPointerDownOutside={(event) => { if (!dismissOnOutside) event.preventDefault(); }}
          >
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
