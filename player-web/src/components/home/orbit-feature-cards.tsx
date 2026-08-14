'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Button } from '@/src/components/ui/button';

const features = [
  {
    id: 'live',
    rank: 'A',
    suit: '\u2660\uFE0E',
    tone: 'ink',
    cardLabel: 'Live',
    title: 'Running now',
    detail: 'Room-published games, tables, and open-seat context.',
    x: -78,
    rotate: -9
  },
  {
    id: 'forming',
    rank: 'K',
    suit: '\u2666\uFE0E',
    tone: 'red',
    cardLabel: 'Forming',
    title: 'Building a table',
    detail: "See a room's published interest before the first hand is dealt.",
    x: 0,
    rotate: 0
  },
  {
    id: 'registration',
    rank: 'Q',
    suit: '\u2665\uFE0E',
    tone: 'red',
    cardLabel: 'Open',
    title: 'Registration open',
    detail: 'Find published tournaments that are currently accepting entries.',
    x: 78,
    rotate: 9
  }
] as const;

export function OrbitFeatureCards() {
  const [activeId, setActiveId] = useState<(typeof features)[number]['id']>('live');
  const reduceMotion = useReducedMotion();
  const activeFeature = features.find((feature) => feature.id === activeId) ?? features[0];

  return (
    <div className="orbit-card-showcase" aria-label="Explore Orbit discovery features">
      <div className="orbit-card-hand" role="group" aria-label="Choose a poker card to preview a feature">
        {features.map((feature, index) => {
          const active = feature.id === activeId;
          return (
            <motion.div
              className="orbit-card-motion"
              key={feature.id}
              initial={reduceMotion ? false : { opacity: 0, x: 0, y: 34, rotate: 0 }}
              animate={{ opacity: 1, x: feature.x, y: active ? -18 : 0, rotate: feature.rotate, scale: active ? 1.04 : 1 }}
              whileHover={reduceMotion ? undefined : { y: active ? -24 : -10 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 24, delay: index * 0.06 }}
              style={{ zIndex: active ? 10 : index + 1 }}
            >
              <Button
                className="poker-feature-card"
                tone="quiet"
                aria-pressed={active}
                aria-label={`Preview ${feature.cardLabel.toLowerCase()} feature`}
                aria-controls="orbit-card-feature"
                onClick={() => setActiveId(feature.id)}
                onFocus={() => setActiveId(feature.id)}
              >
                <span className={`poker-card__corner poker-card__corner--top poker-card__corner--${feature.tone}`} aria-hidden="true"><strong>{feature.rank}</strong>{feature.suit}</span>
                <span className={`poker-card__suit poker-card__suit--${feature.tone}`} aria-hidden="true">{feature.suit}</span>
                <span className="poker-card__label">{feature.cardLabel}</span>
                <span className={`poker-card__corner poker-card__corner--bottom poker-card__corner--${feature.tone}`} aria-hidden="true"><strong>{feature.rank}</strong>{feature.suit}</span>
              </Button>
            </motion.div>
          );
        })}
      </div>

      <div className="orbit-card-readout" id="orbit-card-feature" aria-live="polite" aria-atomic="true">
        <span>Pick a card</span>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeFeature.id}
            initial={reduceMotion ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            <strong>{activeFeature.title}</strong>
            <p>{activeFeature.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
