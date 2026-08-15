'use client';

import { useState, useEffect, useRef, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
} from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OrbitFeatureCards } from "./orbit-feature-cards";

// ─── Data ─────────────────────────────────────────────────────────────────────

const DECK = [
  { id: 0, game: "No-Limit Hold'em", stakes: "$2 / $5",   room: "The Commerce Club",     dist: "0.8 mi", seats: 2, total: 9, wait: 5,  open: true  },
  { id: 1, game: "Pot-Limit Omaha",  stakes: "$5 / $10",  room: "Hollywood Park Casino",  dist: "2.1 mi", seats: 0, total: 8, wait: 12, open: false },
  { id: 2, game: "No-Limit Hold'em", stakes: "$1 / $3",   room: "Private Game · West LA", dist: "1.4 mi", seats: 3, total: 9, wait: 0,  open: true  },
  { id: 3, game: "Mixed H.O.R.S.E.", stakes: "$10 / $20", room: "Crystal Casino",         dist: "3.2 mi", seats: 1, total: 8, wait: 7,  open: true  },
];

const SECTIONS = [
  {
    num: "01", label: "Discover",
    headline: "Nearby games,\nmatched to you.",
    body: "Browse real games at card houses and private rooms by distance, stakes, variant, seat counts, and waitlists — live from the room.",
  },
  {
    num: "02", label: "Join",
    headline: "Swipe right.\nSeat requested.",
    body: "One gesture to request a seat or join a waitlist. Your request reaches the room operator immediately — no calls, no messages.",
  },
  {
    num: "03", label: "Queue",
    headline: "You're #3.\nYou'll know\nwhen you move.",
    body: "See your exact waitlist position at all times. When a seat opens, you're notified the moment the room moves you up.",
  },
  {
    num: "04", label: "Memberships",
    headline: "Every club.\nOne place.",
    body: "Request access and review active, pending, and expired poker-club memberships from one private My Orbit account.",
  },
];

// ─── Orbital node definitions (SVG viewBox 500×500, center 250,250) ───────────

const NODES = [
  { rx: 72,  ry: 36,  x: 305, y: 227, dur: 15, begin: 0    },
  { rx: 120, ry: 60,  x: 137, y: 271, dur: 20, begin: -5   },
  { rx: 168, ry: 84,  x: 358, y: 314, dur: 26, begin: -9   },
  { rx: 215, ry: 107, x: 98,  y: 174, dur: 33, begin: -14  },
];

// Ghost dot orbit paths
const GHOST_PATHS = [
  "M 322,250 A 72,36 0 1,0 178,250 A 72,36 0 1,0 322,250",
  "M 370,250 A 120,60 0 1,0 130,250 A 120,60 0 1,0 370,250",
  "M 418,250 A 168,84 0 1,0 82,250 A 168,84 0 1,0 418,250",
  "M 465,250 A 215,107 0 1,0 35,250 A 215,107 0 1,0 465,250",
];

// ─── Orbital SVG ──────────────────────────────────────────────────────────────
// active: -1 = hero (all dim), 0-3 = feature node highlighted

function Orbital({ active }: { active: number }) {
  const isHero = active === -1;

  return (
    <svg viewBox="0 0 500 500" fill="none" className="w-full h-full" aria-hidden="true">
      <defs>
        {GHOST_PATHS.map((d, i) => <path key={i} id={`gp${i}`} d={d} />)}
      </defs>

      {/* Orbit rings */}
      {NODES.map((n, i) => {
        const on = active === i;
        return (
          <ellipse
            key={i} cx={250} cy={250} rx={n.rx} ry={n.ry}
            stroke="#F2EDE3"
            strokeWidth={on ? "0.9" : "0.5"}
            opacity={on ? 0.3 : isHero ? 0.13 : 0.06}
            style={{ transition: "opacity 1s ease, stroke-width 1s ease" }}
          />
        );
      })}

      {/* Travelling ghost dots */}
      {NODES.map((n, i) => {
        const on = active === i;
        return (
          <circle key={i} r="2.5" fill="#F2EDE3"
            opacity={on ? 0.35 : isHero ? 0.18 : 0.08}
            style={{ transition: "opacity 1s ease" }}
          >
            <animateMotion dur={`${n.dur}s`} repeatCount="indefinite" begin={`${n.begin}s`}>
              <mpath href={`#gp${i}`} />
            </animateMotion>
          </circle>
        );
      })}

      {/* Pulsing aura on active node */}
      {active >= 0 && (() => {
        const n = NODES[active];
        return (
          <g>
            <circle cx={n.x} cy={n.y} fill="#191970">
              <animate attributeName="r"       values="14;26;14" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.09;0.02;0.09" dur="2.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={n.x} cy={n.y} fill="none" stroke="#191970" strokeWidth="0.8">
              <animate attributeName="r"       values="10;20;10" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.45;0;0.45" dur="2.6s" repeatCount="indefinite" />
            </circle>
          </g>
        );
      })()}

      {/* Node dots — motion.circle for smooth state transitions */}
      {NODES.map((n, i) => {
        const on = active === i;
        return (
          <motion.circle key={i} cx={n.x} cy={n.y}
            animate={{
              r:       on ? 9 : isHero ? 5 : 3.5,
              fill:    on ? "#191970" : "#F2EDE3",
              opacity: on ? 1 : isHero ? 0.32 : 0.16,
            }}
            transition={{ duration: 0.9, ease: [0.22, 0, 0, 1] }}
          />
        );
      })}

      {/* Connection line: center → active node */}
      {active >= 0 && (() => {
        const n = NODES[active];
        return (
          <motion.line
            x1={250} y1={250} x2={n.x} y2={n.y}
            stroke="#191970" strokeWidth="0.5"
            initial={{ opacity: 0 }} animate={{ opacity: 0.2 }}
            transition={{ duration: 0.8 }}
            strokeDasharray="3 5"
          />
        );
      })()}

      {/* Center hub */}
      <circle cx={250} cy={250} r="5" fill="#F2EDE3" opacity="0.4" />
      <circle cx={250} cy={250} r="13" fill="#F2EDE3" opacity="0.04" />
    </svg>
  );
}

// ─── Swipe Card ───────────────────────────────────────────────────────────────

function SwipeCard({
  game,
  onSwipe,
}: {
  game: typeof DECK[0];
  onSwipe: (dir: "left" | "right") => void;
}) {
  const x = useMotionValue(0);
  const rotate     = useTransform(x, [-240, 240], [-20, 20]);
  const joinOpacity = useTransform(x, [35, 110], [0, 1]);
  const passOpacity = useTransform(x, [-110, -35], [1, 0]);

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number } }) => {
      if (info.offset.x > 100)  onSwipe("right");
      else if (info.offset.x < -100) onSwipe("left");
    },
    [onSwipe]
  );

  return (
    <motion.div
      key={game.id}
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: -400, right: 400 }}
      dragElastic={0.18}
      onDragEnd={handleDragEnd}
      className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none select-none"
      transition={{ duration: 0.3, ease: [0.22, 0, 0, 1] }}
    >
      {/* Swipe indicators */}
      <motion.div
        className="absolute top-5 right-5 z-20 font-mono text-[10px] tracking-widest text-[#4AA8A0] border border-[#4AA8A0]/50 bg-[#4AA8A0]/10 px-2.5 py-1 rounded-sm uppercase pointer-events-none"
        style={{ rotate: -14, opacity: joinOpacity }}
      >
        Join ✓
      </motion.div>
      <motion.div
        className="absolute top-5 left-5 z-20 font-mono text-[10px] tracking-widest text-[#6B6559] border border-[#6B6559]/40 bg-[#6B6559]/10 px-2.5 py-1 rounded-sm uppercase pointer-events-none"
        style={{ rotate: 14, opacity: passOpacity }}
      >
        Pass
      </motion.div>

      {/* Card body */}
      <div className="w-full h-full bg-[#0B1520] border border-[#F2EDE3]/10 rounded-sm overflow-hidden flex flex-col">
        <div className={`h-[3px] flex-shrink-0 ${game.open ? "bg-[#191970]" : "bg-[#3D7575]"}`} />

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-[#F2EDE3]/6 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-mono text-[8px] tracking-[0.18em] text-[#F2EDE3]/28 uppercase mb-1">{game.dist}</p>
            <p className="text-[12px] font-semibold text-[#F2EDE3]/60 tracking-tight">{game.room}</p>
          </div>
          <div className="w-6 h-6 rounded-full border border-[#F2EDE3]/10 flex items-center justify-center">
            <div className="w-[5px] h-[5px] rounded-full bg-[#191970]" />
          </div>
        </div>

        {/* Main content */}
        <div className="px-5 py-5 flex-1 flex flex-col min-h-0">
          <p className="font-mono text-[8px] tracking-[0.18em] text-[#6868B3] uppercase mb-3">{game.game}</p>
          <div className="mb-4">
            <p className="text-[44px] font-bold tracking-[-0.04em] text-[#F2EDE3] leading-none">
              {game.stakes.split("/")[0].trim()}
            </p>
            <p className="font-mono text-[11px] text-[#F2EDE3]/28 mt-1">
              / {game.stakes.split("/")[1].trim()} blinds
            </p>
          </div>

          <div className="mt-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[8px] text-[#F2EDE3]/20 tracking-widest uppercase">Seats</span>
              <span className="font-mono text-[8px] text-[#F2EDE3]/30">{game.seats} / {game.total} open</span>
            </div>
            <div className="flex gap-[3px] mb-4">
              {Array.from({ length: game.total }).map((_, i) => (
                <div key={i} className={`h-[3px] flex-1 rounded-full ${
                  i < game.total - game.seats ? "bg-[#F2EDE3]/12" : "bg-[#191970]"
                }`} />
              ))}
            </div>

            {game.wait > 0 && (
              <p className="font-mono text-[8px] text-[#F2EDE3]/20 mb-3">{game.wait} on waitlist</p>
            )}

            <span className={`font-mono text-[8px] tracking-widest px-2.5 py-1 border rounded-sm uppercase ${
              game.open
                ? "text-[#7E7EC3] border-[#191970]/35 bg-[#191970]/8"
                : "text-[#3D7575] border-[#3D7575]/35 bg-[#3D7575]/8"
            }`}>
              {game.open ? `${game.seats} seat${game.seats !== 1 ? "s" : ""} open` : "Waitlist only"}
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#F2EDE3]/6 flex items-center justify-between flex-shrink-0">
          <span className="font-mono text-[7px] text-[#F2EDE3]/15 tracking-wider">← pass</span>
          <span className="font-mono text-[7px] text-[#F2EDE3]/15 tracking-wider">join →</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Section content ─────────────────────────────────────────────────────────

function BrowseContent() {
  return (
    <div className="w-full max-w-[360px] space-y-2">
      {DECK.slice(0, 3).map((g, i) => (
        <motion.div
          key={g.id}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.08, duration: 0.45, ease: [0.22, 0, 0, 1] }}
          className="flex items-center gap-3 bg-[#0B1520] border border-[#F2EDE3]/7 rounded-sm px-4 py-3 hover:border-[#F2EDE3]/15 transition-colors duration-200 cursor-default"
        >
          <div className={`w-[3px] h-8 rounded-full flex-shrink-0 ${g.open ? "bg-[#191970]" : "bg-[#3D7575]"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#F2EDE3]/70 tracking-tight truncate">{g.game}</p>
            <p className="font-mono text-[8px] text-[#F2EDE3]/25 mt-0.5 truncate">{g.room}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-mono text-[11px] text-[#F2EDE3]/50 font-medium">{g.stakes}</p>
            <p className="font-mono text-[7px] text-[#F2EDE3]/20 mt-0.5">{g.dist}</p>
          </div>
        </motion.div>
      ))}
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="font-mono text-[7px] text-[#F2EDE3]/14 tracking-wider pt-1"
      >
        11 games near you · updated 8 seconds ago
      </motion.p>
    </div>
  );
}

function SwipeContent({
  cardIdx,
  onSwipe,
  confirmed,
}: {
  cardIdx: number;
  onSwipe: (d: "left" | "right") => void;
  confirmed: boolean;
}) {
  return (
    <div className="relative">
      <div className="relative w-[230px] h-[340px]">
        {/* Static depth cards behind */}
        <div className="absolute inset-0 translate-y-[10px] rotate-[4deg] scale-[0.92] bg-[#0B1520] border border-[#F2EDE3]/5 rounded-sm" />
        <div className="absolute inset-0 translate-y-[5px] rotate-[-2.5deg] scale-[0.96] bg-[#0B1520] border border-[#F2EDE3]/7 rounded-sm" />

        {/* Live swipeable card */}
        <AnimatePresence mode="wait">
          <SwipeCard
            key={cardIdx}
            game={DECK[cardIdx % DECK.length]}
            onSwipe={onSwipe}
          />
        </AnimatePresence>
      </div>

      {/* Seat confirmed toast */}
      <AnimatePresence>
        {confirmed && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.28, ease: [0.22, 0, 0, 1] }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-[#070E18] border border-[#4AA8A0]/35 rounded-sm px-7 py-5 text-center shadow-2xl">
              <div className="w-7 h-7 rounded-full border border-[#4AA8A0]/45 bg-[#4AA8A0]/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-[#4AA8A0] text-xs">✓</span>
              </div>
              <p className="text-[#F2EDE3]/75 font-semibold text-[12px] tracking-tight mb-1">Seat Requested</p>
              <p className="font-mono text-[7px] text-[#F2EDE3]/25 tracking-wider">Room notified · you&apos;re on the list</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!confirmed && (
        <p className="font-mono text-[7px] text-[#F2EDE3]/14 tracking-wider mt-4 text-center">
          drag the card to try it
        </p>
      )}
    </div>
  );
}

function WaitlistContent() {
  const pos = 3, total = 8;
  return (
    <div className="w-full max-w-[300px] bg-[#0B1520] border border-[#F2EDE3]/7 rounded-sm overflow-hidden">
      <div className="h-[3px] bg-[#191970]" />
      <div className="px-5 pt-5 pb-4 border-b border-[#F2EDE3]/6">
        <p className="font-mono text-[7px] tracking-[0.18em] text-[#F2EDE3]/20 uppercase mb-1">
          No-Limit Hold&apos;em · $2 / $5
        </p>
        <p className="text-[12px] font-semibold text-[#F2EDE3]/55 tracking-tight">The Commerce Club</p>
      </div>
      <div className="px-5 py-5">
        <p className="font-mono text-[7px] tracking-[0.2em] text-[#F2EDE3]/20 uppercase mb-2">Your Position</p>
        <div className="flex items-baseline gap-2 mb-5">
          <span className="text-[56px] font-bold text-[#6868B3] leading-none tracking-[-0.04em]">#3</span>
          <span className="font-mono text-[9px] text-[#F2EDE3]/22">of {total}</span>
        </div>
        <div className="flex items-center gap-2 mb-5">
          {Array.from({ length: total }).map((_, i) => {
            const filled = i < pos;
            const isMe = i === pos - 1;
            return (
              <div key={i} className={`rounded-full transition-all duration-500 ${
                isMe
                  ? "w-4 h-4 bg-[#191970]"
                  : filled
                  ? "w-2 h-2 bg-[#F2EDE3]/28"
                  : "w-2 h-2 bg-[#F2EDE3]/8 border border-[#F2EDE3]/10"
              }`} />
            );
          })}
        </div>
        <div className="space-y-2">
          {["Estimated wait ~20 min", "Notified the moment a seat opens", "Cancel anytime before seating"].map((t) => (
            <div key={t} className="flex items-center gap-2.5">
              <span className="w-1 h-1 rounded-full bg-[#F2EDE3]/16 flex-shrink-0" />
              <p className="font-mono text-[8px] text-[#F2EDE3]/32 tracking-wide">{t}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MembershipContent() {
  const memberships = [
    { club: "The Commerce Club", detail: "Annual membership", status: "Active", active: true },
    { club: "Hollywood Park Casino", detail: "Access request", status: "Under review", active: false },
    { club: "West LA Poker Club", detail: "Day membership", status: "Active", active: true },
  ];
  return (
    <div className="w-full max-w-[360px] bg-[#0B1520] border border-[#F2EDE3]/7 rounded-sm overflow-hidden">
      <div className="h-[3px] bg-[#191970]" />
      <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#F2EDE3]/6">
        <div>
          <p className="font-mono text-[7px] tracking-[0.2em] text-[#6868B3] uppercase mb-1">My Orbit</p>
          <p className="text-[13px] font-semibold text-[#F2EDE3]/70">My memberships</p>
        </div>
        <span className="font-mono text-[7px] text-[#F2EDE3]/22">3 clubs</span>
      </div>
      <div className="divide-y divide-[#F2EDE3]/6">
        {memberships.map((membership, index) => (
          <motion.div
            key={membership.club}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.08, duration: 0.35 }}
            className="px-5 py-3 flex items-center gap-3"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${membership.active ? "bg-[#4AA8A0]" : "bg-[#191970]"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-[#F2EDE3]/65 truncate">{membership.club}</p>
              <p className="font-mono text-[7px] text-[#F2EDE3]/20 mt-0.5">{membership.detail}</p>
            </div>
            <span className={`font-mono text-[7px] ${membership.active ? "text-[#4AA8A0]" : "text-[#F2EDE3]/30"}`}>{membership.status}</span>
          </motion.div>
        ))}
      </div>
      <Link href="/me/clubs" className="h-10 mx-5 my-4 rounded-sm text-[11px] font-semibold bg-[#191970] text-[#F2EDE3] hover:bg-[#24248F] transition-colors duration-200 flex items-center justify-center gap-2">
        Manage memberships <ArrowRight size={12} />
      </Link>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function PlayerLanding() {
  const [scrolled,      setScrolled]      = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [cardIdx,       setCardIdx]       = useState(0);
  const [confirmed,     setConfirmed]     = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Nav shadow + scroll-driven section tracking via native listener
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40);

      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // How far the user has scrolled into the sticky container
      const scrolled = Math.max(0, -rect.top);
      // Total scrollable range = container height minus one viewport height
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const progress = Math.min(1, scrolled / total);
      setActiveSection(Math.min(3, Math.floor(progress * 4)));
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // run once on mount to set initial state
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSwipe = useCallback((dir: "left" | "right") => {
    if (dir === "right") {
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 2400);
    }
    setTimeout(() => setCardIdx((n) => n + 1), 300);
  }, []);

  return (
    <div className="player-landing bg-[#070D16] text-[#F2EDE3] font-sans">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className={`player-landing__nav fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-[#070D16]/96 backdrop-blur-md border-b border-[#F2EDE3]/5" : ""
      }`}>
        <div className="max-w-[1200px] mx-auto px-8 h-[58px] flex items-center justify-between">
          <Link href="/" aria-label="Orbit Player home" className="flex items-center gap-2.5">
            <Image src="/orbit-logo.svg" width={20} height={20} alt="" priority />
            <span className="text-[14px] font-semibold tracking-tight">
              Orbit <span className="text-[#F2EDE3]/35">Player</span>
            </span>
          </Link>
          <nav aria-label="Landing navigation" className="flex items-center gap-4">
            <Link href="/games" className="hidden sm:flex text-[11px] font-medium text-[#F2EDE3]/40 hover:text-[#F2EDE3]/70 transition-colors duration-200">Find games</Link>
            <Link href="/me" className="h-8 px-4 text-[11px] font-semibold tracking-wide rounded-sm bg-[#191970] text-[#F2EDE3] hover:bg-[#24248F] transition-colors duration-200 flex items-center">
              Open My Orbit
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero — full screen, orbital dominant ─────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">

        {/* The orbital — large, centered, IS the hero */}
        <motion.div
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-[min(420px,72vw)] aspect-square"
        >
          <Orbital active={-1} />
        </motion.div>

        {/* Text rides below the orbital center */}
        <div className="relative z-10 text-center px-8 -mt-8 max-w-[940px]">
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="font-mono text-[9px] tracking-[0.3em] text-[#6868B3] uppercase mb-5"
          >
            Orbit Player
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.8, ease: [0.22, 0, 0, 1] }}
            className="text-[42px] md:text-[64px] font-bold tracking-[-0.03em] leading-[1.06] mb-5"
          >
            Find poker games near you.
            <br />
            <span className="text-[#F2EDE3]/45">Keep every membership together.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.92, ease: [0.22, 0, 0, 1] }}
            className="text-[#F2EDE3]/48 text-[15px] leading-[1.8] max-w-[600px] mx-auto mb-9"
          >
            Orbit Player helps you find live games that match your distance, stakes, and preferred format — then request a seat, track your place, and manage all your poker-club memberships in one place.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.05 }}
            className="flex items-center justify-center gap-3"
          >
            <Link href="/games" className="h-11 px-7 text-[13px] font-semibold rounded-sm bg-[#191970] text-[#F2EDE3] hover:bg-[#24248F] transition-colors duration-200 flex items-center gap-2">
              Find games near me <ArrowRight size={13} />
            </Link>
            <Link href="/me/clubs" className="h-11 px-7 text-[13px] font-medium rounded-sm text-[#F2EDE3]/42 border border-[#F2EDE3]/10 hover:text-[#F2EDE3]/70 hover:border-[#F2EDE3]/22 transition-all duration-200 flex items-center">
              Manage memberships
            </Link>
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.8 }}
          className="absolute bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
        >
          <motion.div
            animate={{ y: [0, 5, 0] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown size={13} className="text-[#F2EDE3]/16" />
          </motion.div>
          <span className="font-mono text-[7px] tracking-[0.2em] text-[#F2EDE3]/10 uppercase">Scroll</span>
        </motion.div>
      </section>

      <OrbitFeatureCards />

      {/* ── Sticky scroll experience ─────────────────────────────────────── */}
      {/* 500vh outer container — drives scroll progress 0→1 */}
      <div id="how-it-works" className="player-landing__experience" ref={scrollRef} style={{ height: "500vh", position: "relative" }}>
        <div className="sticky top-0 overflow-hidden flex" style={{ height: "100vh" }}>

          {/* LEFT — Orbital panel, stays fixed while content scrolls */}
          <div className="hidden md:flex w-[46%] flex-col items-center justify-center bg-[#050B13] border-r border-[#F2EDE3]/4 relative" style={{ height: "100%" }}>
            <div className="w-full max-w-[390px] px-10 aspect-square">
              <Orbital active={activeSection} />
            </div>

            {/* Section label — bottom left */}
            <div className="absolute bottom-9 left-10">
              <AnimatePresence>
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5, position: "absolute" }}
                  transition={{ duration: 0.28 }}
                >
                  <p className="font-mono text-[8px] tracking-[0.22em] text-[#F2EDE3]/14 uppercase">
                    {SECTIONS[activeSection].num}
                  </p>
                  <p className="font-mono text-[11px] tracking-[0.1em] text-[#6868B3] uppercase mt-0.5">
                    {SECTIONS[activeSection].label}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Progress indicator — right edge */}
            <div className="absolute right-5 top-1/2 -translate-y-1/2 flex flex-col gap-3">
              {SECTIONS.map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    height: activeSection === i ? 22 : 5,
                    backgroundColor: activeSection === i ? "#191970" : "rgba(242,237,227,0.1)",
                  }}
                  transition={{ duration: 0.4, ease: [0.22, 0, 0, 1] }}
                  style={{ width: 4, borderRadius: 99 }}
                />
              ))}
            </div>
          </div>

          {/* RIGHT — Content panel, changes with scroll */}
          <div className="flex-1 flex flex-col justify-center bg-[#070D16] overflow-hidden" style={{ height: "100%" }}>
            <AnimatePresence>
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12, position: "absolute" }}
                transition={{ duration: 0.42, ease: [0.22, 0, 0, 1] }}
                className="px-10 md:px-14 py-10 w-full"
              >
                {/* Section header */}
                <p className="font-mono text-[9px] tracking-[0.24em] text-[#6868B3] uppercase mb-5">
                  {SECTIONS[activeSection].num} — {SECTIONS[activeSection].label}
                </p>
                <h2 className="text-[34px] md:text-[44px] font-bold tracking-[-0.025em] leading-[1.08] mb-5 whitespace-pre-line">
                  {SECTIONS[activeSection].headline}
                </h2>
                <p className="text-[#F2EDE3]/36 text-[14px] leading-[1.8] max-w-[360px] mb-9">
                  {SECTIONS[activeSection].body}
                </p>

                {/* Section-specific interactive content */}
                {activeSection === 0 && <BrowseContent />}
                {activeSection === 1 && (
                  <SwipeContent cardIdx={cardIdx} onSwipe={handleSwipe} confirmed={confirmed} />
                )}
                {activeSection === 2 && <WaitlistContent />}
                {activeSection === 3 && <MembershipContent />}
              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </div>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="player-landing__cta py-44 bg-[#050B13] border-t border-[#F2EDE3]/4">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="max-w-[560px]">
            <motion.p
              initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.6 }}
              className="font-mono text-[9px] tracking-[0.26em] text-[#6868B3] uppercase mb-8"
            >
              Orbit Player
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.75, delay: 0.06 }}
              className="text-[46px] md:text-[58px] font-bold tracking-[-0.03em] leading-[1.06] mb-6"
            >
              Your next game.<br />Every club. One player hub.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.65, delay: 0.12 }}
              className="text-[#F2EDE3]/38 text-[15px] leading-[1.8] mb-10 max-w-[430px]"
            >
              Orbit Player connects you to participating rooms, helps you choose a nearby game that fits, and keeps your seats, waitlists, tournaments, and memberships together.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.55, delay: 0.18 }}
              className="flex flex-wrap gap-3"
            >
              <Link href="/games" className="h-11 px-8 text-[13px] font-semibold rounded-sm bg-[#191970] text-[#F2EDE3] hover:bg-[#24248F] transition-colors duration-200 flex items-center gap-2 w-fit">
                Browse games <ArrowRight size={13} />
              </Link>
              <Link href="/sign-in?returnTo=%2Fme%2Fclubs" className="h-11 px-8 text-[13px] font-medium rounded-sm text-[#F2EDE3]/42 border border-[#F2EDE3]/10 hover:text-[#F2EDE3]/70 hover:border-[#F2EDE3]/22 transition-all duration-200 flex items-center w-fit">
                Sign in to My Orbit
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="player-landing__footer bg-[#030710] border-t border-[#F2EDE3]/4 py-8">
        <div className="max-w-[1200px] mx-auto px-8 flex items-center justify-between">
          <Link href="/" aria-label="Orbit Player home" className="flex items-center gap-2">
            <Image src="/orbit-logo.svg" width={17} height={17} alt="" />
            <span className="text-[#F2EDE3]/25 text-[11px] font-semibold">Orbit Player</span>
          </Link>
          <nav aria-label="Landing footer" className="flex items-center gap-5">
            <a href="https://orbitapp-one.vercel.app/" className="text-[10px] text-[#F2EDE3]/14 hover:text-[#F2EDE3]/40 transition-colors duration-200">Orbit Core</a>
            <Link href="/privacy" className="text-[10px] text-[#F2EDE3]/14 hover:text-[#F2EDE3]/40 transition-colors duration-200">Privacy</Link>
            <a href="https://orbitapp-one.vercel.app/terms" className="text-[10px] text-[#F2EDE3]/14 hover:text-[#F2EDE3]/40 transition-colors duration-200">Terms</a>
          </nav>
        </div>
      </footer>

    </div>
  );
}
