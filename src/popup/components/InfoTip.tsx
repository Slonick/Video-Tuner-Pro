// The little "i" info bubble (and the amber "warn" variant) with a tooltip.
// Positioning, portalling and open/dismiss come from the shared Radix Tooltip;
// this just supplies the trigger icon and the bubble's content + variant classes.
import { type ReactNode } from "react";
import { Tooltip } from "../../ui/Tooltip.js";
import { InfoIcon, WarnIcon } from "../icons.js";

interface Props {
  tip?: string; // simple text tooltip
  children?: ReactNode; // structured content (e.g. the keyboard hints)
  below?: boolean; // prefer opening downward (Radix still flips if cramped)
  warn?: boolean; // amber warning variant (uses WarnIcon)
  beta?: boolean; // a "β" in a ring (marks a beta feature); tooltip explains it
  className?: string; // extra class on the bubble (e.g. "kbd-tip")
  id?: string;
  label?: string; // trigger aria-label
}

export function InfoTip({ tip, children, below, warn, beta, className, id, label }: Props) {
  return (
    <Tooltip
      side={below || warn ? "bottom" : "top"}
      bubbleClassName={[warn && "warn", className].filter(Boolean).join(" ")}
      content={children ?? tip}
      trigger={
        <span
          className={"info" + (warn ? " warn" : "") + (beta ? " beta" : "")}
          id={id}
          tabIndex={0}
          aria-label={label ?? (beta ? "Beta" : warn ? "Warning" : "Info")}
        >
          {beta ? <span className="beta-glyph">β</span> : warn ? <WarnIcon /> : <InfoIcon />}
        </span>
      }
    />
  );
}
