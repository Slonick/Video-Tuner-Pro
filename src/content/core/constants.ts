export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

export const MIN_FORWARD_BUFFER = 1.0;    // smallest buffer we'll ever drain down to
export const LIVE_MAX_FLOOR = 1.25;       // catch-up rate can never be set below 125%
export const CATCHUP_START = 2.0;         // begin catching up once this many seconds beyond the target
export const CATCHUP_STOP = 0.3;          // stop once back within this of the target
