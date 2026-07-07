// Cross-cutting mutable settings, shared across modules. ES modules can't
// reassign an imported binding, so the values that several modules both read and
// write live on this single object (loadSpeed/onChanged set them, the speed/live/
// audio/badge modules read — and a couple write — them).
import { DEFAULT_PRESETS, DEFAULT_PRESET_KEYS } from "../shared/presets.js";
import { DEFAULT_KEYMAP, type Keymap } from "../shared/keymap.js";

export const S = {
  currentSpeed: 1.0,
  // The user's intended speed for NON-live playback (restored when a page turns
  // out not to be a live stream).
  userSpeed: 1.0,
  // In-tab manual speed override. It wins over scoped saved values until the user
  // explicitly resets to the saved speed or reloads the page.
  speedManual: false,
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
  // Remappable shortcut keys (e.code values) for speed, overlay and viewer actions.
  keymap: { ...DEFAULT_KEYMAP } as Keymap,
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
  // Stall-safe buffer cushion (s) catch-up won't drain below — global tuning knob,
  // capped at the allowed delay. Lower = more aggressive catch-up but more risk of
  // re-buffering; higher = safer but slower to reach the live edge. (1–10, default 3)
  liveSyncBufferReserve: 3,
  // On-video badge: speed + real remaining time (VODs)
  showRemaining: false,
  // On-video badge on live streams: speed + buffered-ahead seconds
  streamBadge: false,
  // Where the badge sits, as a fraction of the video frame — per site, set by
  // dragging it. null = the default top-left corner.
  badgePos: null as { fx: number; fy: number } | null,
  // Whether the badge is pinned (per site): pinned → always visible, no auto-hide.
  badgePinned: false,
  // On-video launcher button that opens the popup as an in-page overlay. When to
  // surface it: "off", "fullscreen" (only while a video is fullscreen), or
  // "always" (whenever the pointer is over a video). Default: fullscreen only.
  overlayButton: "fullscreen" as "off" | "fullscreen" | "always",
  // Auto-open the pop-out viewer when a video starts playing (once per video;
  // a manual close wins). "off" | "normal" | "theater".
  viewerAutoEnabled: true,
  viewerAuto: "off" as "off" | "normal" | "theater",
  viewerAutoScope: null as "channel" | "site" | "global" | null,
  // How the pop-out viewer fits video inside its frame.
  viewerFit: "contain" as "contain" | "cover" | "fill",
  viewerFitScope: null as "channel" | "site" | "global" | null,
  // In normal Viewer mode, mirror the video behind the glass backdrop.
  viewerBackdropVideo: false,
  // Opt-in: fetch SponsorBlock segments for the current YouTube video and show
  // them on the viewer's seek bar (a third-party API request — hence opt-in).
  sponsorMarks: false,
  // Where the launcher button sits, as a fraction of the video frame — per site,
  // set by dragging it. null = the default right-center spot.
  overlayBtnPos: null as { fx: number; fy: number } | null,
  // Where the opened overlay panel sits, as a fraction of the viewport (its centre)
  // — per site, set by dragging the panel's header. null = centred.
  overlayPanelPos: null as { fx: number; fy: number } | null,
  // Glass opacity multiplier for the on-video badge + launcher glass (mirrors the
  // popup's --glass-opacity token). Set in General; 0.3…1.4, default 1.
  glassOpacity: 1,
  // Auto-slow for dense speech: when the speaker tarators, temporarily lower the
  // effective playback speed so it stays intelligible. Enable is a global flag;
  // the target resolves by scope (channel > site > global), like speed.
  // `autoSlowFactor` is the live multiplier the sampler drives (1 = no slowdown);
  // `autoSlowFloor` is the lowest effective speed.
  autoSlowEnabled: false,
  autoSlowScope: null as "channel" | "site" | "global" | null,
  autoSlowFloor: 1.0, // min effective speed (fraction), 0.5…2
  autoSlowTarget: 6, // comfort ceiling (syllables/sec) — scoped; the graph's target line
  autoSlowKnee: 0.5, // soft-knee half-width (syll/s) around the target, global — 0…2
  autoSlowHold: 1.2, // s, global — how long it stays slowed after speech eases up
  autoSlowReaction: 50, // 0…100, global — how fast it slows down when speech is dense
  autoSlowEaseBack: 25, // 0…100, global — how fast it returns to the user's speed
  autoSlowFactor: 1.0, // live, set by the autoslow sampler — not persisted
  // Audio compression (raw DynamicsCompressor parameters)
  audioCompEnabled: false,
  audioCompThreshold: -60, // dB, -100…0
  audioCompKnee: 30, // dB, 0…40
  audioCompRatio: 10, // x:1, 1…20
  audioCompAttack: 0, // s, 0…1
  audioCompRelease: 1, // s, 0…1
  audioCompGain: 0, // make-up gain in dB, 0…24
};
