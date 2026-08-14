'use client';

import { Accordion } from '@base-ui/react/accordion';
import { Minus, Plus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Adapted from Watermelon UI's MIT-licensed FAQ 1 registry component.
// Source: https://github.com/WatermelonCorp/watermellon-registry/blob/main/public/r/faq-1.json
export type WatermelonFaqItem = {
  id: string;
  question: string;
  answer: string;
};

export function WatermelonFaq({
  eyebrow,
  title,
  items,
  icon: Icon,
  headingId
}: {
  eyebrow: string;
  title: ReactNode;
  items: readonly WatermelonFaqItem[];
  icon: LucideIcon;
  headingId: string;
}) {
  return (
    <section className="faq-section" aria-labelledby={headingId} data-watermelon-component="faq-1-adapted">
      <header className="faq-intro">
        <span className="faq-intro__icon"><Icon aria-hidden="true" size={22} /></span>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
      </header>
      <Accordion.Root className="faq-accordion" defaultValue={[items[0]?.id ?? '']}>
        {items.map((item, index) => (
          <Accordion.Item className="faq-item" key={item.id} value={item.id}>
            <span className="faq-item__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <Accordion.Header>
                <Accordion.Trigger className="faq-item__trigger">
                  <span>{item.question}</span>
                  <span className="faq-item__state" aria-hidden="true">
                    <Plus className="faq-item__plus" size={18} />
                    <Minus className="faq-item__minus" size={18} />
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="faq-item__answer"><p>{item.answer}</p></Accordion.Panel>
            </div>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}
