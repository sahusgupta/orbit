'use client';

import { CircleHelp } from 'lucide-react';
import { WatermelonFaq } from '@/src/components/vendor/watermelon/faq';

const questions = [
  {
    id: 'browse',
    question: 'Do I need an account to browse?',
    answer: 'The landing page and its presentation-only examples stay public. Games, clubs, tournaments, and My Orbit require a verified player account.'
  },
  {
    id: 'source',
    question: 'Where does the live information come from?',
    answer: 'Participating rooms publish their current game, table, seat, and tournament state from Orbit Core. Protected discovery routes refresh from the same player-safe publication boundary.'
  },
  {
    id: 'seat',
    question: 'Does a game request guarantee a seat?',
    answer: 'No. A request tells the room whether you are there, arriving later, or interested. The room remains authoritative for seating and waitlist order.'
  },
  {
    id: 'location',
    question: 'Can I use Orbit without sharing my location?',
    answer: 'Yes. This release does not request device location or calculate mileage. Discovery uses venue-published game and tournament information, and an optional home-area text preference can be saved to your profile.'
  },
  {
    id: 'payments',
    question: 'How do memberships and tournament payments work?',
    answer: 'Orbit shows only options a room has published. A membership request or tournament interest records intent; the room separately handles any participation, payment, or activation.'
  }
] as const;

export function OrbitFaq() {
  return (
    <WatermelonFaq
      eyebrow="Before you go"
      title="Straight answers for live play."
      items={questions}
      icon={CircleHelp}
      headingId="faq-heading"
    />
  );
}
