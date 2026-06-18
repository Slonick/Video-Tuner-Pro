// Cross-cutting mutable settings, shared across modules. ES modules can't
// reassign an imported binding, so the values that several modules both read and
// write live on this single object (loadSpeed/onChanged set them, the speed/live/
// audio/badge modules read — and a couple write — them).
import { DEFAULT_PRESETS, DEFAULT_PRESET_KEYS } from "../shared/presets.js";

export const S = {
  currentSpeed: 1.0,
  // The user's intended speed for NON-live playback (restored when a page turns
  // out not to be a live stream).
  userSpeed: 1.0,
  // Which saved scope the current resolved speed came from (channel/site/global),
  // or null when nothing is saved. The popup reads it to preselect the scope.
  speedScope: null as "channel" | "site" | "global" | null,
  // Which saved scope the current allowed-delay (liveSyncTarget) came from, for
  // the popup to preselect. Mirrors speedScope.
  targetScope: null as "channel" | "site" | "global" | null,
  liveSyncEnabled: false,
  // Opt-in: also control the playback rate of bare <audio> elements (podcasts,
  // SoundCloud, etc.), not just <video>.
  audioSpeedEnabled: false,
  // Opt-in "hard capture": swallow the page's own ratechange events so a site
  // can't observe or undo our speed, then re-assert it. Off by default — it hides
  // the rate from site players that legitimately reflect it in their UI.
  forceRate: false,
  // Keyboard shortcuts (S/D/R/Z) for playback speed
  keyboardEnabled: true,
  // Editable speed presets, as playback-rate fractions — mirrors the popup's
  // preset grid (single source: storage key "speedPresets"). Each preset's hotkey
  // chord lives at the same index in presetKeys (storage key "presetKeys"); the
  // two stay sorted together so a key follows its speed.
  presets: DEFAULT_PRESETS.map((p) => p / 100) as number[],
  presetKeys: [...DEFAULT_PRESET_KEYS] as (string | null)[],
  // Remappable shortcut keys (e.code values) for slower / faster / reset /
  // toggle (last speed ⇄ 1×) / hold (temporary speed while pressed).
  keymap: { slower: "KeyA", faster: "KeyD", reset: "KeyR", toggle: "KeyS", hold: "KeyF" } as {
    slower: string;
    faster: string;
    reset: string;
    toggle: string;
    hold: string;
  },
  // How much one slower/faster press changes the speed (fraction; Shift doubles).
  speedStep: 0.05,
  // The speed the hold key applies while pressed (fraction).
  holdSpeed: 2.0,
  // The last non-1× speed, remembered so `toggle` can restore it.
  toggleMemory: null as number | null,
  // Hold-key bookkeeping: whether it's down, and the speed to restore on release.
  holdActive: false,
  holdPrev: 1.0,
  liveSyncTarget: 5, // seconds of allowed lag behind the live edge (1–30)
  // On-video badge: speed + real remaining time (VODs)
  showRemaining: false,
  // On-video badge on live streams: speed + buffered-ahead seconds
  streamBadge: false,
  // Where the badge sits, as a fraction of the video frame — per site, set by
  // dragging it. null = the default top-left corner.
  badgePos: null as { fx: number; fy: number } | null,
  // Whether the badge is pinned (per site): pinned → always visible, no auto-hide.
  badgePinned: false,
  // Audio compression (raw DynamicsCompressor parameters)
  audioCompEnabled: false,
  audioCompThreshold: -60, // dB, -100…0
  audioCompKnee: 30, // dB, 0…40
  audioCompRatio: 10, // x:1, 1…20
  audioCompAttack: 0, // s, 0…1
  audioCompRelease: 1, // s, 0…1
  audioCompGain: 0, // make-up gain in dB, 0…24
};
