export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

export const MIN_FORWARD_BUFFER = 1.0; // smallest buffer we'll ever drain down to
// The latency-based buffer reserve (the stall-safe cushion catch-up won't drain
// below) is user-configurable — see S.liveSyncBufferReserve. Default 3, range 1–10.
export const CATCHUP_MAX = 1.25; // catch-up ceiling — the time-stretcher stays tolerable up to ~125%
export const CATCHUP_STEP_LAG = 7; // each full 7s of lag beyond the target adds another +5% step
export const CATCHUP_START = 2.0; // "clearly behind" threshold (drives the low-buffer warning)
