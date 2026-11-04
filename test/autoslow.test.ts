// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  primary: null as HTMLVideoElement | null,
  primaryReads: 0,
  liveReads: 0,
  streamReads: 0,
  reapply: vi.fn(),
  graphs: new WeakMap<HTMLVideoElement, unknown>(),
  ctx: { state: "running" } as { state: string } | null,
}));

vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => {
    m.primaryReads++;
    return m.primary;
  },
}));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: () => {
    m.liveReads++;
    return false;
  },
  onStreamPage: () => {
    m.streamReads++;
    return false;
  },
}));
vi.mock("../src/content/speed.js", () => ({ reapplyPrimaryRate: m.reapply }));
vi.mock("../src/content/audio/routing.js", () => ({
  audioContext: () => m.ctx,
  get audioGraphs() {
    return m.graphs;
  },
}));

function makeVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  Object.defineProperty(v, "paused", { value: false, configurable: true });
  return v;
}

function makeGraph(read: ReturnType<typeof vi.fn>) {
  return {
    analyserIn: {
      fftSize: 8,
      getFloatTimeDomainData(buf: Float32Array) {
        read();
        buf.fill(0.5);
      },
    },
  };
}

async function loadAutoSlow() {
  vi.resetModules();
  const [{ S }, mod] = await Promise.all([
    import("../src/content/state.js"),
    import("../src/content/audio/autoslow.js"),
  ]);
  S.autoSlowEnabled = true;
  S.holdActive = false;
  S.currentSpeed = 2;
  S.autoSlowFactor = 1;
  S.autoSlowTarget = 6;
  S.autoSlowFloor = 0.75;
  S.autoSlowKnee = 1.5;
  S.autoSlowHold = 0.5;
  S.autoSlowReaction = 50;
  S.autoSlowEaseBack = 50;
  return mod;
}

// A routed analyser whose time-domain frame is the constant `level()`, so each
// tick's RMS reading is exactly that level.
function levelGraph(level: () => number) {
  return {
    analyserIn: {
      fftSize: 8,
      getFloatTimeDomainData(buf: Float32Array) {
        buf.fill(level());
      },
    },
  };
}

// Synthetic speech envelope: one loudness swell per syllable. The syllable phase
// advances at `perSec` × the playback speed actually in effect (user speed × the
// auto-slow factor), so slowing the video slows what the meter hears — the same
// closed loop the controller runs in on real audio.
function speech(S: { currentSpeed: number; autoSlowFactor: number }, perSec: number) {
  let phase = 0;
  let last: number | null = null;
  return () => {
    const now = Date.now();
    if (last !== null) {
      phase += (2 * Math.PI * perSec * S.currentSpeed * S.autoSlowFactor * (now - last)) / 1000;
    }
    last = now;
    return 0.02 + 0.1 * (0.5 + 0.5 * Math.sin(phase));
  };
}

// loadAutoSlow plus the state and readout modules — imported after its module reset
// so they are the instances the fresh sampler uses — and `run`: drives the sampler
// at its real cadence over [from, to) and returns the next tick time. `each` sees
// every tick and whether it re-evaluated the factor (i.e. published a readout sample).
async function loadController() {
  const { autoSlowSample, releaseAutoSlow, AUTOSLOW_MS } = await loadAutoSlow();
  const [{ S }, { autoSlowLive: live, autoSlowHist: hist }] = await Promise.all([
    import("../src/content/state.js"),
    import("../src/content/audio/autoslow-state.js"),
  ]);
  const run = (from: number, to: number, each?: (t: number, evaluated: boolean) => void) => {
    let t = from;
    for (; t < to; t += AUTOSLOW_MS) {
      const before = hist[hist.length - 1];
      vi.setSystemTime(t);
      autoSlowSample();
      each?.(t, hist[hist.length - 1] !== before);
    }
    return t;
  };
  return { S, live, hist, run, autoSlowSample, releaseAutoSlow };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  m.primary = null;
  m.primaryReads = 0;
  m.liveReads = 0;
  m.streamReads = 0;
  m.reapply.mockClear();
  m.graphs = new WeakMap();
  m.ctx = { state: "running" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autoSlowSample", () => {
  it("reuses primary/live lookup across high-frequency samples", async () => {
    const read = vi.fn();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, makeGraph(read));
    const { autoSlowSample } = await loadAutoSlow();

    autoSlowSample();
    vi.setSystemTime(1_030);
    autoSlowSample();
    vi.setSystemTime(1_060);
    autoSlowSample();

    expect(m.primaryReads).toBe(1);
    expect(m.liveReads).toBe(1);
    expect(m.streamReads).toBe(1);
    expect(read).toHaveBeenCalledTimes(3);

    vi.setSystemTime(1_260);
    autoSlowSample();

    expect(m.primaryReads).toBe(2);
    expect(m.liveReads).toBe(2);
    expect(m.streamReads).toBe(2);
  });

  it("hands the rate back and reads nothing on a blacklisted site", async () => {
    const read = vi.fn();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, makeGraph(read));
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js"); // same instance loadAutoSlow just reset
    S.autoSlowFactor = 0.8;
    S.siteDisabled = true;

    autoSlowSample();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(m.primaryReads).toBe(0);
  });

  it("releases the slowdown when the tab is hidden", async () => {
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowFactor = 0.5;
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    autoSlowSample();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalled();
  });

  it("releases the slowdown when the audio context is suspended", async () => {
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowFactor = 0.5;
    m.ctx = { state: "suspended" };

    autoSlowSample();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalled();
  });

  it("reads no audio from a routed primary while the audio context is suspended", async () => {
    const read = vi.fn();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, makeGraph(read));
    m.ctx = { state: "suspended" };
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowFactor = 0.8;

    autoSlowSample();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });

  it("hands the rate back when no audio context exists yet", async () => {
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowFactor = 0.8;
    m.ctx = null;

    expect(() => autoSlowSample()).not.toThrow();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
  });

  it("hands the rate back without reading audio while the primary video is paused", async () => {
    const read = vi.fn();
    const v = makeVideo();
    Object.defineProperty(v, "paused", { value: true, configurable: true });
    m.primary = v;
    m.graphs.set(v, makeGraph(read));
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    const { autoSlowLive } = await import("../src/content/audio/autoslow-state.js");
    S.autoSlowFactor = 0.8;

    autoSlowSample();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(autoSlowLive.active).toBe(false);
  });

  it.each<[string, () => void]>([
    ["no primary video", () => {}],
    [
      "a primary video not routed through Web Audio",
      () => {
        m.primary = makeVideo();
      },
    ],
    [
      "a routed primary video without an input analyser",
      () => {
        const v = makeVideo();
        m.primary = v;
        m.graphs.set(v, { analyserIn: null });
      },
    ],
  ])("hands the rate back with %s", async (_label, setup) => {
    setup();
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowFactor = 0.8;

    expect(() => autoSlowSample()).not.toThrow();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
  });

  it("does not re-apply the rate while released if nothing is slowed", async () => {
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowEnabled = false;

    for (const t of [1_000, 1_030, 1_060]) {
      vi.setSystemTime(t);
      autoSlowSample();
    }

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).not.toHaveBeenCalled();
  });

  it("re-probes the primary video as soon as the 250 ms cache expires", async () => {
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, makeGraph(vi.fn()));
    const { autoSlowSample } = await loadAutoSlow();

    autoSlowSample();
    vi.setSystemTime(1_249);
    autoSlowSample();
    expect(m.primaryReads).toBe(1);

    vi.setSystemTime(1_250);
    autoSlowSample();
    expect(m.primaryReads).toBe(2);
  });

  // The meter still counts the nucleus heard exactly WINDOW_MS ago, so the speed it
  // was heard at must stay in the speed average too — otherwise the intrinsic rate is
  // overestimated right after a speed change and the controller slows needlessly.
  it("averages playback speed over the same window as the syllable count", async () => {
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, makeGraph(vi.fn())); // one nucleus on the first tick, then flat
    const { autoSlowSample } = await loadAutoSlow();
    const { S } = await import("../src/content/state.js");
    S.autoSlowTarget = 0.2;
    S.autoSlowKnee = 0;
    S.autoSlowFloor = 0.1;

    autoSlowSample(); // t=1000, heard at 2×
    S.currentSpeed = 1;
    vi.setSystemTime(4_900);
    autoSlowSample();
    vi.setSystemTime(5_000); // the 2× sample is now exactly one window old
    autoSlowSample();

    // 1 syllable / 4 s heard at an average 4/3× → intrinsic 0.1875 < 0.2: no slowdown.
    expect(S.autoSlowFactor).toBe(1);
  });
});

describe("autoSlowSamplingReady", () => {
  it("is ready only while the primary video feeds an analyser", async () => {
    const { autoSlowSamplingReady } = await loadAutoSlow();
    expect(autoSlowSamplingReady()).toBe(false); // no video on the page

    const v = makeVideo();
    m.primary = v;
    expect(autoSlowSamplingReady()).toBe(false); // not routed through Web Audio yet

    m.graphs.set(v, makeGraph(vi.fn()));
    expect(autoSlowSamplingReady()).toBe(true);
    expect(autoSlowSamplingReady(null)).toBe(false);
  });
});

describe("releaseAutoSlow", () => {
  it("hands a slowdown back to the user's speed and marks the readout inactive", async () => {
    const { S, live, run, releaseAutoSlow } = await loadController();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, levelGraph(speech(S, 5)));
    run(1_000, 3_000);
    expect(S.autoSlowFactor).toBeLessThan(1);
    expect(live.active).toBe(true);
    m.reapply.mockClear();

    releaseAutoSlow();

    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(1);
    expect(live.active).toBe(false);
  });
});

// The controller end to end against synthetic speech. loadAutoSlow's settings:
// user 2×, ceiling 6 syll/s, floor 0.75×, knee 1.5, hold 0.5 s, reaction and
// ease-back 50 — moves of at most 0.105 / 0.09 of the user's speed per re-evaluation.
describe("auto-slow controller (synthetic speech)", () => {
  it("slows dense speech one reaction step per re-evaluation, then settles at the comfortable speed", async () => {
    const { S, run } = await loadController();
    const v = makeVideo();
    m.primary = v;
    // 5 syll/s played at 2× sounds like 10; the comfortable speed is 6 / 5 = 1.2×.
    m.graphs.set(v, levelGraph(speech(S, 5)));
    const changes: { t: number; factor: number }[] = [];
    const settled: number[] = [];

    run(1_000, 9_000, (t) => {
      const prev = changes.length ? changes[changes.length - 1].factor : 1;
      if (S.autoSlowFactor !== prev) changes.push({ t, factor: S.autoSlowFactor });
      if (t >= 2_500) settled.push(S.currentSpeed * S.autoSlowFactor);
    });

    expect(changes[0].factor).toBeCloseTo(0.895, 6);
    expect(changes[1].factor).toBeCloseTo(0.79, 6);
    expect(changes[2].factor).toBeCloseTo(0.685, 6);
    expect(changes[1].t - changes[0].t).toBeGreaterThanOrEqual(100);
    expect(changes[2].t - changes[1].t).toBeGreaterThanOrEqual(100);
    // Dense speech only ever slows it, and every move re-applies the rate once.
    changes.slice(1).forEach((c, i) => expect(c.factor).toBeLessThan(changes[i].factor));
    expect(m.reapply).toHaveBeenCalledTimes(changes.length);
    // Steady near 1.2× — no slam toward the floor while the windowed rate catches up.
    expect(Math.min(...settled)).toBeGreaterThan(1.1);
    expect(Math.max(...settled)).toBeLessThan(1.3);
  });

  it("holds the slowdown for the hold time after the last dense reading, then eases back in steps", async () => {
    const { S, live, run } = await loadController();
    S.currentSpeed = 1;
    S.autoSlowHold = 0.6;
    const v = makeVideo();
    m.primary = v;
    // 10 syll/s stays over the 6 syll/s ceiling even at the 0.75× floor (7.5).
    const talk = speech(S, 10);
    let talking = true;
    m.graphs.set(
      v,
      levelGraph(() => (talking ? talk() : 0)),
    );
    const t = run(1_000, 6_000);
    expect(S.autoSlowFactor).toBeCloseTo(0.75, 6);

    talking = false;
    let lastDense = -Infinity;
    const rises: { t: number; from: number; to: number }[] = [];
    let prev = S.autoSlowFactor;
    run(t, 10_000, (now, evaluated) => {
      if (evaluated && live.rate >= S.autoSlowTarget) lastDense = now;
      if (S.autoSlowFactor > prev) rises.push({ t: now, from: prev, to: S.autoSlowFactor });
      prev = S.autoSlowFactor;
    });

    // The windowed rate decays as syllables age out. A reading exactly at the
    // ceiling still counts as dense; from the last one the speed stays put for
    // exactly the hold, then climbs at most one ease-back step (0.09 at 1×) at a time.
    expect(rises[0].t - lastDense).toBe(600);
    expect(rises[0].to).toBeCloseTo(0.84, 6);
    for (const r of rises) expect(r.to - r.from).toBeLessThanOrEqual(0.09 + 1e-9);
    expect(S.autoSlowFactor).toBe(1); // lands on the user's speed, not a hair below
  });

  it("eases an inherited slowdown back in gentle steps when nothing dense was heard", async () => {
    const { S, run } = await loadController();
    S.autoSlowFactor = 0.8; // e.g. carried over from the previous primary video
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(
      v,
      levelGraph(() => 0),
    );
    const factors: number[] = [];

    run(1_000, 1_400, (_t, evaluated) => {
      if (evaluated) factors.push(S.autoSlowFactor);
    });

    // No dense moment → no hold: 1.6× climbs by 0.18 (0.09 of 2×) per re-evaluation.
    expect(factors[0]).toBeCloseTo(0.89, 6);
    expect(factors[1]).toBeCloseTo(0.98, 6);
    expect(factors[2]).toBe(1);
    expect(m.reapply).toHaveBeenCalledTimes(3);
  });

  it("re-evaluates every 100 ms and publishes the live readout, leaving silence at full speed", async () => {
    const { S, live, hist, autoSlowSample } = await loadController();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(
      v,
      levelGraph(() => 0),
    );

    for (let t = 1_000; t <= 1_300; t += 25) {
      vi.setSystemTime(t);
      autoSlowSample();
    }

    // Re-evaluated at 1000, 1100, 1200 and 1300 — one readout sample each.
    expect(hist).toEqual(Array.from({ length: 4 }, () => ({ rate: 0, speed: 2 })));
    expect(live).toEqual({ active: true, rate: 0, target: 6, speed: 2 });
    expect(S.autoSlowFactor).toBe(1);
    expect(m.reapply).not.toHaveBeenCalled();
  });

  it("after being switched on, does not hold a mild soft-knee slowdown once speech eases", async () => {
    const { S, live, run } = await loadController();
    S.autoSlowKnee = 2; // the knee spans 4–8 syll/s around the 6 syll/s ceiling
    const v = makeVideo();
    m.primary = v;
    const talk = speech(S, 2.5); // 5 syll/s at 2×: inside the knee, under the ceiling
    let talking = false;
    m.graphs.set(
      v,
      levelGraph(() => (talking ? talk() : 0)),
    );
    S.autoSlowEnabled = false;
    let t = run(1_000, 1_030);
    S.autoSlowEnabled = true;
    t = run(t, 3_000);

    talking = true;
    let peak = 0;
    t = run(t, 8_000, (_now, evaluated) => {
      if (evaluated) peak = Math.max(peak, live.rate);
    });
    expect(peak).toBeLessThan(S.autoSlowTarget);
    expect(S.autoSlowFactor).toBeLessThan(0.98);

    talking = false;
    run(t, t + 1_000);
    expect(S.autoSlowFactor).toBe(1);
  });

  it("restarts the measurement after a release instead of reusing stale readings", async () => {
    const { S, live, run } = await loadController();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, levelGraph(speech(S, 5)));
    let t = run(1_000, 6_010);
    expect(S.autoSlowFactor).toBeLessThan(0.65);
    m.reapply.mockClear();

    S.autoSlowEnabled = false;
    t = run(t, t + 30);
    expect(S.autoSlowFactor).toBe(1);
    expect(live.active).toBe(false);
    expect(m.reapply).toHaveBeenCalledTimes(1);

    S.autoSlowEnabled = true;
    const rates: number[] = [];
    const settled: number[] = [];
    run(t, t + 5_000, (now, evaluated) => {
      if (evaluated) rates.push(live.rate);
      if (now >= t + 1_500) settled.push(S.currentSpeed * S.autoSlowFactor);
    });
    expect(rates[0]).toBe(0); // a fresh meter has nothing to report yet
    expect(Math.min(...settled)).toBeGreaterThan(1.1);
    expect(Math.max(...settled)).toBeLessThan(1.3);
  });

  it("starts a fresh measurement when the primary video changes", async () => {
    const { S, live, run } = await loadController();
    S.currentSpeed = 0.5;
    const first = makeVideo();
    m.primary = first;
    m.graphs.set(first, levelGraph(speech(S, 5)));
    const t = run(1_000, 7_210);
    expect(t).toBe(7_210); // the primary is re-probed every 270 ms here: 7210 is a probe tick

    const next = makeVideo();
    m.graphs.set(next, levelGraph(speech(S, 5)));
    m.primary = next;
    S.currentSpeed = 2;
    const probes = m.primaryReads;
    const rates: number[] = [];
    const settled: number[] = [];
    run(t, t + 5_000, (now, evaluated) => {
      if (now === t) expect(m.primaryReads).toBe(probes + 1);
      if (evaluated) rates.push(live.rate);
      if (now >= t + 1_500) settled.push(S.currentSpeed * S.autoSlowFactor);
    });
    expect(rates[0]).toBe(0);
    // Neither the old video's syllables nor its 0.5× speeds leak into the new estimate.
    expect(Math.min(...settled)).toBeGreaterThan(1.1);
    expect(Math.max(...settled)).toBeLessThan(1.3);
  });

  it("forgets playback speeds that have left the meter window", async () => {
    const { S, run } = await loadController();
    S.currentSpeed = 0.5; // under the 0.75× floor: nothing to slow
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, levelGraph(speech(S, 5)));
    const t = run(1_000, 7_000);

    S.currentSpeed = 2;
    const settled: number[] = [];
    run(t, t + 6_000, (now) => {
      if (now >= t + 1_500) settled.push(S.currentSpeed * S.autoSlowFactor);
    });

    // Only the last 4 s of speeds explain the last 4 s of syllables; remembering the
    // 0.5× stretch would overstate the speech rate and over-slow.
    expect(Math.min(...settled)).toBeGreaterThan(1.1);
    expect(Math.max(...settled)).toBeLessThan(1.3);
  });

  it("follows the user down when they drop below the slowed speed", async () => {
    const { S, run } = await loadController();
    const v = makeVideo();
    m.primary = v;
    m.graphs.set(v, levelGraph(speech(S, 5)));
    const t = run(1_000, 5_000);
    expect(S.currentSpeed * S.autoSlowFactor).toBeGreaterThan(1); // slowed to ≈1.2×

    S.currentSpeed = 1;
    const factors: number[] = [];
    run(t, t + 200, (_now, evaluated) => {
      if (evaluated) factors.push(S.autoSlowFactor);
    });

    // Capped at the new 1× right away rather than carrying the old factor over.
    expect(factors[0]).toBe(1);
  });
});
