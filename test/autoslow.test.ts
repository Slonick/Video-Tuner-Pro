// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  primary: null as HTMLVideoElement | null,
  primaryReads: 0,
  liveReads: 0,
  streamReads: 0,
  reapply: vi.fn(),
  graphs: new WeakMap<HTMLVideoElement, unknown>(),
  ctx: { state: "running" },
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
  audioGraphs: m.graphs,
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
});
