import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { ClubCard, GameCard, TournamentCard } from '@/src/components/discovery/entity-cards';
import { OrbitFeatureCards } from '@/src/components/home/orbit-feature-cards';
import { OrbitFaq } from '@/src/components/home/orbit-faq';
import { ButtonLink } from '@/src/components/ui/button';
import { ScrollReveal } from '@/src/components/ui/scroll-reveal';
import { EmptyState, ErrorState, SectionHeading } from '@/src/components/ui/state-panels';
import { filterTournaments, flattenGames, getGameState } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  ...createPageMetadata({
    title: 'Find live poker',
    description: 'See current poker games, open tournament registration, and participating clubs without an account wall.',
    path: '/'
  }),
  title: { absolute: 'Find live poker | Orbit' }
};

export default async function HomePage() {
  const result = await getPublicDiscovery();
  const discovery = result.status === 'ready' ? result.data : null;
  const games = discovery ? flattenGames(discovery.clubs).filter((item) => ['running', 'forming'].includes(getGameState(item.game))).slice(0, 3) : [];
  const tournaments = discovery ? filterTournaments(discovery, { query: '', club: 'all', distance: '0', registration: 'open' }).slice(0, 3) : [];
  const clubs = discovery?.clubs.slice(0, 3) ?? [];
  return (
    <>
      <LiveRouteRefresh />
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow"><Sparkles aria-hidden="true" size={15} />Current live poker starts here</p>
          <h1>Find your game.</h1>
          <div className="hero-actions"><ButtonLink href="/games">Find a game<ArrowRight aria-hidden="true" size={18} /></ButtonLink><ButtonLink href="/tournaments" tone="secondary">Browse tournaments</ButtonLink></div>
          <div className="hero-proof"><Radio aria-hidden="true" size={17} /><span>Current information published by rooms using Orbit Core</span></div>
        </div>
        <div className="home-hero__utility">
          <figure className="home-atmosphere home-atmosphere--interactive">
            <Image src="/orbit-table-rhythm.jpg" width={1536} height={1024} sizes="(max-width: 900px) 100vw, 52vw" alt="Abstract overhead composition of a poker table, face-down cards, and table markers." priority />
            <OrbitFeatureCards />
          </figure>
          <div className="now-board" aria-label="Useful live poker activity">
            <header><div><span className="live-indicator" aria-hidden="true" /><strong>Now on Orbit</strong></div><ButtonLink href="/games" tone="quiet" size="compact">All games<ArrowRight aria-hidden="true" size={15} /></ButtonLink></header>
            {result.status === 'error' ? <ErrorState title="Live inventory is reconnecting" message={result.message} /> : games.length ? <div className="now-board__list">{games.map((listing) => <GameCard key={`${listing.club.club.id}:${listing.game.id}`} listing={listing} compact />)}</div> : <EmptyState title="No live games published yet" message="Browse clubs and scheduled inventory while rooms update their floors." action={<ButtonLink href="/clubs" tone="secondary" size="compact">Browse clubs</ButtonLink>} />}
          </div>
        </div>
      </section>

      {discovery ? (
        <div className="home-sections">
          <ScrollReveal direction="right"><section className="home-section">
            <SectionHeading eyebrow="Plan the next game" title="Registration is open" action={<ButtonLink href="/tournaments" tone="quiet">All tournaments<ArrowRight aria-hidden="true" size={16} /></ButtonLink>} />
            {tournaments.length ? <div className="tournament-list tournament-list--home">{tournaments.map((listing) => <TournamentCard key={`${listing.tournament.clubId}:${listing.tournament.id}`} listing={listing} compact />)}</div> : <EmptyState title="No open registration right now" message="Published events will appear here as soon as host clubs open them." />}
          </section></ScrollReveal>
          <section className="home-section home-section--clubs">
            <SectionHeading eyebrow="Choose the room" title="Current rooms" action={<ButtonLink href="/clubs" tone="quiet">All clubs<ArrowRight aria-hidden="true" size={16} /></ButtonLink>} />
            {clubs.length ? <div className="club-grid">{clubs.map((club) => <ClubCard key={club.club.id} club={club} distanceMiles={Number.POSITIVE_INFINITY} />)}</div> : <EmptyState title="No clubs published yet" message="Orbit will show legitimate empty states until a room publishes current inventory." />}
          </section>
          <ScrollReveal><section className="orbit-loop" aria-labelledby="orbit-loop-heading"><p className="eyebrow">A shorter path to the table</p><h2 id="orbit-loop-heading">From “I want to play” to a real room.</h2><ol><li><span>01</span><strong>Discover</strong><p>See what rooms have published.</p></li><li><span>02</span><strong>Evaluate</strong><p>Check the game, place, and timing.</p></li><li><span>03</span><strong>Commit</strong><p>Send the room one clear request.</p></li><li><span>04</span><strong>Arrive</strong><p>Walk in with the room informed.</p></li></ol></section></ScrollReveal>
        </div>
      ) : null}
      <ScrollReveal direction="left"><OrbitFaq /></ScrollReveal>
    </>
  );
}
