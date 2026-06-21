// Shared icon-only button (the speed −/+/reset nudges, the header gear, etc.).
// Thin accessible wrapper: requires an aria-label, defaults type=button, and lets
// the caller pick the class (.spin in a card, .icon-btn in the header) so the
// existing CSS / liquid-glass look applies. Spreads the rest (id, onClick, title).
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  children: ReactNode;
}

export function IconButton({ className, children, ...rest }: Props) {
  return (
    <button type="button" className={className} {...rest}>
      {children}
    </button>
  );
}
