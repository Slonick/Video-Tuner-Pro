// Reusable segmented control — a glass capsule whose selection is an accent pill
// that SLIDES to the chosen cell (measured offsets + CSS transition on .seg-pill).
// Used for the theme / language / on-video pickers (and mirrors the popup's scope
// picker). role=radiogroup with arrow-key roving focus. `cols` lays the cells out
// in a grid (the language picker); omit for a single row.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./anim.js";

interface Item<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  items: Item<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  id?: string;
  className?: string; // "seg" (row) or "lang-grid" (grid)
  disabled?: boolean;
}

const DIR: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  id,
  className = "seg",
  disabled = false,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const btns = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // While the pill slides to a new cell, flag the group `sliding`: the pill goes to
  // max glass then fills the accent back in (CSS), and the moving-to label stays
  // dark until it does so it isn't left unreadable on the clear glass.
  const [sliding, setSliding] = useState(false);
  const firstSlide = useRef(true);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const measure = useCallback(() => {
    const b = btns.current[value];
    if (!b) {
      setPill(null);
      return;
    }
    const width = b.offsetWidth;
    const height = b.offsetHeight;
    if (width <= 0 || height <= 0) {
      setPill(null);
      return;
    }
    setPill({ left: b.offsetLeft, top: b.offsetTop, width, height });
  }, [value]);

  useLayoutEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, items.length]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const root = rootRef.current;
    const active = btns.current[value];
    if (!root || !active) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(active);
    return () => ro.disconnect();
  }, [measure, value, items.length]);

  useEffect(() => {
    if (firstSlide.current) {
      firstSlide.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    setSliding(true);
    clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setSliding(false), 240);
    return () => clearTimeout(slideTimer.current);
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const d = DIR[e.key];
    if (!d) return;
    e.preventDefault();
    const idx = items.findIndex((it) => it.value === value);
    const next = items[(idx + d + items.length) % items.length];
    onChange(next.value);
    btns.current[next.value]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      id={id}
      ref={rootRef}
      className={
        className +
        (pill ? " has-pill" : "") +
        (sliding ? " sliding" : "") +
        (disabled ? " is-disabled" : "")
      }
      onKeyDown={onKeyDown}
    >
      {pill && (
        <span
          className="seg-pill"
          aria-hidden="true"
          style={{ left: pill.left, top: pill.top, width: pill.width, height: pill.height }}
        />
      )}
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              btns.current[it.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            tabIndex={!disabled && active ? 0 : -1}
            className={"seg-btn" + (active ? " is-active" : "")}
            onClick={() => {
              if (!disabled) onChange(it.value);
            }}
          >
            <span className="seg-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
