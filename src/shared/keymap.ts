// Remappable keyboard shortcuts for the three playback-speed actions. Keys are
// stored as KeyboardEvent.code values (physical position, layout-independent),
// under storage key "keymap". Pure + unit-tested; shared by the content listener
// and the options-page editor.

export type Action = "slower" | "faster" | "reset";
export const ACTIONS: Action[] = ["slower", "faster", "reset"];

export interface Keymap {
  slower: string;
  faster: string;
  reset: string;
}

export const DEFAULT_KEYMAP: Keymap = { slower: "KeyA", faster: "KeyD", reset: "KeyR" };

// A code is bindable if it's a plain letter/digit position — enough to avoid
// capturing modifier-only or navigation keys while keeping the UI simple.
export function isBindableCode(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9])$/.test(code);
}

// Human-readable label for a code (e.g. "KeyA" → "A", "Digit3" → "3").
export function codeLabel(code: string): string {
  const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
  return m ? m[1] : code;
}

// Coerce stored/partial input into a full, valid keymap. Invalid or duplicate
// bindings fall back to the default for that action (defaults never collide).
export function normalizeKeymap(raw: unknown): Keymap {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Keymap = { ...DEFAULT_KEYMAP };
  const used = new Set<string>();
  for (const a of ACTIONS) {
    const code = src[a];
    if (typeof code === "string" && isBindableCode(code) && !used.has(code)) {
      out[a] = code;
    }
    used.add(out[a]);
  }
  return out;
}
