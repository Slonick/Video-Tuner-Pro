// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// The draggable on-video badge: updateTimeBadge positions it (saved fraction or
// the default corner) and renders speed + remaining time (VOD) or latency/buffer
// (live). Mock the video/live data sources and inspect the rendered element.
const h = vi.hoisted(() => ({
  primary: null as unknown,
  onStream: false,
  latency: null as number | null,
  buffer: 0,
  limited: false,
}));
vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => h.primary }));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => h.onStream }));
vi.mock("../src/content/live/metrics.js", () => ({
  forwardBuffer: () => h.buffer,
  streamLatency: () => h.latency,
}));
vi.mock("../src/content/live/catchup.js", () => ({ catchupBufferLimited: () => h.limited }));

import { S } from "../src/content/state.js";
import { updateTimeBadge, ownsBadgeNode } from "../src/content/badge/overlay.js";

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
// The badge now renders inside a shadow root on a marked host in the light DOM.
const badgeEl = () =>
  (document
    .querySelector("[data-vtp-badge]")
    ?.shadowRoot?.querySelector("div") as HTMLElement | null) ?? null;
const badgeText = () => badgeEl()?.querySelector("span")?.textContent;
// "Shown" = the badge element exists AND isn't display:none. (Absent counts as
// not shown — so a disabled badge that was never created still fails correctly if
// a regression makes it appear.)
const badgeShown = () => {
  const el = badgeEl();
  return !!el && el.style.display !== "none";
};

beforeEach(() => {
  h.primary = null;
  h.onStream = false;
  h.latency = null;
  h.buffer = 0;
  h.limited = false;
  S.showRemaining = true;
  S.streamBadge = true;
  S.badgePos = null;
  S.badgePinned = false;
  S.currentSpeed = 1;
  S.liveSyncEnabled = false;
  S.liveSyncTarget = 5;
});

describe("updateTimeBadge — visibility", () => {
  it("hides when the badge is disabled for this context", () => {
    S.showRemaining = false;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeShown()).toBe(false);
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
const fire = (el: EventTarget, type: string, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

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

  it("a double-click resets to the default corner", () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateTimeBadge();
    fire(badgeEl()!, "dblclick");
    expect(S.badgePos).toBeNull();
  });
});

describe("badge pin", () => {
  it("clicking the pin toggles the pinned state", () => {
    S.badgePinned = false;
    h.primary = fakeVideo();
    updateTimeBadge();
    const pin = badgeEl()!.querySelectorAll("span")[1]; // [text, pin]
    fire(pin, "click");
    expect(S.badgePinned).toBe(true);
    fire(pin, "click");
    expect(S.badgePinned).toBe(false);
  });
});

describe("flashBadge auto-hide", () => {
  it("reveals on mouse move over the video, then fades after the timeout", () => {
    vi.useFakeTimers();
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    el.style.opacity = "0";
    fire(document, "mousemove", { clientX: 100, clientY: 100 }); // inside the 640x360 frame
    expect(el.style.opacity).toBe("1");
    vi.advanceTimersByTime(2600);
    expect(el.style.opacity).toBe("0");
    vi.useRealTimers();
  });

  it("stays visible while pinned (no fade scheduled)", () => {
    vi.useFakeTimers();
    S.badgePinned = true;
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    fire(document, "mousemove", { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(5000);
    expect(el.style.opacity).toBe("1");
    vi.useRealTimers();
  });
});
