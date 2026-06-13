// Cross-cutting mutable settings, shared across modules. ES modules can't
// reassign an imported binding, so the values that several modules both read and
// write live on this single object (loadSpeed/onChanged set them, the speed/live/
// audio/badge modules read — and a couple write — them).
export const S = {
  currentSpeed: 1.0,
  // The user's intended speed for NON-live playback (restored when a page turns
  // out not to be a live stream).
  userSpeed: 1.0,
  liveSyncEnabled: false,
  // Keyboard shortcuts (S/D/R/Z) for playback speed
  keyboardEnabled: true,
  liveSyncTarget: 5,        // seconds of allowed lag behind the live edge (1–30)
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
  audioCompThreshold: -60,  // dB, -100…0
  audioCompKnee: 30,        // dB, 0…40
  audioCompRatio: 10,       // x:1, 1…20
  audioCompAttack: 0,       // s, 0…1
  audioCompRelease: 1,      // s, 0…1
  audioCompGain: 10,        // make-up gain in dB, 0…24
};
