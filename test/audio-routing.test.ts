// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// routing.ts owns the AudioContext and gates which media elements are safe to
// capture (Web Audio silences cross-origin-without-CORS media). We stub a minimal
// Web Audio and reset the module between tests so its cached singleton context
// can't leak state across cases.

// A context that starts running re-runs compression; spy on that entry point
// rather than pull in the compressor and its video-scanning dependencies.
const compressor = vi.hoisted(() => ({ applyAudioComp: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({
  applyAudioComp: compressor.applyAudioComp,
}));

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
  destination = { _kind: "destination" };
  throwOnSource = false;
  resumeCalls = 0;
  listeners = new Map<string, Array<() => void>>();
  constructor() {
    lastCtx = this;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  resume() {
    this.resumeCalls++;
    return Promise.resolve();
  }
  createMediaElementSource() {
    createSourceCalls++;
    if (this.throwOnSource) throw new Error("already captured");
    return {
      context: this,
      connect: (node: { _kind?: string }) => connections.push(["source", node._kind || "?"]),
      disconnect: () => connections.push(["source", "disconnect"]),
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
  compressor.applyAudioComp.mockClear();
});
afterEach(() => {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it.each([
    ["currentSrc", { currentSrc: "data:video/mp4;base64,AAAA" }],
    ["src", { src: "data:video/mp4;base64,AAAA" }],
  ])("routes a data: URL source (%s)", async (_, props) => {
    const { setupGraph } = await load();
    expect(setupGraph(vid(props))).not.toBeNull();
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

  it("waits for metadata even when a cross-origin source opted in via crossorigin", async () => {
    const { setupGraph, lastSkip } = await load();
    const v = vid({
      currentSrc: "https://cdn.example.com/v.mp4",
      crossOrigin: "anonymous",
      readyState: 0,
    });

    expect(setupGraph(v)).toBeNull();
    expect(lastSkip(v)).toBe("loading");
    expect(createSourceCalls).toBe(0);

    Object.defineProperty(v, "readyState", { configurable: true, value: 1 });

    expect(setupGraph(v)).not.toBeNull();
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

  it("logs the 'not routable yet' diagnostic once per source, not on every retry", async () => {
    const { setupGraph } = await load();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const v = vid({ src: "https://cdn.example.com/a.mp4" }); // currentSrc not resolved yet

    setupGraph(v);
    setupGraph(v); // the monitor retries every tick
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith("[Video Tuner]", "audio: not routable yet —", {
      currentSrc: "https://cdn.example.com/a.mp4",
      hasSrcObject: false,
    });

    v.src = "https://cdn.example.com/b.mp4"; // the player swapped the source
    setupGraph(v);
    expect(info).toHaveBeenCalledTimes(2);
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
    expect(lastCtx!.resumeCalls).toBe(1); // and asks it to resume
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
    expect(connections).toContainEqual(["comp", "destination"]); // limiter → speakers
    expect(connections).toContainEqual(["source", "analyser"]); // input meter tap
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
    expect(lastSkip(v)).toBeNull(); // safe again: no stale 'cors' left for the popup
  });

  it("keeps a deferred video's 'suspended' reason until its graph is built", async () => {
    const { setupGraph, graphForCurrentSource, lastSkip } = await load();
    setupGraph(vid({ srcObject: {} })); // creates the context
    lastCtx!.state = "suspended";
    const v = vid({ srcObject: {} });
    expect(setupGraph(v)).toBeNull();

    // The popup meter looks the graph up, then reads why there is none.
    expect(graphForCurrentSource(v)).toBeNull();
    expect(lastSkip(v)).toBe("suspended");

    lastCtx!.state = "running";
    expect(setupGraph(v)).not.toBeNull();
    expect(lastSkip(v)).toBeNull();
  });

  it("caps the output with a hard limiter just below full scale", async () => {
    const { setupGraph } = await load();
    const { limiter } = setupGraph(vid({ srcObject: {} }))!;
    expect(limiter!.threshold.value).toBe(-1);
    expect(limiter!.knee.value).toBe(0);
    expect(limiter!.ratio.value).toBe(20);
  });

  it("skips with 'noctx' when the page has no Web Audio", async () => {
    const { setupGraph, lastSkip, audioContext } = await load();
    vi.stubGlobal("AudioContext", undefined);
    const v = vid({ srcObject: {} });

    expect(setupGraph(v)).toBeNull();
    expect(lastSkip(v)).toBe("noctx");
    expect(audioContext()).toBeNull();
  });

  it("skips with 'noctx' when the browser refuses a context, and tries again later", async () => {
    const { setupGraph, lastSkip } = await load();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("NotAllowedError");
        }
      },
    );
    const v = vid({ srcObject: {} });

    expect(setupGraph(v)).toBeNull();
    expect(lastSkip(v)).toBe("noctx");

    vi.stubGlobal("AudioContext", FakeAudioContext);
    expect(setupGraph(v)).not.toBeNull();
  });

  it("exposes the context and whether any graph has been built", async () => {
    const { setupGraph, audioContext, hasAudioGraphs } = await load();
    expect(audioContext()).toBeNull();
    expect(hasAudioGraphs()).toBe(false);

    setupGraph(vid({ currentSrc: "https://cdn.example.com/v.mp4" })); // cors: nothing built
    expect(hasAudioGraphs()).toBe(false);

    setupGraph(vid({ srcObject: {} }));
    expect(audioContext()).toBe(lastCtx);
    expect(hasAudioGraphs()).toBe(true);
  });
});

describe("AudioContext resume", () => {
  it("resumeAudioCtx only resumes a suspended context", async () => {
    const { setupGraph, resumeAudioCtx } = await load();
    resumeAudioCtx(); // no context yet: nothing to resume
    setupGraph(vid({ srcObject: {} }));
    const ctx = lastCtx!;

    resumeAudioCtx();
    expect(ctx.resumeCalls).toBe(0); // already running

    ctx.state = "suspended";
    resumeAudioCtx();
    expect(ctx.resumeCalls).toBe(1);
  });

  it("resumes a suspended context on the next click or keypress", async () => {
    const { setupGraph } = await load();
    setupGraph(vid({ srcObject: {} })); // creating the context hooks the gesture listeners
    const ctx = lastCtx!;

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.resumeCalls).toBe(0); // running: nothing to do

    ctx.state = "suspended";
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.resumeCalls).toBe(1);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(ctx.resumeCalls).toBe(2);
  });

  it("still sees the gesture when the player stops its propagation", async () => {
    const { setupGraph } = await load();
    setupGraph(vid({ srcObject: {} }));
    const ctx = lastCtx!;
    ctx.state = "suspended";
    const player = document.createElement("div");
    player.addEventListener("click", (e) => e.stopPropagation());
    player.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(player);

    player.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ctx.resumeCalls).toBe(1);
    player.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(ctx.resumeCalls).toBe(2);
  });

  it("installs the gesture listeners only once however often it is asked", async () => {
    const { setupGraph, hookAudioGesture } = await load();
    setupGraph(vid({ srcObject: {} })); // hooks on context creation
    hookAudioGesture();
    hookAudioGesture(); // applyAudioComp asks on every pass
    const ctx = lastCtx!;
    ctx.state = "suspended";

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ctx.resumeCalls).toBe(1);
  });

  it("resumes a suspended context when a captured video starts playing", async () => {
    const { setupGraph } = await load();
    const v = document.createElement("video");
    Object.defineProperty(v, "srcObject", { configurable: true, value: {} });
    expect(setupGraph(v)).not.toBeNull();
    const ctx = lastCtx!;
    ctx.state = "suspended";

    v.dispatchEvent(new Event("playing"));

    expect(ctx.resumeCalls).toBe(1);
  });

  it("re-applies compression once the context starts running", async () => {
    const { setupGraph } = await load();
    setupGraph(vid({ srcObject: {} }));
    const ctx = lastCtx!;

    ctx.state = "suspended";
    ctx.emit("statechange");
    expect(compressor.applyAudioComp).not.toHaveBeenCalled();

    ctx.state = "running";
    ctx.emit("statechange");
    expect(compressor.applyAudioComp).toHaveBeenCalledTimes(1);
  });
});

describe("content script shutdown", () => {
  it("wires every captured source straight to the output", async () => {
    const { setupGraph } = await load();
    // The lifecycle instance load() just imported routing.js with (modules were reset).
    const { abortContentListeners } = await import("../src/content/lifecycle.js");
    setupGraph(vid({ srcObject: {} }));
    setupGraph(vid({ src: "blob:https://x/abc" }));
    connections.length = 0;

    abortContentListeners(); // what teardown() does when the extension context dies

    expect(connections).toEqual([
      ["source", "disconnect"],
      ["source", "destination"],
      ["source", "disconnect"],
      ["source", "destination"],
    ]);
  });

  it("skips graphs whose video has since been garbage-collected", async () => {
    const refs: Array<{ collected: boolean }> = [];
    vi.stubGlobal(
      "WeakRef",
      class<T> {
        collected = false;
        constructor(readonly target: T) {
          refs.push(this);
        }
        deref(): T | undefined {
          return this.collected ? undefined : this.target;
        }
      },
    );
    const { setupGraph } = await load();
    const { abortContentListeners } = await import("../src/content/lifecycle.js");
    setupGraph(vid({ srcObject: {} }));
    refs[0].collected = true;
    setupGraph(vid({ srcObject: {} }));
    connections.length = 0;

    abortContentListeners();

    expect(connections).toEqual([
      ["source", "disconnect"],
      ["source", "destination"],
    ]);
  });
});
