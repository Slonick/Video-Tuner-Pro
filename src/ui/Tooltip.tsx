// Shared tooltip on Radix Tooltip: portals out of the cards' overflow/clipping,
// flips/shifts to stay in view, opens on hover + focus, dismisses on Escape /
// blur. Content IS the .tip bubble (Radix positions it). The fade-in is a CSS
// animation keyed off Radix's data-state — motion.dev's `m` does NOT animate
// inside Radix's portal (the LazyMotion feature context doesn't reach it), so a
// motion wrapper here just leaves the bubble stuck at its initial opacity:0.
// Needs a Tooltip.Provider ancestor (in MotionProvider).
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface Props {
  trigger: ReactNode; // the element that opens the tooltip (rendered via asChild)
  content: ReactNode;
  side?: "top" | "bottom";
  bubbleClassName?: string; // extra classes on the .tip bubble (e.g. "warn kbd-tip")
}

export function Tooltip({ trigger, content, side = "top", bubbleClassName }: Props) {
  return (
    <RadixTooltip.Root delayDuration={0}>
      <RadixTooltip.Trigger asChild>{trigger}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className={["tip", bubbleClassName].filter(Boolean).join(" ")}
          side={side}
          sideOffset={8}
          collisionPadding={8}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
