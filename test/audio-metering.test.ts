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
}));

vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => m.primary }));
vi.mock("../src/content/audio/translation.js", () => ({ translationActive: () => m.translation }));
vi.mock("../src/content/audio/routing.js", () => ({
  audioContext: () => null,
  audioGraphs: m.graphs,
}));

import { S } from "../src/content/state.js";
import { audioLevels, A_HIST_MS } from "../src/content/audio/metering.js";

// rms 0.5 over the buffer → ~-6.02 dB (matches levels.test.ts).
function makeGraph(reduction: number) {
  return {
    comp: { reduction },
    analyserIn: {
      fftSize: 8,
      getFloatTimeDomainData(buf: Float32Array) { buf.fill(0.5); },
    },
  };
}

describe("audioLevels", () => {
  beforeEach(() => {
    m.graphs.clear();
    m.primary = null;
    m.translation = false;
    S.audioCompEnabled = true;
    S.audioCompThreshold = -30;
  });

  it("inactive when there is no primary video", () => {
    expect(audioLevels()).toEqual({ active: false, enabled: true, translation: false });
  });

  it("inactive when the primary video has no graph yet", () => {
    m.primary = {} as HTMLVideoElement;
    expect(audioLevels()).toEqual({ active: false, enabled: true, translation: false });
  });

  it("reflects the disabled flag while still inactive", () => {
    S.audioCompEnabled = false;
    expect(audioLevels().enabled).toBe(false);
  });

  it("reports in/out levels when a graph exists (out = in + reduction)", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(-3));
    const r = audioLevels();
    expect(r.active).toBe(true);
    expect(r.in).toBeCloseTo(-6.02, 1);
    expect(r.out).toBeCloseTo(-9.02, 1);     // input + 3 dB reduction, no make-up
    expect(r.threshold).toBe(-30);
  });

  it("transparent graph (no reduction) → out == in", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    const r = audioLevels();
    expect(r.out).toBeCloseTo(r.in!, 6);
  });

  it("flags an active translation (compression yields to VOT)", () => {
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    m.translation = true;
    expect(audioLevels().translation).toBe(true);
  });

  it("stays live even with compression disabled (transparent graph keeps metering)", () => {
    S.audioCompEnabled = false;
    const v = {} as HTMLVideoElement;
    m.primary = v;
    m.graphs.set(v, makeGraph(0));
    const r = audioLevels();
    expect(r.active).toBe(true);
    expect(r.enabled).toBe(false);
  });

  it("history step is 150 ms", () => {
    expect(A_HIST_MS).toBe(150);
  });
});
