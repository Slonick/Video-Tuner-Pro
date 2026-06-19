// The "Save for" segmented control (Global / Site / Channel) on Radix ToggleGroup
// (roving focus + arrow-key nav), with a single accent pill that glides to the
// active option via motion.dev's shared-layout animation (layoutId) — no more
// imperative measuring. The Channel option shows only when the page reports one.
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { m } from "motion/react";
import { controlSpring, useTransitionFor } from "../../ui/motion.js";
import { msg } from "../i18n.js";
import type { Scope, ScopeFlags } from "../lib/scope.js";

interface Props {
  name: "scope" | "syncScope" | "autoScope"; // id prefix → matches the original element ids
  ariaLabel: string;
  scope: Scope;
  saved: ScopeFlags;
  hasChannel: boolean;
  // The card's expanded state: opening into the full-popup overlay widens the
  // segment. Kept in the props (callers pass it) so a change re-renders here and
  // motion's layout re-measures the pill — it isn't read directly.
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

export function ScopeSegment({ name, ariaLabel, scope, saved, hasChannel, onPick }: Props) {
  const transition = useTransitionFor(controlSpring);

  return (
    <ToggleGroup.Root
      type="single"
      value={scope}
      onValueChange={(v) => {
        if (v) onPick(v as Scope); // ignore the empty value Radix sends on re-click
      }}
      className={"scope-seg" + (hasChannel ? " has-channel" : "")}
      id={`${name}Seg`}
      aria-label={ariaLabel}
    >
      {OPTIONS.map((o) => {
        const active = scope === o.scope;
        return (
          <ToggleGroup.Item
            key={o.scope}
            value={o.scope}
            id={`${name}${cap(o.scope)}`}
            className={
              "scope-opt" +
              (o.extra ? " " + o.extra : "") +
              (active ? " active" : "") +
              (saved[o.scope] ? " has-saved" : "")
            }
            data-scope={o.scope}
            title={msg(o.titleKey)}
          >
            {active && (
              <m.span
                className="seg-pill"
                aria-hidden="true"
                layoutId={`pill-${name}`}
                transition={transition}
              />
            )}
            <span className="scope-label">{msg(o.labelKey)}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
