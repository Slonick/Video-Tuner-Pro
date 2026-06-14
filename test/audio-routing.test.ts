// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// routing.ts owns the AudioContext and gates which media elements are safe to
// capture (Web Audio silences cross-origin-without-CORS media). We stub a minimal
// Web Audio and reset the module between tests so its cached singleton context
// can't leak state across cases.

class FakeParam {
  value = 0;
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
let lastCtx: FakeAudioContext | null = null;
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  throwOnSource = false;
  constructor() { lastCtx = this; }
  addEventListener() {}
  resume() { return Promise.resolve(); }
  createMediaElementSource() { if (this.throwOnSource) throw new Error("already captured"); return { connect() {} }; }
  createDynamicsCompressor() {
    return { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(),
             attack: new FakeParam(), release: new FakeParam(), reduction: 0, connect() {} };
  }
  createGain() { return { gain: new FakeParam(), connect() {} }; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, connect() {}, getFloatTimeDomainData() {} }; }
}

type VidProps = Partial<{ srcObject: unknown; currentSrc: string; src: string; crossOrigin: string }>;
const vid = (p: VidProps = {}) => ({ addEventListener() {}, srcObject: null, currentSrc: "", src: "", crossOrigin: null, ...p } as unknown as HTMLVideoElement);

async function load() {
  vi.resetModules();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = undefined;
  return import("../src/content/audio/routing.js");
}

beforeEach(() => { lastCtx = null; document.body.innerHTML = ""; });
afterEach(() => { delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext; });

describe("setupGraph source gating (canRouteAudio)", () => {
  it("routes a MediaStream source (srcObject)", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ srcObject: {} }))).not.toBeNull();
  });

  it("routes a blob: / MSE source", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ src: "blob:https://x/abc" }))).not.toBeNull();
  });

  it("routes a same-origin source", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ src: location.origin + "/clip.mp4" }))).not.toBeNull();
  });

  it("skips a cross-origin source with no crossorigin attr (CORS would silence it)", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ src: "https://cdn.example.com/v.mp4" }))).toBeNull();
    expect(lastSkip()).toBe("cors");
  });

  it("routes a cross-origin source that opted in via crossorigin", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ src: "https://cdn.example.com/v.mp4", crossOrigin: "anonymous" }))).not.toBeNull();
  });

  it("skips a source-less video (src may still be loading)", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid())).toBeNull();
    expect(lastSkip()).toBe("cors");
  });

  it("yields (skips) while a VOT translation is actively playing", async () => {
    const host = document.createElement("vot-shadow-host");
    const sr = host.attachShadow({ mode: "open" });
    const b = document.createElement("button"); b.setAttribute("data-status", "success"); sr.appendChild(b);
    document.body.appendChild(host);
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ srcObject: {} }))).toBeNull(); // even a safe source is left alone
    expect(lastSkip()).toBe("cors");
  });
});

describe("setupGraph context & exclusivity", () => {
  it("returns the cached graph for an already-routed video", async () => {
    const { setupGraph } = await load();
    const v = vid({ srcObject: {} });
    const g1 = setupGraph(v);
    const g2 = setupGraph(v);
    expect(g2).toBe(g1);
  });

  it("skips with 'suspended' when the context isn't running yet", async () => {
    const { setupGraph, lastSkip } = await load();
    setupGraph(vid({ srcObject: {} }));   // creates the context
    lastCtx!.state = "suspended";
    expect(setupGraph(vid({ srcObject: {} }))).toBeNull();
    expect(lastSkip()).toBe("suspended");
  });

  it("bans a video whose element is already captured by another graph ('inuse')", async () => {
    const { setupGraph, lastSkip } = await load();
    setupGraph(vid({ srcObject: {} }));   // creates the context
    lastCtx!.throwOnSource = true;
    const v = vid({ srcObject: {} });
    expect(setupGraph(v)).toBeNull();
    expect(lastSkip()).toBe("inuse");
    // Re-trying the same banned element stays 'inuse' (never retried).
    lastCtx!.throwOnSource = false;
    expect(setupGraph(v)).toBeNull();
    expect(lastSkip()).toBe("inuse");
  });

  it("builds the full source→comp→gain→destination chain on success", async () => {
    const { setupGraph } = await load();
    const g = setupGraph(vid({ srcObject: {} }))!;
    expect(g.source).toBeDefined();
    expect(g.comp).toBeDefined();
    expect(g.gain).toBeDefined();
    expect(g.analyserIn).toBeDefined();
  });
});
