// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  collectVideos,
  hasVideos,
  collectAudios,
  startTracking,
  stopTracking,
  reconcile,
} from "../src/content/videos.js";
import { SHADOW_ROOT_ATTACHED_EVENT } from "../src/shared/dom-events.js";

// MutationObserver callbacks fire on a microtask; let them drain before asserting.
const flush = () => new Promise((r) => setTimeout(r, 0));

let onMediaChange: ReturnType<typeof vi.fn>;
let onVideoPlay: ReturnType<typeof vi.fn>;
function track(isOwnNode: (n: Node) => boolean = () => false) {
  onMediaChange = vi.fn();
  onVideoPlay = vi.fn();
  startTracking({ onMediaChange, onContextDead: () => {}, isOwnNode, onVideoPlay });
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

  it("reports whether any tracked video is usable", () => {
    const v = document.createElement("video");
    document.body.appendChild(v);
    expect(hasVideos()).toBe(true);
    v.remove();
    expect(hasVideos()).toBe(false);
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

  it("still deep-scans added subtrees that contain media", async () => {
    track();
    const row = document.createElement("div");
    const nested = document.createElement("section");
    const v = document.createElement("video");
    nested.appendChild(v);
    row.appendChild(nested);

    document.body.appendChild(row);
    await flush();

    expect(collectVideos()).toContain(v);
    expect(onMediaChange).toHaveBeenCalled();
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

  it("reports play directly from a tracked shadow-DOM video", () => {
    const host = document.createElement("div");
    const video = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(video);
    document.body.appendChild(host);
    track();

    video.dispatchEvent(new Event("play"));

    expect(onVideoPlay).toHaveBeenCalledOnce();
    expect(onVideoPlay).toHaveBeenCalledWith(video);
  });

  it("catches a shadow player nested in a subtree with no light-DOM media", async () => {
    track();
    const wrapper = document.createElement("section");
    const host = document.createElement("div");
    const video = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(video);
    wrapper.appendChild(host);

    document.body.appendChild(wrapper);
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("observes a late empty shadow root signalled by the MAIN-world bridge", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    track();
    await flush();

    const root = host.attachShadow({ mode: "open" });
    host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true }));
    const video = document.createElement("video");
    root.appendChild(video);
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("observes an empty shadow root on a host inserted after detached creation", async () => {
    track();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    // The bridge event cannot reach document while the host is detached.
    host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true }));
    document.body.appendChild(host);
    await flush();

    const video = document.createElement("video");
    root.appendChild(video);
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("observes an empty shadow root already present when tracking starts", async () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);
    track();
    onMediaChange.mockClear();

    const video = document.createElement("video");
    root.appendChild(video);
    await flush();

    expect(collectVideos()).toContain(video);
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

  it("never tracks media inside our own light-DOM overlay", async () => {
    const overlay = document.createElement("div");
    const mirror = document.createElement("video");
    overlay.appendChild(mirror);
    document.body.appendChild(overlay);
    track((n) => n === overlay || overlay.contains(n));
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

  it("does not full-scan the document during reconcile", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    track();
    await flush();
    const queryAll = vi.spyOn(document, "querySelectorAll");

    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    reconcile();

    expect(collectVideos()).toHaveLength(1);
    expect(queryAll).not.toHaveBeenCalledWith("*");
  });

  it("drops old connected shadow-host candidates only after heavy DOM churn", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    for (let i = 0; i < 1030; i++) document.body.appendChild(document.createElement("div"));
    track();
    await flush();
    try {
      now.mockReturnValue(61_000);
      reconcile();
      host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
      reconcile();

      expect(collectVideos()).toHaveLength(0);
    } finally {
      now.mockRestore();
    }
  });

  it("can remember an evicted host again after it is re-added", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    for (let i = 0; i < 1030; i++) document.body.appendChild(document.createElement("div"));
    track();
    await flush();
    try {
      now.mockReturnValue(61_000);
      reconcile();

      host.remove();
      document.body.appendChild(host);
      await flush();
      host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
      reconcile();

      expect(collectVideos()).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });
});
