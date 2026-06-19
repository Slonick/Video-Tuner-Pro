// The "Save for" segmented control (Global / Site / Channel) with the sliding
// accent pill. The pill is positioned imperatively (movePill) via a layout effect
// whenever the active option or the channel column changes. The Channel segment
// shows only when the page reports a channel.
import { useLayoutEffect, useRef } from "react";
import { movePill } from "../core/seg-pill.js";
import { msg } from "../i18n.js";
import type { Scope, ScopeFlags } from "../lib/scope.js";

interface Props {
  name: "scope" | "syncScope" | "autoScope"; // id prefix → matches the original element ids
  ariaLabel: string;
  scope: Scope;
  saved: ScopeFlags;
  hasChannel: boolean;
  // The card's expanded state: opening into the full-popup overlay widens the
  // segment, so the pill must re-measure (offsetLeft/width shift with it).
  open: boolean;
  onPick: (scope: Scope) => void;
}

const OPTIONS: Array<{ scope: Scope; labelKey: string; titleKey: string; extra?: string }> = [
  { scope: "global", labelKey: "scopeGlobal", titleKey: "tipScopeGlobal" },
  { scope: "site", labelKey: "scopeSite", titleKey: "tipScopeSite" },
  {
    scope: "channel",
    labelKey: "scopeChannel",
    titleKey: "tipScopeChannel",
    extra: "scope-channel",
  },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function ScopeSegment({ name, ariaLabel, scope, saved, hasChannel, open, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    movePill(ref.current);
  }, [scope, hasChannel, open]);

  return (
    <div
      ref={ref}
      className={"scope-seg" + (hasChannel ? " has-channel" : "")}
      id={`${name}Seg`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <span className="seg-pill" aria-hidden="true"></span>
      {OPTIONS.map((o) => (
        <button
          key={o.scope}
          type="button"
          id={`${name}${cap(o.scope)}`}
          className={
            "scope-opt" +
            (o.extra ? " " + o.extra : "") +
            (scope === o.scope ? " active" : "") +
            (saved[o.scope] ? " has-saved" : "")
          }
          data-scope={o.scope}
          role="radio"
          aria-checked={scope === o.scope}
          title={msg(o.titleKey)}
          onClick={() => onPick(o.scope)}
        >
          {msg(o.labelKey)}
        </button>
      ))}
    </div>
  );
}
