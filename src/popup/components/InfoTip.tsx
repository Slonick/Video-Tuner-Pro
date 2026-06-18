// The little "i" info bubble with a tooltip. Tooltips open upward by default and
// flip below when the section sits too near the top; rows that always sit below
// (toggle rows) pass `below`. Ported from the tooltip logic in sections.ts.
import { useEffect, useRef, type ReactNode } from "react";
import { InfoIcon } from "../icons.js";

interface Props {
  tip?: string; // simple text tooltip
  children?: ReactNode; // structured tooltip content (e.g. the keyboard hints)
  below?: boolean; // pinned below — no auto-flip
}

export function InfoTip({ tip, children, below }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (below) return;
    const info = ref.current;
    const tipEl = info?.querySelector<HTMLElement>(".tip");
    if (!info || !tipEl) return;
    const place = () => {
      const head = info.closest(".sec-head") || info;
      const need = tipEl.offsetHeight + 16;
      info.classList.toggle("tip-below", head.getBoundingClientRect().top < need);
    };
    info.addEventListener("mouseenter", place);
    info.addEventListener("focusin", place);
    return () => {
      info.removeEventListener("mouseenter", place);
      info.removeEventListener("focusin", place);
    };
  }, [below]);

  return (
    <span
      ref={ref}
      className={"info" + (below ? " tip-below" : "")}
      tabIndex={0}
      role="button"
      aria-label="Info"
    >
      <InfoIcon />
      {children ?? <span className="tip">{tip}</span>}
    </span>
  );
}
