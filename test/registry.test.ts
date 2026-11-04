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

  it("finds <audio> by scanning on read too", () => {
    const a = document.createElement("audio");
    document.body.appendChild(a);
    expect(collectAudios()).toContain(a);
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

  it("keeps the original video tracked while Viewer temporarily adopts it", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    track((n) => n === overlay || overlay.contains(n));
    expect(collectVideos()).toContain(video);

    video.setAttribute("data-vtp-viewer-adopted-video", "");
    overlay.appendChild(video);

    expect(collectVideos()).toContain(video);
    expect(hasVideos()).toBe(true);
  });

  it("tracks <audio> too", async () => {
    track();
    const a = document.createElement("audio");
    document.body.appendChild(a);
    await flush();
    expect(collectAudios()).toContain(a);
  });

  it("checks our own-UI ownership once per added subtree of plain elements", async () => {
    const isOwnNode = vi.fn(() => false);
    track(isOwnNode);
    const closest = vi.spyOn(Element.prototype, "closest");
    try {
      const feed = document.createElement("div");
      for (let i = 0; i < 50; i++) feed.appendChild(document.createElement("div"));
      isOwnNode.mockClear();

      document.body.appendChild(feed); // chat/feed churn
      await flush();

      expect(isOwnNode).toHaveBeenCalledTimes(1);
      expect(closest).not.toHaveBeenCalled();
    } finally {
      closest.mockRestore();
    }
  });

  it("reports play once for a video registered before tracking started", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    expect(collectVideos()).toContain(video); // scan-on-read registers it, without a listener
    track();
    expect(reconcile()).toBe(false); // already registered: nothing new, no second listener

    video.dispatchEvent(new Event("play"));

    expect(onVideoPlay).toHaveBeenCalledOnce();
    expect(onVideoPlay).toHaveBeenCalledWith(video);
  });

  it("stops reporting play and attached shadow roots once tracking stops", () => {
    const video = document.createElement("video");
    const host = document.createElement("div");
    document.body.append(video, host);
    track();
    stopTracking();

    video.dispatchEvent(new Event("play"));
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }));

    expect(onVideoPlay).not.toHaveBeenCalled();
    expect(onMediaChange).not.toHaveBeenCalled();
  });

  it("signals a re-apply when the bridge reports a root that already holds media", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    track();
    const video = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(video);

    host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }));

    expect(onMediaChange).toHaveBeenCalledOnce();
    expect(collectVideos()).toContain(video);
  });

  it("sees the bridge signal even when the page stops its propagation", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    track();
    const swallow = (e: Event) => e.stopPropagation();
    document.body.addEventListener(SHADOW_ROOT_ATTACHED_EVENT, swallow);
    try {
      const video = document.createElement("video");
      host.attachShadow({ mode: "open" }).appendChild(video);

      host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }));

      expect(collectVideos()).toContain(video);
    } finally {
      document.body.removeEventListener(SHADOW_ROOT_ATTACHED_EVENT, swallow);
    }
  });

  it("ignores a forged attach signal that does not come from an element", () => {
    track();
    const errors = vi.fn();
    window.addEventListener("error", errors);
    try {
      document.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT));

      expect(errors).not.toHaveBeenCalled();
      expect(onMediaChange).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", errors);
    }
  });

  it("catches media added deep inside an observed shadow root", async () => {
    const host = document.createElement("div");
    const slot = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(slot);
    document.body.appendChild(host);
    track();

    const video = document.createElement("video");
    slot.appendChild(video); // not a direct child of the observed root
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("observes an empty shadow root on a host nested in an added subtree", async () => {
    track();
    const wrapper = document.createElement("section");
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    wrapper.appendChild(host);
    document.body.appendChild(wrapper);
    await flush();

    const video = document.createElement("video");
    root.appendChild(video);
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("signals a re-apply for a player nested two shadow roots deep", async () => {
    track();
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const video = document.createElement("video");
    inner.attachShadow({ mode: "open" }).appendChild(video);
    outer.attachShadow({ mode: "open" }).appendChild(inner);

    document.body.appendChild(outer);
    await flush();

    expect(collectVideos()).toContain(video);
    expect(onMediaChange).toHaveBeenCalled();
  });

  it("does not signal a re-apply for a component whose shadow root holds no media", async () => {
    track();
    const widget = document.createElement("div");
    widget.attachShadow({ mode: "open" }).appendChild(document.createElement("span"));

    document.body.appendChild(widget); // e.g. an emote or icon web component in chat
    await flush();

    expect(onMediaChange).not.toHaveBeenCalled();
  });

  it("does not signal a re-apply when our own UI is inserted", async () => {
    const badgeHost = document.createElement("div");
    track((n) => n === badgeHost);
    badgeHost.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    document.body.appendChild(badgeHost);
    await flush();

    expect(onMediaChange).not.toHaveBeenCalled();
    expect(collectVideos()).toHaveLength(0);
  });

  it("ignores our own media inside a re-inserted page subtree", async () => {
    const ownUi = document.createElement("div");
    const mirror = document.createElement("video");
    const cue = document.createElement("audio");
    ownUi.append(mirror, cue);
    track((n) => ownUi.contains(n));
    const playerBox = document.createElement("div"); // a page element our UI is mounted in
    playerBox.appendChild(ownUi);

    document.body.appendChild(playerBox);
    await flush();
    mirror.dispatchEvent(new Event("play"));

    expect(onMediaChange).not.toHaveBeenCalled();
    expect(onVideoPlay).not.toHaveBeenCalled();
    expect(collectAudios()).not.toContain(cue);
  });

  it("does not report media added inside the viewer overlay", async () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.appendChild(overlay);
    track();
    const mirror = document.createElement("video");
    const cue = document.createElement("audio");

    overlay.append(mirror, cue);
    await flush();
    mirror.dispatchEvent(new Event("play"));

    expect(onMediaChange).not.toHaveBeenCalled();
    expect(onVideoPlay).not.toHaveBeenCalled();
    expect(collectAudios()).not.toContain(cue);
  });

  it("stops reporting a page video moved into our own UI without adoption", () => {
    const video = document.createElement("video");
    const ownUi = document.createElement("div");
    document.body.append(video, ownUi);
    track((n) => ownUi.contains(n));
    expect(collectVideos()).toContain(video);

    ownUi.appendChild(video);

    expect(collectVideos()).not.toContain(video);
    expect(hasVideos()).toBe(false);
  });

  it("stops reporting a page video moved into the viewer overlay without adoption", () => {
    const video = document.createElement("video");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.append(video, overlay);
    track();
    expect(collectVideos()).toContain(video);

    overlay.appendChild(video);

    expect(collectVideos()).not.toContain(video);
  });

  it("treats a video that returns after a collectVideos prune as new media", async () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    track();
    video.remove();
    expect(collectVideos()).not.toContain(video);

    document.body.appendChild(video);
    await flush();

    expect(onMediaChange).toHaveBeenCalledOnce();
  });

  it("treats a video that returns after a hasVideos prune as new media", async () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    track();
    video.remove();
    expect(hasVideos()).toBe(false);

    document.body.appendChild(video);
    await flush();

    expect(onMediaChange).toHaveBeenCalledOnce();
  });

  it("reports a new <audio> once and forgets it after removal", async () => {
    track();
    const audio = document.createElement("audio");
    document.body.appendChild(audio);
    await flush();
    expect(onMediaChange).toHaveBeenCalledOnce();
    expect(reconcile()).toBe(false); // already registered

    audio.remove();
    expect(collectAudios()).not.toContain(audio);
    onMediaChange.mockClear();
    document.body.appendChild(audio);
    await flush();

    expect(onMediaChange).toHaveBeenCalledOnce();
    expect(collectAudios()).toContain(audio);
  });

  it("answers hasVideos and collectAudios from the tracked set without walking the DOM", () => {
    const audio = document.createElement("audio");
    document.body.append(document.createElement("video"), audio);
    track();
    const queryAll = vi.spyOn(document, "querySelectorAll");
    queryAll.mockClear();
    try {
      expect(hasVideos()).toBe(true);
      expect(collectAudios()).toContain(audio);
      expect(queryAll).not.toHaveBeenCalled();
    } finally {
      queryAll.mockRestore();
    }
  });
});

describe("media registry — dead extension context", () => {
  const runtime = globalThis.chrome.runtime as { id?: unknown };
  let savedId: unknown;
  let onContextDead: ReturnType<typeof vi.fn>;

  // Tracking starts while the context is alive; then the extension is reloaded.
  function trackThenKillContext() {
    onMediaChange = vi.fn();
    onVideoPlay = vi.fn();
    onContextDead = vi.fn();
    startTracking({ onMediaChange, onContextDead, isOwnNode: () => false, onVideoPlay });
    runtime.id = undefined;
  }

  beforeEach(() => {
    savedId = runtime.id;
  });
  afterEach(() => {
    runtime.id = savedId;
  });

  it("tears down instead of reporting play", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    trackThenKillContext();

    video.dispatchEvent(new Event("play"));

    expect(onContextDead).toHaveBeenCalledOnce();
    expect(onVideoPlay).not.toHaveBeenCalled();
  });

  it("tears down instead of scanning added nodes", async () => {
    trackThenKillContext();

    document.body.appendChild(document.createElement("video"));
    await flush();

    expect(onContextDead).toHaveBeenCalledOnce();
    expect(onMediaChange).not.toHaveBeenCalled();
  });

  it("tears down instead of scanning a newly attached shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    trackThenKillContext();
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    host.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }));

    expect(onContextDead).toHaveBeenCalledOnce();
    expect(onMediaChange).not.toHaveBeenCalled();
  });
});

describe("media registry — reconcile backstop", () => {
  it("catches a shadow root attached to a custom element that was already present", async () => {
    const host = document.createElement("video-player");
    document.body.appendChild(host); // no shadow yet
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

  it("keeps a custom-element host remembered through plain-element churn", async () => {
    const host = document.createElement("video-player");
    document.body.appendChild(host);
    for (let i = 0; i < 1030; i++) document.body.appendChild(document.createElement("div"));
    track();
    await flush();

    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    reconcile();

    expect(collectVideos()).toHaveLength(1);
  });

  it("keeps a host first seen during reconcile when the candidate list is full", async () => {
    const gone = document.createElement("x-gone");
    const outer = document.createElement("x-outer");
    document.body.append(gone, outer);
    for (let i = 0; i < 1022; i++) document.body.appendChild(document.createElement("x-item"));
    track(); // 1024 candidates: the list is full
    gone.remove();
    // A root attached without the bridge event, holding a host not yet upgraded.
    const inner = document.createElement("x-inner");
    outer.attachShadow({ mode: "open" }).appendChild(inner);
    reconcile(); // remembers `inner` while walking `outer`

    document.body.appendChild(inner); // moved out — only its own candidacy can find it now
    await flush();
    inner.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    reconcile();

    expect(collectVideos()).toHaveLength(1);
  });

  it("does not full-scan the document during reconcile", async () => {
    const host = document.createElement("video-player");
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
    const host = document.createElement("video-player");
    document.body.appendChild(host);
    for (let i = 0; i < 1024; i++) document.body.appendChild(document.createElement("x-item"));
    track();
    await flush();
    reconcile();
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    reconcile();

    expect(collectVideos()).toHaveLength(0);
  });

  it("can remember an evicted host again after it is re-added", async () => {
    const host = document.createElement("video-player");
    document.body.appendChild(host);
    for (let i = 0; i < 1030; i++) document.body.appendChild(document.createElement("x-item"));
    track();
    await flush();
    reconcile();

    host.remove();
    document.body.appendChild(host);
    await flush();
    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    reconcile();

    expect(collectVideos()).toHaveLength(1);
  });

  it("reports whether it registered anything new", async () => {
    track();
    expect(reconcile()).toBe(false);

    const video = document.createElement("video");
    document.body.appendChild(video); // reconcile can run before the observer's callback
    expect(reconcile()).toBe(true);
    expect(collectVideos()).toContain(video);
    expect(reconcile()).toBe(false);

    await flush();
    expect(onMediaChange).not.toHaveBeenCalled(); // nor is it new to the observer
  });

  it("finds a late root nested in a host the bridge announced", async () => {
    const outer = document.createElement("div");
    document.body.appendChild(outer);
    track();
    const outerRoot = outer.attachShadow({ mode: "open" });
    outer.dispatchEvent(new Event(SHADOW_ROOT_ATTACHED_EVENT, { bubbles: true, composed: true }));
    const inner = document.createElement("div");
    outerRoot.appendChild(inner);
    await flush();
    // A nested root attached without a bridge signal is invisible to the observer.
    inner.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));
    await flush();
    expect(collectVideos()).toHaveLength(0);

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("finds a late root nested in a host whose shadow root predates tracking", () => {
    const host = document.createElement("div");
    const inner = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(inner);
    document.body.appendChild(host);
    track();

    inner.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("remembers a custom-element host that arrives inside an added subtree", async () => {
    track();
    const wrapper = document.createElement("section");
    const host = document.createElement("video-player");
    wrapper.appendChild(host);
    document.body.appendChild(wrapper);
    await flush();

    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("remembers hosts again after tracking restarts", () => {
    const host = document.createElement("video-player");
    document.body.appendChild(host);
    track();
    stopTracking();
    track();

    host.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("does not crowd out other hosts when it re-walks a busy shadow root", () => {
    const player = document.createElement("video-player");
    const widget = document.createElement("div");
    const root = widget.attachShadow({ mode: "open" });
    for (let i = 0; i < 700; i++) root.appendChild(document.createElement("x-item"));
    document.body.append(player, widget);
    track(); // 702 candidates: the player, the widget and the widget's items
    reconcile(); // walks the widget's root again; its items are already remembered

    player.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("frees the slots of removed hosts so later churn cannot evict a live player", async () => {
    const player = document.createElement("video-player");
    const feed = document.createElement("div");
    for (let i = 0; i < 1000; i++) feed.appendChild(document.createElement("x-card"));
    document.body.append(player, feed);
    track();
    feed.remove();
    reconcile(); // forgets the 1000 removed cards

    const next = document.createElement("div");
    for (let i = 0; i < 1000; i++) next.appendChild(document.createElement("x-card"));
    document.body.appendChild(next);
    await flush();
    player.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });

  it("does not let our own UI take a full candidate list's slot from a page player", () => {
    const player = document.createElement("video-player");
    const badgeHost = document.createElement("div");
    badgeHost.attachShadow({ mode: "open" });
    document.body.appendChild(player);
    for (let i = 0; i < 1023; i++) document.body.appendChild(document.createElement("x-item"));
    document.body.appendChild(badgeHost);
    track((n) => n === badgeHost); // 1024 page candidates: the list is full

    player.attachShadow({ mode: "open" }).appendChild(document.createElement("video"));

    expect(reconcile()).toBe(true);
    expect(collectVideos()).toHaveLength(1);
  });
});
