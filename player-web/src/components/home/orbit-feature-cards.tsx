'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';

const features = [
  {
    id: 'nearby',
    rank: 'A',
    suit: '\u2660\uFE0E',
    tone: 'midnight',
    cardLabel: 'Nearby',
    eyebrow: 'Find a table',
    title: 'Live games near you',
    detail: 'Browse room-published games by distance, stakes, variant, seat availability, and waitlist activity.',
    href: '/games',
    action: 'Browse nearby games',
    x: -82,
    rotate: -10
  },
  {
    id: 'fit',
    rank: 'K',
    suit: '\u2666\uFE0E',
    tone: 'teal',
    cardLabel: 'Your fit',
    eyebrow: 'Choose your game',
    title: 'The games you like to play',
    detail: 'Compare formats, stakes, current tables, and forming interest before deciding where your session starts.',
    href: '/clubs',
    action: 'Explore poker rooms',
    x: 0,
    rotate: 0
  },
  {
    id: 'memberships',
    rank: 'Q',
    suit: '\u2665\uFE0E',
    tone: 'midnight',
    cardLabel: 'My clubs',
    eyebrow: 'Stay organized',
    title: 'Every membership in one place',
    detail: 'Request access and keep active, pending, and expired poker-club memberships together in My Orbit.',
    href: '/me/clubs',
    action: 'Manage my memberships',
    x: 82,
    rotate: 10
  }
] as const;

export function OrbitFeatureCards() {
  const [activeId, setActiveId] = useState<(typeof features)[number]['id']>('nearby');
  const reduceMotion = useReducedMotion();
  const activeFeature = features.find((feature) => feature.id === activeId) ?? features[0];

  return (
    <section id="player-card-story" className="player-card-story" aria-labelledby="player-card-story-title">
      <motion.header
        className="player-card-story__intro"
        initial={reduceMotion ? false : { opacity: 0, y: 28 }}
        animate={reduceMotion ? { opacity: 1, y: 0 } : undefined}
        whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.45 }}
        transition={{ duration: reduceMotion ? 0 : 0.65, ease: 'easeOut' }}
      >
        <p>Orbit Player · one player hub</p>
        <h2 id="player-card-story-title">Find a game you&apos;ll like. Keep every membership together.</h2>
        <span>Pick a card to see how Orbit Player takes you from looking for a nearby game to managing the rooms where you play.</span>
      </motion.header>

      <div className="player-card-story__showcase">
        <div className="player-card-story__hand" role="group" aria-label="Choose a poker card to explore Orbit Player">
          {features.map((feature, index) => {
            const active = feature.id === activeId;
            return (
              <motion.div
                className="player-card-story__motion"
                key={feature.id}
                initial={reduceMotion ? false : { opacity: 0, x: 0, y: 64, rotate: 0, scale: 0.88 }}
                animate={reduceMotion ? { opacity: 1, x: feature.x, y: active ? -20 : 0, rotate: feature.rotate, scale: active ? 1.04 : 1 } : undefined}
                whileInView={reduceMotion ? undefined : { opacity: 1, x: feature.x, y: active ? -20 : 0, rotate: feature.rotate, scale: active ? 1.04 : 1 }}
                whileHover={reduceMotion ? undefined : { y: active ? -26 : -10 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 250, damping: 23, delay: 0.1 + index * 0.09 }}
                style={{ zIndex: active ? 10 : index + 1 }}
              >
                <button
                  type="button"
                  className="player-poker-card"
                  aria-pressed={active}
                  aria-label={`Preview ${feature.cardLabel.toLowerCase()} feature`}
                  aria-controls="player-card-feature"
                  onClick={() => setActiveId(feature.id)}
                  onFocus={() => setActiveId(feature.id)}
                >
                  <span className={`player-poker-card__corner player-poker-card__corner--top player-poker-card__corner--${feature.tone}`} aria-hidden="true"><strong>{feature.rank}</strong>{feature.suit}</span>
                  <span className={`player-poker-card__suit player-poker-card__suit--${feature.tone}`} aria-hidden="true">{feature.suit}</span>
                  <span className="player-poker-card__label">{feature.cardLabel}</span>
                  <span className={`player-poker-card__corner player-poker-card__corner--bottom player-poker-card__corner--${feature.tone}`} aria-hidden="true"><strong>{feature.rank}</strong>{feature.suit}</span>
                </button>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          className="player-card-story__readout"
          id="player-card-feature"
          aria-live="polite"
          aria-atomic="true"
          initial={reduceMotion ? false : { opacity: 0, x: 20 }}
          animate={reduceMotion ? { opacity: 1, x: 0 } : undefined}
          whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.34, ease: 'easeOut' }}
        >
          <span>{activeFeature.eyebrow}</span>
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={activeFeature.id}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            >
              <h3>{activeFeature.title}</h3>
              <p>{activeFeature.detail}</p>
              <Link href={activeFeature.href}>{activeFeature.action}<span aria-hidden="true"> →</span></Link>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
