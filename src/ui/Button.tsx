// Shared button primitive. With `variant` it's an action button (emits the
// .btn-action classes the liquid-glass CSS styles); without one it's a plain
// <button> carrying the caller's className (.sec-main, .btn-preset, .btn-speed,
// tour buttons, …). Either way it defaults type=button and spreads the rest
// (id, onClick, title, disabled, data-*, aria-*, style) so it's a drop-in.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "neutral";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children?: ReactNode;
}

export function Button({ variant, className, children, ...rest }: Props) {
  const cls = variant
    ? ["btn-action", variant === "primary" ? "btn-default" : "btn-reset", className]
        .filter(Boolean)
        .join(" ")
    : className;
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
