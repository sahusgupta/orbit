'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip } from './tooltip';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="dialog-overlay" />
        <DialogPrimitive.Viewport className="dialog-viewport">
          <DialogPrimitive.Popup className="dialog-content">
            <div className="dialog-heading">
              <div>
                <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
              </div>
              <Tooltip label="Close dialog"><DialogPrimitive.Close className="icon-button" aria-label="Close dialog"><X aria-hidden="true" size={20} /></DialogPrimitive.Close></Tooltip>
            </div>
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
