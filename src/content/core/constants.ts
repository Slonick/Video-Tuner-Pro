export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

export const MIN_FORWARD_BUFFER = 1.0;    // smallest buffer we'll ever drain down to
export const MAX_BUFFER_RESERVE = 3.0;    // cap on the latency-based buffer reserve — past this, catch-up may spend the buffer
export const CATCHUP_MAX = 1.25;          // catch-up ceiling — the time-stretcher stays tolerable up to ~125%
export const CATCHUP_STEP_LAG = 7;        // each full 7s of lag beyond the target adds another +5% step
export const CATCHUP_START = 2.0;         // "clearly behind" threshold (drives the low-buffer warning)
