// Remappable keyboard shortcuts for the three playback-speed actions. Keys are
// stored as KeyboardEvent.code values (physical position, layout-independent),
// under storage key "keymap". Pure + unit-tested; shared by the content listener
// and the options-page editor.

export type Action =
  | "slower"
  | "faster"
  | "reset"
  | "toggle"
  | "hold"
  | "overlay"
  | "viewer"
  | "theater"
  | "chat";
export const ACTIONS: Action[] = [
  "slower",
  "faster",
  "reset",
  "toggle",
  "hold",
  "overlay",
  "viewer",
  "theater",
  "chat",
];

export interface Keymap {
  slower: string;
  faster: string;
  reset: string;
  // Toggle between the last non-1× speed and 1× (a quick "back to normal").
  toggle: string;
  // Hold for a temporary speed (S.holdSpeed) while pressed; release restores it.
  hold: string;
  // Open/close the on-video overlay popup — works even with the launcher button
  // hidden, for people who turned it off or prefer the keyboard.
  overlay: string;
  // Pop the video out above the page: viewer = the centred "normal" format,
  // theater = full-window. Each toggles its own format and switches from the
  // other, so the two keys jump straight between the views.
  viewer: string;
  theater: string;
  // Cycle the stream-chat mode in an open viewer (off → side → overlay).
  chat: string;
}

export const DEFAULT_KEYMAP: Keymap = {
  slower: "KeyA",
  faster: "KeyD",
  reset: "KeyR",
  toggle: "KeyS",
  // X, not F — many players use F for fullscreen.
  hold: "KeyX",
  overlay: "KeyO",
  viewer: "KeyV",
  theater: "KeyT",
  chat: "KeyC",
};

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

// Is this a Mac? The "primary" modifier is ⌘ (metaKey) on Mac, Ctrl (ctrlKey)
// elsewhere — so a chord set on one OS works on the other after sync.
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      "",
  );

// A key "chord": a bindable code plus optional Shift, the primary modifier (mod =
// ⌘/Ctrl), and Alt. Stored OS-agnostically as a "+"-joined string in a fixed
// order, e.g. "S+Digit1", "KeyG", "M+KeyM" (S=Shift, M=mod, A=Alt). The mod flag
// resolves to whichever primary key the running OS uses, so settings stay
// portable across Windows ⇄ macOS.
export interface KeyChord {
  code: string;
  shift: boolean;
  mod: boolean;
  alt: boolean;
}

// The primary / secondary modifier state of an event on THIS platform. Mac: mod =
// ⌘ (metaKey), secondary = Control. Elsewhere: mod = Ctrl, secondary = Meta (Win
// key) — which we never bind, so it blocks a stray match.
function primaryMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}
function secondaryMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.ctrlKey : e.metaKey;
}

export function formatChord(c: KeyChord): string {
  const out: string[] = [];
  if (c.shift) out.push("S");
  if (c.mod) out.push("M");
  if (c.alt) out.push("A");
  out.push(c.code);
  return out.join("+");
}

// Parse a stored spec back into a chord; null for anything malformed. A legacy
// "C" (Ctrl) prefix is read as the primary modifier.
export function parseChord(spec: unknown): KeyChord | null {
  if (typeof spec !== "string" || !spec) return null;
  const parts = spec.split("+");
  const code = parts.pop();
  if (!code || !isBindableCode(code)) return null;
  for (const p of parts) if (p !== "S" && p !== "M" && p !== "A" && p !== "C") return null;
  return {
    code,
    shift: parts.includes("S"),
    mod: parts.includes("M") || parts.includes("C"),
    alt: parts.includes("A"),
  };
}

// The chord a keyboard event represents, or null if its code isn't bindable or a
// non-bindable secondary modifier (Win key / Mac Control) is held.
export function eventChord(e: KeyboardEvent): KeyChord | null {
  if (!isBindableCode(e.code) || secondaryMod(e)) return null;
  return { code: e.code, shift: e.shiftKey, mod: primaryMod(e), alt: e.altKey };
}

export function eventMatchesChord(c: KeyChord | null, e: KeyboardEvent): boolean {
  return (
    !!c &&
    !secondaryMod(e) &&
    c.code === e.code &&
    c.shift === e.shiftKey &&
    c.mod === primaryMod(e) &&
    c.alt === e.altKey
  );
}

// Does a stored spec match this event on the running platform (code + Shift + the
// platform's primary modifier + Alt; the secondary modifier must be released)?
export function eventMatchesSpec(spec: string | null, e: KeyboardEvent): boolean {
  return eventMatchesChord(parseChord(spec), e);
}

export function actionConflictsWithChord(
  action: Action,
  actionCode: string,
  chord: KeyChord | null,
): boolean {
  if (!actionCode || !chord || chord.code !== actionCode) return false;
  return !chord.shift && !chord.mod && !chord.alt;
}

export function actionConflictsWithSpec(
  action: Action,
  actionCode: string,
  spec: string | null,
): boolean {
  return actionConflictsWithChord(action, actionCode, parseChord(spec));
}

// Human-readable chord label, rendered for the given platform. Shift is ⇧
// everywhere; the primary modifier is ⌘ on Mac / "Ctrl+" elsewhere, Alt is ⌥ on
// Mac / "Alt+" elsewhere. e.g. "S+Digit1" → "⇧1"; "M+KeyM" → "⌘M" (mac) / "Ctrl+M".
export function chordLabel(spec: string | null, mac: boolean = IS_MAC): string {
  const c = parseChord(spec);
  if (!c) return "";
  const mod = c.mod ? (mac ? "⌘" : "Ctrl+") : "";
  const alt = c.alt ? (mac ? "⌥" : "Alt+") : "";
  return mod + alt + (c.shift ? "⇧" : "") + codeLabel(c.code);
}

// Coerce stored/partial input into a full, valid keymap. An empty string is a
// deliberate "unbound" (the action is disabled); invalid or duplicate bindings
// fall back to the default when that default does not collide with a user binding.
export function normalizeKeymap(raw: unknown): Keymap {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Keymap = { ...DEFAULT_KEYMAP };
  const legacy = !!raw && typeof raw === "object";
  const used = new Set<string>();

  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    const code = src[a];
    const defaultOwner =
      typeof code === "string" && isBindableCode(code)
        ? ACTIONS.find((action) => DEFAULT_KEYMAP[action] === code)
        : null;
    const laterOwnerRaw = defaultOwner ? src[defaultOwner] : undefined;
    const laterOwnerNeedsOwnDefault =
      laterOwnerRaw !== "" &&
      (typeof laterOwnerRaw !== "string" ||
        !isBindableCode(laterOwnerRaw) ||
        laterOwnerRaw === code);
    const laterDefaultOwnerNeedsCode =
      !!defaultOwner &&
      ACTIONS.indexOf(defaultOwner) > i &&
      laterOwnerNeedsOwnDefault &&
      (laterOwnerRaw !== undefined || (a === "slower" && defaultOwner === "faster"));
    if (code === "") {
      out[a] = ""; // explicitly unbound — the action does nothing
    } else if (
      typeof code === "string" &&
      isBindableCode(code) &&
      !used.has(code) &&
      !laterDefaultOwnerNeedsCode
    ) {
      out[a] = code;
    } else if (legacy && (a === "viewer" || a === "theater" || a === "chat") && !(a in src)) {
      // Actions added after 1.x ship unbound for stored keymaps — a new default
      // must not hijack a key the user may already rely on (e.g. YouTube's C).
      out[a] = "";
    } else {
      const fallback = DEFAULT_KEYMAP[a];
      out[a] = fallback && !used.has(fallback) ? fallback : "";
    }
    if (out[a]) used.add(out[a]); // an unbound "" never reserves a code
  }
  return out;
}
