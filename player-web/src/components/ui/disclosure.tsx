'use client';

import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export function Disclosure({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible.Root className="disclosure" defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="disclosure__trigger">
        <span>{title}</span>
        <ChevronDown aria-hidden="true" size={18} />
      </Collapsible.Trigger>
      <Collapsible.Panel className="disclosure__content">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
