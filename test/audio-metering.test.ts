// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// metering.ts derives the meter readout from a graph's input analyser plus the
// compressor's live gain reduction. Feed it a fake graph and assert the real
// rmsToDb/deriveOutDb math flows through. audioContext is mocked to null so the
// background history interval stays quiet during these unit tests.
const m = vi.hoisted(() => ({
  primary: null as unknown,
  graphs: new Map<unknown, unknown>(),
  translation: false,
  translationCalls: 0,
  ctx: null as { state: string } | null,
  skip: null as string | null,
}));

vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => m.primary }));
vi.mock("../src/content/audio/translation.js", () => ({
  translationActive: () => {
    m.translationCalls++;
    return m.translation;
  },
  compOn: () => S.audioCompEnabled && !m.translation,
}));
vi.mock("../src/content/audio/routing.js", () => ({
  audioContext: () => m.ctx,
  audioGraphs: m.graphs,
  graphForCurrentSource: (v: unknown) => m.graphs.get(v) ?? null,
  lastSkip: () => m.skip,
}));

import { S } from "../src/content/state.js";
import {
  audioLevels,
  recordAudioSample,
  audioLevelHist,
  A_HIST_MS,
} from "../src/content/audio/metering.js";

// rms 0.5 over the buffer → ~-6.02 dB (matches levels.test.ts).
function makeGraph(reduction: number, limiterReduction = 0) {
  return {
    comp: { reduction },
    limiter: { reduction: limiterReduction },
    analyserIn: {
      fftSize: 8,
      getFloatTimeDomainData(buf: Float32Array) {
        buf.fill(0.5);
      },
    },
  };
}

beforeEach(() => {
  m.graphs.clear();
  m.primary = null;
  m.translation = false;
  m.translationCalls = 0;
  m.ctx = null;
  m.skip = null;
  audioLevelHist.length = 0;
  S.audioCompEnabled = true;
  S.audioCompThreshold = -30;
  S.audioCompGain = 0;
});

describe("audioLevels", () => {
  it("inactive when there is no primary video", () => {
    expect(audioLevels()).toEqual({ active: false, enabled: true, translation: false });
  });

  it("inactive when the primary video has no graph yet", () => {
    m.primary = {} as HTMLVideoElement;
    expect(audioLevels()).toEqual({ active: false, enabled: true, translation: false });
  });

  it("reflects the disabled flag while still inactive", () => {
    S.audioCompEnabled = false;
    expect(audioLevels()).toMatchObject({ enabled: false, translation: false });
    expect(m.translationCalls).toBe(0);
  });

  it("flags a capture failure (inuse / cors / noctx / suspended) as blocked", () => {
    for (const r of ["inuse", "cors", "noctx", "suspended"]) {
      m.skip = r;
      expect(audioLevels().blocked).toBe(r);
    }
    // transient reasons resolve on their own → not surfaced as a hard block
    for (const r of ["loading", "vot", null]) {
      m.skip = r;
      expect(audioLevels().blocked).toBeUndefined();
    }
  });

  it("reports in/out levels when a graph exists (out = in + reduction)", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3));
    const r = audioLevels();
    expect(r.active).toBe(true);
    expect(r.in).toBeCloseTo(-6.02, 1);
    expect(r.out).toBeCloseTo(-9.02, 1); // input + 3 dB reduction, no make-up
    expect(r.threshold).toBe(-30);
  });

  it("transparent graph (no reduction) → out == in", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    const r = audioLevels();
    expect(r.out).toBeCloseTo(r.in!, 6);
  });

  it("includes make-up gain in the reported output level", () => {
    S.audioCompGain = 12;
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3));
    const r = audioLevels();
    expect(r.out).toBeCloseTo(2.98, 1);
  });

  it("includes limiter reduction in the reported output level", () => {
    S.audioCompGain = 24;
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3, -8));
    const r = audioLevels();
    expect(r.out).toBeCloseTo(6.98, 1);
  });

  it("flags an active translation (compression yields to VOT)", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    m.translation = true;
    expect(audioLevels().translation).toBe(true);
  });

  it("does not add make-up gain while translation pauses compression", () => {
    S.audioCompGain = 24;
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    m.translation = true;
    const r = audioLevels();
    expect(r.out).toBeCloseTo(r.in!, 6);
  });

  it("stays live even with compression disabled (transparent graph keeps metering)", () => {
    S.audioCompEnabled = false;
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    const r = audioLevels();
    expect(r.active).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.translation).toBe(false);
    expect(m.translationCalls).toBe(0);
  });

  it("history step is 150 ms", () => {
    expect(A_HIST_MS).toBe(150);
  });
});

describe("recordAudioSample", () => {
  it("does nothing without a running context", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3));
    m.ctx = { state: "suspended" };
    recordAudioSample();
    expect(audioLevelHist.length).toBe(0);
  });

  it("does nothing when there's no graph", () => {
    m.primary = {} as HTMLVideoElement;
    m.ctx = { state: "running" };
    recordAudioSample();
    expect(audioLevelHist.length).toBe(0);
  });

  it("appends an in/out sample when a graph runs", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3));
    m.ctx = { state: "running" };
    recordAudioSample();
    expect(audioLevelHist.length).toBe(1);
    expect(audioLevelHist[0].in).toBeCloseTo(-6.02, 1);
    expect(audioLevelHist[0].out).toBeCloseTo(-9.02, 1);
  });

  it("caps the history at 48 samples (drops the oldest)", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    m.ctx = { state: "running" };
    for (let i = 0; i < 60; i++) recordAudioSample();
    expect(audioLevelHist.length).toBe(48);
  });
});
