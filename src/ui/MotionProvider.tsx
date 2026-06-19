// Wraps each page root (popup App, options page) so the lightweight `m` components
// work. The page passes its own LazyMotion feature bundle so each only ships what
// it needs: popup uses `domMax` (the sliding segment pill needs layout/layoutId),
// options the smaller `domAnimation`. Importing the bundle in the page (not here)
// keeps esbuild from pulling domMax into the options chunk. `strict` forbids
// `motion.*`, forcing `m.*` so the bundle saving can't regress unnoticed.
import { LazyMotion } from "motion/react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";

type Features = ComponentProps<typeof LazyMotion>["features"];

export function MotionProvider({
  children,
  features,
}: {
  children: ReactNode;
  features: Features;
}) {
  return (
    <LazyMotion features={features} strict>
      <RadixTooltip.Provider delayDuration={0} skipDelayDuration={0}>
        {children}
      </RadixTooltip.Provider>
    </LazyMotion>
  );
}
