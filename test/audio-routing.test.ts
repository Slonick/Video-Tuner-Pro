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
let createSourceCalls = 0;
const connections: Array<[string, string]> = [];
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  throwOnSource = false;
  constructor() {
    lastCtx = this;
  }
  addEventListener() {}
  resume() {
    return Promise.resolve();
  }
  createMediaElementSource() {
    createSourceCalls++;
    if (this.throwOnSource) throw new Error("already captured");
    return {
      connect: (node: { _kind?: string }) => connections.push(["source", node._kind || "?"]),
    };
  }
  createDynamicsCompressor() {
    return {
      _kind: "comp",
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
      reduction: 0,
      connect(node: { _kind?: string }) {
        connections.push(["comp", node._kind || "?"]);
      },
    };
  }
  createGain() {
    return {
      _kind: "gain",
      gain: new FakeParam(),
      connect(node: { _kind?: string }) {
        connections.push(["gain", node._kind || "?"]);
      },
    };
  }
  createAnalyser() {
    return {
      _kind: "analyser",
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect() {},
      getFloatTimeDomainData() {},
    };
  }
}

type VidProps = Partial<{
  srcObject: unknown;
  currentSrc: string;
  src: string;
  crossOrigin: string;
  readyState: number;
}>;
const vid = (p: VidProps = {}) =>
  ({
    addEventListener() {},
    srcObject: null,
    currentSrc: "",
    src: "",
    crossOrigin: null,
    ...p,
  }) as unknown as HTMLVideoElement;

async function load() {
  vi.resetModules();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = undefined;
  return import("../src/content/audio/routing.js");
}

beforeEach(() => {
  lastCtx = null;
  createSourceCalls = 0;
  connections.length = 0;
  document.body.innerHTML = "";
});
afterEach(() => {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  vi.unstubAllGlobals();
});

describe("setupGraph source gating (canRouteAudio)", () => {
  it("routes a MediaStream source (srcObject)", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ srcObject: {} }))).not.toBeNull();
  });

  it("routes a blob: / MSE source", async () => {
    const { setupGraph } = await load();
    expect(setupGraph(vid({ src: "blob:https://x/abc" }))).not.toBeNull();
  });

  it.each(["www.youtube.com", "boosty.to", "live.vkvideo.ru", "www.twitch.tv", "kick.com"])(
    "never disables a safe MSE audio source just because the site is %s",
    async (hostname) => {
      vi.stubGlobal("location", { hostname, origin: `https://${hostname}` });
      const { setupGraph, lastSkip } = await load();
      const video = vid({
        currentSrc: `blob:https://${hostname}/media-source`,
        readyState: 4,
      });

      expect(setupGraph(video)).not.toBeNull();
      expect(lastSkip(video)).toBeNull();
      expect(createSourceCalls).toBe(1);
    },
  );

  it("skips ordinary network URLs without explicit CORS opt-in", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ currentSrc: location.origin + "/clip.mp4" }))).toBeNull();
    expect(lastSkip()).toBe("cors");
  });

  it("waits for currentSrc before routing a normal URL", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ src: location.origin + "/redirecting-video" }))).toBeNull();
    expect(lastSkip()).toBe("loading");
  });

  it("waits for metadata before routing a normal URL that may still redirect", async () => {
    const { setupGraph, lastSkip } = await load();
    const v = vid({
      src: location.origin + "/redirecting-video",
      currentSrc: location.origin + "/redirecting-video",
      readyState: 0,
    });

    expect(setupGraph(v)).toBeNull();
    expect(lastSkip(v)).toBe("loading");
    expect(createSourceCalls).toBe(0);

    Object.defineProperty(v, "readyState", { configurable: true, value: 1 });
    Object.defineProperty(v, "currentSrc", {
      configurable: true,
      value: location.origin + "/ok.mp4",
    });

    expect(setupGraph(v)).toBeNull();
    expect(lastSkip(v)).toBe("cors");
    expect(createSourceCalls).toBe(0);
    expect(lastCtx).toBeNull();
  });

  it("skips when the resolved currentSrc redirects cross-origin without crossorigin", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(
      setupGraph(
        vid({
          src: location.origin + "/redirecting-video",
          currentSrc: "https://cdn.example.com/v.mp4",
        }),
      ),
    ).toBeNull();
    expect(lastSkip()).toBe("cors");
  });

  it("skips a cross-origin source with no crossorigin attr (CORS would silence it)", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ currentSrc: "https://cdn.example.com/v.mp4" }))).toBeNull();
    expect(lastSkip()).toBe("cors");
  });

  it("routes a cross-origin source that opted in via crossorigin", async () => {
    const { setupGraph } = await load();
    expect(
      setupGraph(vid({ currentSrc: "https://cdn.example.com/v.mp4", crossOrigin: "anonymous" })),
    ).not.toBeNull();
  });

  it("skips a source-less video (src may still be loading)", async () => {
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid())).toBeNull();
    expect(lastSkip()).toBe("loading"); // transient — not a hard "cors" block
  });

  it("keeps skip reasons tied to the video that failed", async () => {
    const { setupGraph, lastSkip } = await load();
    const cors = vid({ currentSrc: "https://cdn.example.com/v.mp4" });
    const loading = vid();

    expect(setupGraph(cors)).toBeNull();
    expect(setupGraph(loading)).toBeNull();

    expect(lastSkip(cors)).toBe("cors");
    expect(lastSkip(loading)).toBe("loading");
    expect(lastSkip()).toBe("loading");
  });

  it("yields (skips) while a VOT translation is actively playing", async () => {
    const host = document.createElement("vot-shadow-host");
    const sr = host.attachShadow({ mode: "open" });
    const b = document.createElement("button");
    b.setAttribute("data-status", "success");
    sr.appendChild(b);
    document.body.appendChild(host);
    const { setupGraph, lastSkip } = await load();
    expect(setupGraph(vid({ srcObject: {} }))).toBeNull(); // even a safe source is left alone
    expect(lastSkip()).toBe("vot"); // VOT is handled by its own lock, not the cors block
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
    setupGraph(vid({ srcObject: {} })); // creates the context
    lastCtx!.state = "suspended";
    expect(setupGraph(vid({ srcObject: {} }))).toBeNull();
    expect(lastSkip()).toBe("suspended");
  });

  it("bans a video whose element is already captured by another graph ('inuse')", async () => {
    const { setupGraph, lastSkip } = await load();
    setupGraph(vid({ srcObject: {} })); // creates the context
    lastCtx!.throwOnSource = true;
    const v = vid({ srcObject: {} });
    expect(setupGraph(v)).toBeNull();
    expect(lastSkip()).toBe("inuse");
    // Re-trying the same banned element stays 'inuse' (never retried).
    lastCtx!.throwOnSource = false;
    expect(setupGraph(v)).toBeNull();
    expect(lastSkip()).toBe("inuse");
  });

  it("builds the full source→comp→gain→limiter→destination chain on success", async () => {
    const { setupGraph } = await load();
    const g = setupGraph(vid({ srcObject: {} }))!;
    expect(g.source).toBeDefined();
    expect(g.comp).toBeDefined();
    expect(g.gain).toBeDefined();
    expect(g.limiter).toBeDefined();
    expect(g.analyserIn).toBeDefined();
    expect(connections).toContainEqual(["source", "comp"]);
    expect(connections).toContainEqual(["comp", "gain"]);
    expect(connections).toContainEqual(["gain", "comp"]);
  });

  it("treats an existing graph as inactive after the element switches to an unsafe URL", async () => {
    const { setupGraph, graphForCurrentSource, lastSkip } = await load();
    const v = vid({ currentSrc: "blob:https://example.test/safe" });
    const g = setupGraph(v);

    Object.defineProperty(v, "currentSrc", {
      configurable: true,
      value: location.origin + "/next.mp4",
    });

    expect(graphForCurrentSource(v)).toBeNull();
    expect(lastSkip(v)).toBe("cors");

    Object.defineProperty(v, "currentSrc", {
      configurable: true,
      value: "blob:https://example.test/safe",
    });

    expect(graphForCurrentSource(v)).toBe(g);
  });
});
