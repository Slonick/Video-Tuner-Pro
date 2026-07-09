// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// The draggable on-video badge: updateTimeBadge positions it (saved fraction or
// the default corner) and renders speed + remaining time (VOD) or latency/buffer
// (live). Mock the video/live data sources and inspect the rendered element.
const h = vi.hoisted(() => ({
  primary: null as unknown,
  anchor: null as unknown,
  onStream: false,
  latency: null as number | null,
  buffer: 0,
  limited: false,
  primaryCalls: 0,
}));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => {
    h.primaryCalls++;
    return h.primary;
  },
}));
vi.mock("../src/content/viewer.js", () => ({
  VIEWER_LAYOUT_EVENT: "vtp-viewer-layout",
  viewerAnchorVideo: () => h.anchor,
}));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => h.onStream }));
vi.mock("../src/content/live/metrics.js", () => ({
  forwardBuffer: () => h.buffer,
  streamLatency: () => h.latency,
}));
vi.mock("../src/content/live/catchup.js", () => ({ catchupBufferLimited: () => h.limited }));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  updateTimeBadge,
  flashBadge,
  showBadgeNotice,
  ownsBadgeNode,
} from "../src/content/badge/overlay.js";

function fakeVideo(rect: Partial<DOMRect> = {}) {
  const r = {
    left: 0,
    top: 0,
    width: 640,
    height: 360,
    right: 640,
    bottom: 360,
    ...rect,
  } as DOMRect;
  return {
    duration: 120,
    currentTime: 60,
    playbackRate: 1,
    getBoundingClientRect: () => r,
  } as unknown as HTMLVideoElement;
}

function realVideo(rect: Partial<DOMRect> = {}) {
  const el = document.createElement("video");
  Object.defineProperty(el, "duration", { value: 120, configurable: true });
  Object.defineProperty(el, "currentTime", { value: 60, configurable: true });
  Object.defineProperty(el, "playbackRate", { value: 1, configurable: true });
  const r = {
    left: 0,
    top: 0,
    width: 640,
    height: 360,
    right: 640,
    bottom: 360,
    ...rect,
  } as DOMRect;
  el.getBoundingClientRect = () => r;
  return el;
}
// The badge now renders inside a shadow root on a marked host in the light DOM.
const badgeEl = () =>
  (document
    .querySelector("[data-vtp-badge]")
    ?.shadowRoot?.querySelector("div") as HTMLElement | null) ?? null;
const badgeText = () => badgeEl()?.querySelector("span")?.textContent;
const badgePin = () =>
  Array.from(badgeEl()?.querySelectorAll("span") ?? []).at(1) as HTMLSpanElement | undefined;
const badgeNotice = () =>
  Array.from(badgeEl()?.querySelectorAll("span") ?? []).at(2) as HTMLSpanElement | undefined;
// "Shown" = the badge element exists AND isn't display:none. (Absent counts as
// not shown — so a disabled badge that was never created still fails correctly if
// a regression makes it appear.)
const badgeShown = () => {
  const el = badgeEl();
  return !!el && el.style.display !== "none";
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  document.querySelectorAll("[data-vtp-badge]").forEach((node) => node.remove());
  h.primary = null;
  h.anchor = null;
  h.onStream = false;
  h.latency = null;
  h.buffer = 0;
  h.limited = false;
  h.primaryCalls = 0;
  S.showRemaining = true;
  S.streamBadge = true;
  S.badgePos = null;
  S.badgePinned = false;
  S.currentSpeed = 1;
  S.liveSyncEnabled = false;
  S.liveSyncTarget = 5;
  STORE.set({ badgePos: {}, badgePinned: {} });
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  Object.defineProperty(document, "webkitFullscreenElement", { value: null, configurable: true });
});

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};

describe("updateTimeBadge — visibility", () => {
  it("removes a stale badge host left by a previous content script", () => {
    const stale = document.createElement("div");
    stale.setAttribute("data-vtp-badge", "");
    document.body.append(stale);
    h.primary = fakeVideo();
    updateTimeBadge();
    const hosts = document.querySelectorAll("[data-vtp-badge]");
    expect(hosts.length).toBe(1);
    expect(hosts[0]).not.toBe(stale);
  });

  it("removes current-version stale hosts without a repeated document-wide sweep", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    document.querySelector("[data-vtp-badge]")?.remove();

    const stale = document.createElement("div");
    stale.id = "vtp-badge-host";
    stale.setAttribute("data-vtp-badge", "");
    document.body.append(stale);
    const query = vi.spyOn(document, "querySelectorAll");

    updateTimeBadge();

    expect(document.querySelector("[data-vtp-badge]")).not.toBe(stale);
    expect(query).not.toHaveBeenCalledWith("[data-vtp-badge]");
  });

  it("makes the pin keyboard accessible and reflects pressed state", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const pin = badgePin()!;

    expect(pin.getAttribute("role")).toBe("button");
    expect(pin.tabIndex).toBe(0);
    expect(pin.getAttribute("aria-label")).toBeTruthy();
    expect(pin.getAttribute("aria-pressed")).toBe("false");

    pin.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(S.badgePinned).toBe(true);
    expect(pin.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides when the badge is disabled for this context", () => {
    S.showRemaining = false;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeShown()).toBe(false);
  });

  it("does not walk media when both badge modes are disabled", () => {
    S.showRemaining = false;
    S.streamBadge = false;
    h.primary = fakeVideo();

    updateTimeBadge();

    expect(badgeShown()).toBe(false);
    expect(h.primaryCalls).toBe(0);
  });

  it("hides on a live stream when the stream badge is disabled", () => {
    h.onStream = true;
    h.latency = 3;
    h.buffer = 5;
    S.streamBadge = false;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeShown()).toBe(false);
  });

  it("hides a VOD badge when the video has no finite duration", () => {
    h.primary = fakeVideo({} as DOMRect);
    (h.primary as { duration: number }).duration = Infinity;
    updateTimeBadge();
    expect(badgeShown()).toBe(false);
  });
});

describe("updateTimeBadge — VOD rendering", () => {
  it("shows speed and the real remaining time (scaled by speed)", () => {
    h.primary = fakeVideo(); // 120s total, at 60s, 1× → 60s left
    updateTimeBadge();
    expect(badgeText()).toBe("1× · 1:00");
  });

  it("scales remaining time by the playback speed", () => {
    const v = fakeVideo();
    (v as { playbackRate: number }).playbackRate = 2; // 60s of content at 2× → 30s
    h.primary = v;
    updateTimeBadge();
    expect(badgeText()).toBe("2× · 0:30");
  });
});

describe("updateTimeBadge — live rendering", () => {
  it("shows the latency alone when the site exposes it (no buffer parenthetical)", () => {
    h.onStream = true;
    h.latency = 3;
    h.buffer = 5;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeText()).toBe("1× · 3.00s");
  });

  it("shows just the buffered-ahead seconds when there is no site latency", () => {
    h.onStream = true;
    h.latency = null;
    h.buffer = 4;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeText()).toBe("1× · 4.00s");
  });

  it("appends a ⚠ when behind with a buffer too thin to catch up (sync on)", () => {
    S.liveSyncEnabled = true;
    h.onStream = true;
    h.latency = 12;
    h.buffer = 1;
    h.limited = true;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeText()).toContain("⚠");
  });
});

describe("updateTimeBadge — positioning", () => {
  it("defaults to the top-left corner when never moved", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("10px"); // max(10, 640*0.012)
    expect(el.style.top).toBe("14px"); // max(10, 360*0.04)
  });

  it("honors a saved per-site fraction of the video frame", () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("320px"); // 0 + 0.5 * 640
    expect(el.style.top).toBe("180px"); // 0 + 0.5 * 360
  });

  it("clamps a saved position so the badge stays inside the video frame", () => {
    S.badgePos = { fx: 1, fy: 1 };
    h.primary = fakeVideo({ left: 20, top: 30, width: 640, height: 360, right: 660, bottom: 390 });
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 }) as DOMRect;
    updateTimeBadge();
    expect(el.style.left).toBe("540px");
    expect(el.style.top).toBe("350px");
  });

  it("repositions on window resize outside the pop-out viewer", async () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    updateTimeBadge();
    h.primary = fakeVideo({ left: 20, top: 30, width: 800, height: 450, right: 820, bottom: 480 });
    window.dispatchEvent(new Event("resize"));
    await frame();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("420px");
    expect(el.style.top).toBe("255px");
  });

  it("repositions on window scroll outside the pop-out viewer", async () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    updateTimeBadge();
    h.primary = fakeVideo({ left: 0, top: -120, width: 640, height: 360, right: 640, bottom: 240 });
    window.dispatchEvent(new Event("scroll"));
    await frame();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("320px");
    expect(el.style.top).toBe("60px");
  });

  it("coalesces layout-event repositioning into one animation frame", async () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateTimeBadge();
    const readRect = vi.fn(
      () =>
        ({
          left: 20,
          top: 30,
          width: 800,
          height: 450,
          right: 820,
          bottom: 480,
        }) as DOMRect,
    );
    (h.primary as HTMLVideoElement).getBoundingClientRect = readRect;

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));

    expect(readRect).not.toHaveBeenCalled();
    await frame();
    expect(readRect).toHaveBeenCalledTimes(1);
  });

  it("positions against the viewer anchor while the pop-out viewer is open", () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    h.anchor = fakeVideo({ left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500 });
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("500px");
    expect(el.style.top).toBe("275px");
  });

  it("repositions when the viewer anchor changes", async () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    h.anchor = fakeVideo({ left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500 });
    updateTimeBadge();
    h.anchor = null;
    document.dispatchEvent(new Event("vtp-viewer-layout"));
    await frame();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("320px");
    expect(el.style.top).toBe("180px");
  });

  it("parents the badge inside a fullscreen container", () => {
    const video = realVideo();
    const wrapper = document.createElement("div");
    wrapper.append(video);
    document.body.append(wrapper);
    h.primary = video;
    Object.defineProperty(document, "fullscreenElement", { value: wrapper, configurable: true });

    updateTimeBadge();

    expect(document.querySelector("[data-vtp-badge]")?.parentNode).toBe(wrapper);
  });

  it("does not parent the badge inside a bare fullscreen video", () => {
    const video = realVideo();
    document.body.append(video);
    h.primary = video;
    Object.defineProperty(document, "fullscreenElement", { value: video, configurable: true });

    updateTimeBadge();

    const host = document.querySelector("[data-vtp-badge]");
    expect(host?.parentNode).toBe(document.body);
    expect(video.querySelector("[data-vtp-badge]")).toBeNull();
  });

  it("uses a prefixed fullscreen container when the browser exposes one", () => {
    const video = realVideo();
    const wrapper = document.createElement("div");
    wrapper.append(video);
    document.body.append(wrapper);
    h.primary = video;
    Object.defineProperty(document, "webkitFullscreenElement", {
      value: wrapper,
      configurable: true,
    });

    updateTimeBadge();

    expect(document.querySelector("[data-vtp-badge]")?.parentNode).toBe(wrapper);
  });

  it("does not parent the badge inside a bare prefixed fullscreen video", () => {
    const video = realVideo();
    document.body.append(video);
    h.primary = video;
    Object.defineProperty(document, "webkitFullscreenElement", {
      value: video,
      configurable: true,
    });

    updateTimeBadge();

    const host = document.querySelector("[data-vtp-badge]");
    expect(host?.parentNode).toBe(document.body);
    expect(video.querySelector("[data-vtp-badge]")).toBeNull();
  });
});

describe("ownsBadgeNode", () => {
  it("recognizes nodes inside our own badge (so the observer ignores our writes)", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const span = badgeEl()!.querySelector("span")!;
    expect(ownsBadgeNode(span)).toBe(true);
    expect(ownsBadgeNode(document.body)).toBe(false);
    expect(ownsBadgeNode(null)).toBe(false);
  });
});

// Dispatch a pointer/mouse event by type name (the handlers listen by type, so a
// MouseEvent of type "pointermove" still fires the pointermove listener — and it
// sidesteps jsdom's partial PointerEvent support).
const fire = (
  el: EventTarget,
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  if (init.pointerId != null) Object.defineProperty(ev, "pointerId", { value: init.pointerId });
  return el.dispatchEvent(ev);
};

describe("badge drag", () => {
  it("dropping after a drag saves the per-site position fraction", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    // Land the badge at the centre of the 640x360 frame.
    el.getBoundingClientRect = () => ({
      left: 320,
      top: 180,
      width: 0,
      height: 0,
      right: 320,
      bottom: 180,
      x: 320,
      y: 180,
      toJSON() {},
    });
    fire(el, "pointerdown", { clientX: 10, clientY: 10 });
    fire(el, "pointermove", { clientX: 330, clientY: 190 });
    fire(el, "pointerup", { clientX: 330, clientY: 190 });
    expect(S.badgePos).not.toBeNull();
    expect(S.badgePos!.fx).toBeCloseTo(0.5, 1);
    expect(S.badgePos!.fy).toBeCloseTo(0.5, 1);
  });

  it("finishes a drag from a document-level pointerup when capture is lost", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    el.getBoundingClientRect = () => ({
      left: 320,
      top: 180,
      width: 0,
      height: 0,
      right: 320,
      bottom: 180,
      x: 320,
      y: 180,
      toJSON() {},
    });

    fire(el, "pointerdown", { clientX: 10, clientY: 10, pointerId: 7 });
    fire(el, "pointermove", { clientX: 330, clientY: 190, pointerId: 7 });
    fire(document, "pointerup", { clientX: 330, clientY: 190, pointerId: 7 });

    expect(S.badgePos).not.toBeNull();
    expect(S.badgePos!.fx).toBeCloseTo(0.5, 1);
    expect(S.badgePos!.fy).toBeCloseTo(0.5, 1);
  });

  it("cancels a drag on window blur so the badge can auto-hide again", () => {
    vi.useFakeTimers();
    try {
      h.primary = fakeVideo();
      updateTimeBadge();
      const el = badgeEl() as HTMLElement;
      fire(el, "pointerdown", { clientX: 10, clientY: 10, pointerId: 8 });
      fire(el, "pointermove", { clientX: 20, clientY: 20, pointerId: 8 });
      window.dispatchEvent(new Event("blur"));

      flashBadge();
      vi.advanceTimersByTime(2600);

      expect(el.style.opacity).toBe("0");
      expect(el.style.cursor).toBe("grab");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mutate the previous saved-position map while saving", () => {
    const map = { other: { fx: 0.1, fy: 0.2 } };
    STORE.set({ badgePos: map });
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    el.getBoundingClientRect = () => ({
      left: 320,
      top: 180,
      width: 0,
      height: 0,
      right: 320,
      bottom: 180,
      x: 320,
      y: 180,
      toJSON() {},
    });

    fire(el, "pointerdown", { clientX: 10, clientY: 10 });
    fire(el, "pointermove", { clientX: 330, clientY: 190 });
    fire(el, "pointerup", { clientX: 330, clientY: 190 });

    expect(map).toEqual({ other: { fx: 0.1, fy: 0.2 } });
    expect(get(["badgePos"]).badgePos).toMatchObject({ other: { fx: 0.1, fy: 0.2 } });
  });

  it("a double-click resets to the default corner", () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    STORE.set({ badgePos: { localhost: { fx: 0.5, fy: 0.5 } } });
    h.primary = fakeVideo();
    updateTimeBadge();
    fire(badgeEl()!, "dblclick");
    expect(S.badgePos).toBeNull();
    expect(get(["badgePos"]).badgePos).toBeUndefined();
  });
});

describe("badge pin", () => {
  it("clicking the pin toggles the pinned state", () => {
    S.badgePinned = false;
    STORE.set({ badgePinned: { localhost: true } });
    h.primary = fakeVideo();
    updateTimeBadge();
    const pin = badgeEl()!.querySelectorAll("span")[1]; // [text, pin]
    fire(pin, "click");
    expect(S.badgePinned).toBe(true);
    fire(pin, "click");
    expect(S.badgePinned).toBe(false);
    expect(get(["badgePinned"]).badgePinned).toBeUndefined();
  });

  it("does not mutate the previous pin map while toggling", () => {
    const map = { other: true };
    STORE.set({ badgePinned: map });
    h.primary = fakeVideo();
    updateTimeBadge();
    const pin = badgeEl()!.querySelectorAll("span")[1];

    fire(pin, "click");

    expect(map).toEqual({ other: true });
    expect(get(["badgePinned"]).badgePinned).toMatchObject({ other: true, localhost: true });
  });
});

describe("flashBadge auto-hide", () => {
  it("coalesces mousemove hover checks into one animation frame", async () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    const readRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 640,
          height: 360,
          right: 640,
          bottom: 360,
        }) as DOMRect,
    );
    (h.primary as HTMLVideoElement).getBoundingClientRect = readRect;

    fire(document, "mousemove", { clientX: 100, clientY: 100 });
    fire(document, "mousemove", { clientX: 101, clientY: 101 });

    expect(readRect).not.toHaveBeenCalled();
    await frame();
    expect(readRect).toHaveBeenCalledTimes(1);
  });

  it("reveals on mouse move over the video, then fades after the timeout", async () => {
    vi.useFakeTimers();
    try {
      h.primary = fakeVideo();
      updateTimeBadge();
      const el = badgeEl() as HTMLElement;
      el.style.opacity = "0";
      fire(document, "mousemove", { clientX: 100, clientY: 100 }); // inside the 640x360 frame
      await vi.advanceTimersByTimeAsync(16);
      expect(el.style.opacity).toBe("1");
      await vi.advanceTimersByTimeAsync(2600);
      expect(el.style.opacity).toBe("0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays visible while pinned (no fade scheduled)", async () => {
    vi.useFakeTimers();
    try {
      S.badgePinned = true;
      h.primary = fakeVideo();
      updateTimeBadge();
      const el = badgeEl() as HTMLElement;
      fire(document, "mousemove", { clientX: 100, clientY: 100 });
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(5000);
      expect(el.style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("badge notice", () => {
  it("shows a separate right-side notice bubble without replacing the badge readout", async () => {
    vi.useFakeTimers();
    try {
      h.primary = fakeVideo();
      updateTimeBadge();

      showBadgeNotice("Paused");

      expect(badgeText()).toBe("1× · 1:00");
      expect(badgeNotice()?.textContent).toBe("Paused");
      expect(badgeNotice()?.style.opacity).toBe("1");
      expect(badgeNotice()?.style.transform).toBe("translate(0, -50%) scale(1)");
      expect(badgeNotice()?.style.animation).toContain("vtp-badge-notice-in");
      expect((badgeEl() as HTMLElement).style.background).toContain("rgb(20 20 22");

      await vi.advanceTimersByTimeAsync(1450);

      expect(badgeText()).toBe("1× · 1:00");
      expect(badgeNotice()?.style.opacity).toBe("0");
      expect(badgeNotice()?.style.transform).toBe("translate(-18px, -50%) scale(.36)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-render the badge on repeated notice updates", () => {
    h.primary = fakeVideo();
    updateTimeBadge();
    h.primaryCalls = 0;

    showBadgeNotice("+0:05");
    showBadgeNotice("+0:10");

    expect(h.primaryCalls).toBe(0);
    expect(badgeNotice()?.textContent).toBe("+0:10");
  });
});
