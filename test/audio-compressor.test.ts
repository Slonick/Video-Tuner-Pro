// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate compressor.ts from the Web Audio routing layer: feed it fake graphs and
// assert it ramps the right param targets and skips redundant writes.
const m = vi.hoisted(() => {
  const makeParam = () => ({ value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  return {
    compOn: true,
    primary: null as unknown,
    list: [] as unknown[],
    graphs: new Map<unknown, unknown>(),
    setupGraph: vi.fn(),
    lastSkipVal: null as string | null,
    stream: false,
    makeParam,
  };
});

vi.mock("../src/content/audio/translation.js", () => ({ compOn: () => m.compOn }));
vi.mock("../src/content/live/detection.js", () => ({
  onStreamPage: () => m.stream,
  isLive: () => false,
}));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => m.list,
  primaryVideo: () => m.primary,
}));
vi.mock("../src/content/audio/routing.js", () => ({
  audioContext: () => ({ currentTime: 0 }),
  audioGraphs: m.graphs,
  setupGraph: m.setupGraph,
  hookAudioGesture: vi.fn(),
  resumeAudioCtx: vi.fn(),
  lastSkip: () => m.lastSkipVal,
}));

import { S } from "../src/content/state.js";
import { applyAudioComp } from "../src/content/audio/compressor.js";

function makeGraph() {
  return {
    comp: {
      threshold: m.makeParam(),
      knee: m.makeParam(),
      ratio: m.makeParam(),
      attack: m.makeParam(),
      release: m.makeParam(),
    },
    gain: { gain: m.makeParam() },
    _key: undefined as string | undefined,
  };
}
// The target value handed to rampParam → setTargetAtTime(value, t, 0.02).
const target = (p: { setTargetAtTime: ReturnType<typeof vi.fn> }) =>
  p.setTargetAtTime.mock.calls.at(-1)?.[0];

describe("applyAudioComp param mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.graphs.clear();
    m.compOn = true;
    m.lastSkipVal = null;
    S.audioCompEnabled = true;
    S.audioCompThreshold = -40;
    S.audioCompKnee = 25;
    S.audioCompRatio = 6;
    S.audioCompAttack = 0.01;
    S.audioCompRelease = 0.5;
    S.audioCompGain = 12;
  });

  it("maps S values onto the compressor params when compression is on", () => {
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;

    const res = applyAudioComp();
    expect(res.engaged).toBe(1);
    expect(target(g.comp.threshold)).toBe(-40);
    expect(target(g.comp.knee)).toBe(25);
    expect(target(g.comp.ratio)).toBe(6);
    expect(target(g.comp.attack)).toBe(0.01);
    expect(target(g.comp.release)).toBe(0.5);
  });

  it("converts make-up gain dB → linear (10^(dB/20))", () => {
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;
    applyAudioComp();
    expect(target(g.gain.gain)).toBeCloseTo(Math.pow(10, 12 / 20), 6); // ~3.98
  });

  it("0 dB make-up gain is unity (linear 1)", () => {
    S.audioCompGain = 0;
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;
    applyAudioComp();
    expect(target(g.gain.gain)).toBeCloseTo(1, 6);
  });

  it("OFF → transparent graph: ratio 1, unity gain, default knee/threshold/attack/release", () => {
    m.compOn = false;
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;
    applyAudioComp();
    expect(target(g.comp.ratio)).toBe(1);
    expect(target(g.comp.threshold)).toBe(0);
    expect(target(g.comp.knee)).toBe(0);
    expect(target(g.comp.attack)).toBe(0.003);
    expect(target(g.comp.release)).toBe(0.25);
    expect(target(g.gain.gain)).toBe(1);
  });

  it("skips re-poking params when nothing changed (same _key)", () => {
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;
    applyAudioComp();
    const before = g.gain.gain.setTargetAtTime.mock.calls.length;
    applyAudioComp(); // identical settings
    expect(g.gain.gain.setTargetAtTime.mock.calls.length).toBe(before);
  });

  it("re-applies after a setting changes (key differs)", () => {
    const v = {} as HTMLVideoElement;
    const g = makeGraph();
    m.graphs.set(v, g);
    m.list = [v];
    m.primary = v;
    applyAudioComp();
    const before = g.gain.gain.setTargetAtTime.mock.calls.length;
    S.audioCompGain = 6;
    applyAudioComp();
    expect(g.gain.gain.setTargetAtTime.mock.calls.length).toBeGreaterThan(before);
    expect(target(g.gain.gain)).toBeCloseTo(Math.pow(10, 6 / 20), 6);
  });
});

describe("applyAudioComp routing decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.graphs.clear();
    m.compOn = true;
    m.lastSkipVal = null;
    m.setupGraph.mockReset();
    m.stream = false;
    S.autoSlowEnabled = false;
  });

  it("OFF (both audio features off): captures nothing — leaves the page's audio alone", () => {
    S.audioCompEnabled = false;
    S.autoSlowEnabled = false;
    const primary = { id: "p" } as unknown as HTMLVideoElement;
    const other = { id: "o" } as unknown as HTMLVideoElement;
    m.primary = primary;
    m.list = [other, primary];
    m.setupGraph.mockImplementation(() => makeGraph());

    const res = applyAudioComp();
    expect(res.engaged).toBe(0); // nothing engaged — no createMediaElementSource
    expect(m.setupGraph).not.toHaveBeenCalled();
  });

  it("auto-slow ON (compression off): routes only the PRIMARY for its analyser", () => {
    S.audioCompEnabled = false;
    S.autoSlowEnabled = true;
    const primary = { id: "p" } as unknown as HTMLVideoElement;
    const other = { id: "o" } as unknown as HTMLVideoElement;
    m.primary = primary;
    m.list = [other, primary];
    m.setupGraph.mockImplementation((v: unknown) => (v === primary ? makeGraph() : null));

    const res = applyAudioComp();
    expect(res.engaged).toBe(1); // only primary engaged
    expect(m.setupGraph).toHaveBeenCalledTimes(1);
    expect(m.setupGraph).toHaveBeenCalledWith(primary);
  });

  it("auto-slow ON but on a live stream: captures nothing (it yields to live-sync)", () => {
    S.audioCompEnabled = false;
    S.autoSlowEnabled = true;
    m.stream = true;
    const primary = { id: "p" } as unknown as HTMLVideoElement;
    m.primary = primary;
    m.list = [primary];
    m.setupGraph.mockImplementation(() => makeGraph());

    const res = applyAudioComp();
    expect(res.engaged).toBe(0);
    expect(m.setupGraph).not.toHaveBeenCalled();
  });

  it("ON: routes every video", () => {
    S.audioCompEnabled = true;
    const a = {} as HTMLVideoElement,
      b = {} as HTMLVideoElement;
    m.primary = a;
    m.list = [a, b];
    m.setupGraph.mockImplementation(() => makeGraph());
    const res = applyAudioComp();
    expect(res.engaged).toBe(2);
  });

  it("counts skips and surfaces 'inuse' as the reason", () => {
    S.audioCompEnabled = true;
    const a = {} as HTMLVideoElement;
    m.primary = a;
    m.list = [a];
    m.setupGraph.mockReturnValue(null);
    m.lastSkipVal = "inuse";
    const res = applyAudioComp();
    expect(res.engaged).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.reason).toBe("inuse");
  });

  it("'inuse' wins over an earlier 'cors' reason across videos", () => {
    S.audioCompEnabled = true;
    const a = {} as HTMLVideoElement,
      b = {} as HTMLVideoElement;
    m.primary = a;
    m.list = [a, b];
    m.setupGraph.mockReturnValue(null);
    // first video reports cors, second reports inuse
    const skips = ["cors", "inuse"];
    let i = 0;
    vi.mocked(m.setupGraph).mockImplementation(() => {
      m.lastSkipVal = skips[i++];
      return null;
    });
    const res = applyAudioComp();
    expect(res.reason).toBe("inuse");
  });
});
