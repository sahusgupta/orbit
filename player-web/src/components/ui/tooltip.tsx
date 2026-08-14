'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';

export function Tooltip({ children, label }: { children: ReactElement; label: string }) {
  return (
    <TooltipPrimitive.Provider delay={500}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner sideOffset={8}>
            <TooltipPrimitive.Popup className="tooltip-popup">{label}</TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
