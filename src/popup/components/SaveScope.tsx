// "Save for" as a single menu button (no longer a split Save/Reset pair). The trigger
// is just "Save" and opens a popover that holds all the logic: a primary "Save <value>
// for <active scope>", a "Saved here … Remove" line for the active scope, and a
// "Save to" list of every scope (each row saves the current value there; a trash
// removes a scope that already has one). The popover is PORTALED to <body> with fixed
// coords so it escapes the cards' overflow clipping, flips up/down by available room,
// and closes on select / outside-click / Escape / scroll. Shared by the speed/
// live-sync/auto-slow cards — each passes its own labels + scope primitives.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ConfirmButton } from "../../ui/ConfirmButton.js";
import { msg } from "../i18n.js";
import type { Scope, ScopeFlags } from "../lib/scope.js";
import type { ScopeValues } from "../hooks/useScopeSelection.js";

const ORDER: Scope[] = ["global", "site", "channel"];
// Friendly, self-explanatory scope names for the menu (vs the terse "Site/Global").
const FULL_KEY: Record<Scope, string> = {
  global: "scopeEverywhere",
  site: "scopeThisSite",
  channel: "scopeThisChannel",
};
// Primary-button phrase per active scope — "Save <value> for this site", etc. ($1 is
// the current value). Kept as whole localized phrases so word order stays natural.
const PRIMARY_KEY: Record<Scope, string> = {
  global: "saveForGlobal",
  site: "saveForSite",
  channel: "saveForChannel",
};

interface Props {
  scope: Scope; // current default target
  saved: ScopeFlags;
  savedValues: ScopeValues; // raw stored value per scope (for the menu)
  currentValue: unknown; // the live value, shown in the primary ("Save 1.75× …")
  fmtValue: (value: unknown) => string; // format a stored value for display
  fmtCurrent?: (value: unknown) => string; // format the live value for the primary (defaults to fmtValue)
  hasChannel: boolean;
  saveLabel: string;
  savedLabel: string; // brief confirm shown after a save
  onSave: (target: Scope) => void | boolean | Promise<void | boolean>;
  onReset: (target: Scope) => void;
  onPick: (target: Scope) => void;
  saveId?: string;
  resetId?: string;
  disabled?: boolean;
}

interface Pos {
  left?: number; // anchor to the trigger's left edge…
  right?: number; // …or its right edge, when the trigger sits in the viewport's right half
  top?: number; // set when opening downward
  bottom?: number; // set when opening upward
  minWidth: number;
}

const chevron = (
  <svg className="scope-chev" viewBox="0 0 10 6" aria-hidden="true">
    <path
      d="M1 1.5 5 5l4-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const trash = (
  <svg className="scope-trash" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.6 8h5.8l.6-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function SaveScope({
  scope,
  saved,
  savedValues,
  currentValue,
  fmtValue,
  fmtCurrent,
  hasChannel,
  saveLabel,
  savedLabel,
  onSave,
  onReset,
  onPick,
  saveId,
  resetId,
  disabled = false,
}: Props) {
  const scopes = ORDER.filter((s) => s !== "channel" || hasChannel);
  const full = (s: Scope) => msg(FULL_KEY[s]);
  const removeLabel = msg("optDelete");
  const confirmLabel = msg("optConfirm") || "Confirm?";
  // The animated check renders the tick, so drop any leading ✓ glyph baked into the
  // localized confirm string.
  const savedClean = savedLabel.replace(/^[\s✓]+/u, "");

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Place the popover in viewport coords (it's portaled); flip up/down by room.
  useLayoutEffect(() => {
    if (!open) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const downward = below >= 250 || below >= r.top;
    // A narrow trigger near the right edge (e.g. inline beside a slider) would push a
    // left-anchored menu off-screen, so anchor to its right edge there instead.
    const anchorRight = r.left > window.innerWidth / 2;
    setPos({
      minWidth: Math.max(r.width, 200),
      ...(anchorRight ? { right: Math.max(8, window.innerWidth - r.right) } : { left: r.left }),
      ...(downward ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
    });
  }, [open]);

  // Focus the first action when the menu opens (close() restores focus to the trigger).
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open, pos]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (t: Node) => !rootRef.current?.contains(t) && !menuRef.current?.contains(t);
    const onDown = (e: PointerEvent) => {
      if (outside(e.target as Node)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      // Ignore focus falling back to <body> (e.g. when a button re-renders on arm) —
      // only a real focus move outside the popover should dismiss it.
      if (e.target !== document.body && outside(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const pulse = () => {
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 1100);
  };
  const save = (target: Scope) => {
    if (disabled) return;
    if (target !== scope) onPick(target);
    const done = (ok?: void | boolean) => {
      if (ok !== false) pulse();
      close();
    };
    const result = onSave(target);
    if (result && typeof (result as Promise<void | boolean>).then === "function") {
      void (result as Promise<void | boolean>).then(done, () => done(false));
    } else {
      done(result as void | boolean);
    }
  };
  const clear = (target: Scope) => {
    if (disabled) return;
    onReset(target);
    close();
  };

  // Keep keyboard focus inside the (portaled) popover: Escape closes; Tabbing past
  // either edge closes and returns focus to the trigger, so focus never leaks into the
  // popup tail behind the popover.
  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !menuRef.current) return;
    const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button"));
    if (!items.length) return;
    const atEdge = e.shiftKey
      ? document.activeElement === items[0]
      : document.activeElement === items[items.length - 1];
    if (atEdge) {
      e.preventDefault();
      close();
    }
  };

  // The primary names the value + active scope ("Save 1.75× for this site"); the
  // trigger stays a plain "Save" (the scope lives inside the menu now).
  const primaryLabel = msg(PRIMARY_KEY[scope], [(fmtCurrent ?? fmtValue)(currentValue)]);

  return (
    <div className="scope" ref={rootRef}>
      {/* Mirror the save confirm to a polite live region (4.1.3 status messages). */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {flash ? savedClean : ""}
      </span>

      <button
        type="button"
        ref={triggerRef}
        id={saveId}
        className="btn-action btn-default scope-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
          }
        }}
      >
        {flash ? (
          <>
            <svg className="scope-check" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2.5 7.5 6 11l5.5-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="scope-trigger-label">{savedClean}</span>
          </>
        ) : (
          <>
            <span className="scope-trigger-label">{saveLabel}</span>
            {chevron}
          </>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="scope-menu"
            role="dialog"
            aria-label={saveLabel}
            onKeyDown={onMenuKeyDown}
            style={{
              left: pos.left,
              right: pos.right,
              top: pos.top,
              bottom: pos.bottom,
              minWidth: pos.minWidth,
            }}
          >
            <button
              type="button"
              className="scope-primary"
              data-key={scope}
              disabled={disabled}
              onClick={() => save(scope)}
            >
              {primaryLabel}
            </button>

            {saved[scope] && (
              <div className="scope-subline">
                <span>
                  {msg("savedHereLabel")}: <b>{fmtValue(savedValues[scope])}</b>
                </span>
                <ConfirmButton
                  id={resetId}
                  className="scope-clear"
                  disabled={disabled}
                  confirmChildren={confirmLabel}
                  title={removeLabel}
                  confirmTitle={confirmLabel}
                  ariaLabel={`${removeLabel} · ${full(scope)}`}
                  onConfirm={() => clear(scope)}
                >
                  {trash}
                  <span>{removeLabel}</span>
                </ConfirmButton>
              </div>
            )}

            <div className="scope-divider" />
            {/* A labelled group so the "Save to" purpose reaches AT even though the
                heading is a styled div; rows also self-describe via aria-label. */}
            <div className="scope-section" role="group" aria-label={msg("saveToLabel")}>
              <div className="scope-sec" aria-hidden="true">
                {msg("saveToLabel")}
              </div>
              {scopes.map((s) => (
                <div className="scope-row-wrap" data-key={s} key={s}>
                  <button
                    type="button"
                    className="scope-row"
                    aria-label={`${saveLabel} · ${full(s)}`}
                    disabled={disabled}
                    onClick={() => save(s)}
                  >
                    <span className="scope-name">{full(s)}</span>
                    {saved[s] && <span className="scope-val">{fmtValue(savedValues[s])}</span>}
                  </button>
                  {saved[s] && (
                    <ConfirmButton
                      split
                      className="scope-del"
                      disabled={disabled}
                      confirmHint={confirmLabel}
                      ariaLabel={`${removeLabel} · ${full(s)}`}
                      confirmTitle={removeLabel}
                      cancelTitle={msg("optCancel") || "Cancel"}
                      onConfirm={() => clear(s)}
                    >
                      {trash}
                    </ConfirmButton>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
