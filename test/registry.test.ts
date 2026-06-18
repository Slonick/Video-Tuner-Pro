// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  collectVideos,
  collectAudios,
  startTracking,
  stopTracking,
  reconcile,
} from "../src/content/videos.js";

// MutationObserver callbacks fire on a microtask; let them drain before asserting.
const flush = () => new Promise((r) => setTimeout(r, 0));

let onMediaChange: ReturnType<typeof vi.fn>;
function track(isOwnNode: (n: Node) => boolean = () => false) {
  onMediaChange = vi.fn();
  startTracking({ onMediaChange, onContextDead: () => {}, isOwnNode });
}

beforeEach(() => {
  document.body.innerHTML = "";
  stopTracking(); // reset to scan-on-read between tests
});
afterEach(() => stopTracking());

describe("media registry — scan-on-read fallback (registry not running)", () => {
  it("finds plain videos", () => {
    document.body.appendChild(document.createElement("video"));
    document.body.appendChild(document.createElement("video"));
    expect(collectVideos()).toHaveLength(2);
  });

  it("pierces open shadow roots", () => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    document.body.appendChild(host);
    expect(collectVideos()).toHaveLength(1);
  });

  it("drops media once it leaves the DOM (lazy isConnected prune)", () => {
    const v = document.createElement("video");
    document.body.appendChild(v);
    expect(collectVideos()).toContain(v);
    v.remove();
    expect(collectVideos()).not.toContain(v);
  });
});

describe("media registry — incremental tracking", () => {
  it("seeds the set with media already present at start", () => {
    const v = document.createElement("video");
    document.body.appendChild(v);
    track();
    expect(collectVideos()).toContain(v);
  });

  it("catches a video added later and signals a re-apply", async () => {
    track();
    const v = document.createElement("video");
    document.body.appendChild(v);
    await flush();
    expect(collectVideos()).toContain(v);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("does not signal a re-apply for an unrelated DOM mutation", async () => {
    track();
    document.body.appendChild(document.createElement("div")); // chat/feed churn
    await flush();
    expect(onMediaChange).not.toHaveBeenCalled();
  });

  it("catches a video added to a host's own shadow root (web-component player)", async () => {
    track();
    const host = document.createElement("div");
    const v = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(v);
    document.body.appendChild(host); // host added WITH its shadow already populated
    await flush();
    expect(collectVideos()).toContain(v);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("observes a media-bearing shadow root and catches an in-root swap", async () => {
    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    sr.appendChild(document.createElement("video")); // present at start → root gets observed
    document.body.appendChild(host);
    track();
    onMediaChange.mockClear();
    const swapped = document.createElement("video");
    sr.appendChild(swapped); // mutation INSIDE the shadow root
    await flush();
    expect(collectVideos()).toContain(swapped);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("never tracks media inside our own badge shadow root", async () => {
    const badgeHost = document.createElement("div");
    badgeHost.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    document.body.appendChild(badgeHost);
    track((n) => n === badgeHost); // isOwnNode flags the badge host
    expect(collectVideos()).toHaveLength(0);
  });

  it("tracks <audio> too", async () => {
    track();
    const a = document.createElement("audio");
    document.body.appendChild(a);
    await flush();
    expect(collectAudios()).toContain(a);
  });
});

describe("media registry — reconcile backstop", () => {
  it("catches a shadow root attached to an element that was already present", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host); // plain element, no shadow yet
    track();
    await flush();
    // attachShadow fires no mutation and the root isn't observed → observer misses it.
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    await flush();
    expect(collectVideos()).toHaveLength(0);
    // The periodic reconcile is the backstop.
    reconcile();
    expect(collectVideos()).toHaveLength(1);
  });
});
