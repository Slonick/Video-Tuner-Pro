// Cross-cutting mutable settings, shared across modules. ES modules can't
// reassign an imported binding, so the values that several modules both read and
// write live on this single object (loadSpeed/onChanged set them, the speed/live/
// audio/badge modules read — and a couple write — them).
export const S = {
  // Speed
  currentSpeed: 1.0,
  // The user's intended speed for NON-live playback (restored when a page turns
  // out not to be a live stream).
  userSpeed: 1.0,
  // Live-sync
  liveSyncEnabled: false,
  liveSyncTarget: 5,        // seconds of allowed lag behind the live edge (0–15)
  liveSyncMax: 1.5,         // max catch-up rate (multiplier), never below 1.25
  // On-video badge: speed + real remaining time
  showRemaining: false,
  // Audio compression (raw DynamicsCompressor parameters)
  audioCompEnabled: false,
  audioCompThreshold: -60,  // dB, -100…0
  audioCompKnee: 30,        // dB, 0…40
  audioCompRatio: 10,       // x:1, 1…20
  audioCompAttack: 0,       // s, 0…1
  audioCompRelease: 1,      // s, 0…1
  audioCompGain: 10,        // make-up gain in dB, 0…24
};
