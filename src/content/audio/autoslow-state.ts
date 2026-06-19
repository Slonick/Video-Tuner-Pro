// Live readout for the popup's speech graph — perceived rate, the trigger target,
// and the resulting effective speed. Kept in its own tiny module (pace.js is pure)
// so the monitor can read it without pulling in the sampler's DOM dependencies.
import { PACE } from "./pace.js";

export const autoSlowLive = { active: false, rate: 0, target: PACE.TARGET_RATE, speed: 1 };
