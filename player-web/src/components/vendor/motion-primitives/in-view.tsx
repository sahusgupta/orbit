'use client';

import { motion, useInView, useReducedMotion, type Transition, type UseInViewOptions, type Variants } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';

// Adapted from Motion Primitives' MIT-licensed InView component.
// Source: https://github.com/ibelick/motion-primitives/blob/main/components/core/in-view.tsx
export type InViewProps = {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  transition?: Transition;
  viewOptions?: UseInViewOptions;
  once?: boolean;
  primitiveName?: string;
  revealDirection?: string;
};

const defaultVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
};

export function InView({
  children,
  className,
  variants = defaultVariants,
  transition,
  viewOptions,
  once = true,
  primitiveName = 'in-view',
  revealDirection
}: InViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, viewOptions);
  const reduceMotion = useReducedMotion();
  const [wasViewed, setWasViewed] = useState(false);
  const visible = reduceMotion || isInView || wasViewed;

  return (
    <motion.div
      ref={ref}
      className={className}
      data-motion-primitive={primitiveName}
      data-reveal-direction={revealDirection}
      initial={reduceMotion ? false : 'hidden'}
      animate={visible ? 'visible' : 'hidden'}
      variants={variants}
      transition={reduceMotion ? { duration: 0 } : transition}
      onAnimationComplete={() => {
        if (once && isInView) setWasViewed(true);
      }}
    >
      {children}
    </motion.div>
  );
}
