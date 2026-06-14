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
vi.mock("../src/content/live/metrics.js", () => ({ forwardBuffer: () => h.buffer, streamLatency: () => h.latency }));
vi.mock("../src/content/live/catchup.js", () => ({ catchupBufferLimited: () => h.limited }));

import { S } from "../src/content/state.js";
import { updateTimeBadge, ownsBadgeNode } from "../src/content/badge/overlay.js";

function fakeVideo(rect: Partial<DOMRect> = {}) {
  const r = { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, ...rect } as DOMRect;
  return { duration: 120, currentTime: 60, playbackRate: 1, getBoundingClientRect: () => r } as unknown as HTMLVideoElement;
}
const badgeEl = () => document.body.querySelector("div");
const badgeText = () => badgeEl()?.querySelector("span")?.textContent;

beforeEach(() => {
  h.primary = null; h.onStream = false; h.latency = null; h.buffer = 0; h.limited = false;
  S.showRemaining = true; S.streamBadge = true; S.badgePos = null; S.badgePinned = false;
  S.currentSpeed = 1; S.liveSyncEnabled = false; S.liveSyncTarget = 5;
});

describe("updateTimeBadge — visibility", () => {
  it("hides when the badge is disabled for this context", () => {
    S.showRemaining = false;
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl();
    if (el) expect((el as HTMLElement).style.display).toBe("none");
  });

  it("hides a VOD badge when the video has no finite duration", () => {
    h.primary = fakeVideo({} as DOMRect);
    (h.primary as { duration: number }).duration = Infinity;
    updateTimeBadge();
    const el = badgeEl();
    if (el) expect((el as HTMLElement).style.display).toBe("none");
  });
});

describe("updateTimeBadge — VOD rendering", () => {
  it("shows speed and the real remaining time (scaled by speed)", () => {
    h.primary = fakeVideo();           // 120s total, at 60s, 1× → 60s left
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
  it("shows latency with buffered-ahead in parentheses when the site exposes latency", () => {
    h.onStream = true; h.latency = 3; h.buffer = 5;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeText()).toBe("1× · 3.00s (5.00s)");
  });

  it("shows just the buffered-ahead seconds when there is no site latency", () => {
    h.onStream = true; h.latency = null; h.buffer = 4;
    h.primary = fakeVideo();
    updateTimeBadge();
    expect(badgeText()).toBe("1× · 4.00s");
  });

  it("appends a ⚠ when behind with a buffer too thin to catch up (sync on)", () => {
    S.liveSyncEnabled = true;
    h.onStream = true; h.latency = 12; h.buffer = 1; h.limited = true;
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
    expect(el.style.left).toBe("10px");   // max(10, 640*0.012)
    expect(el.style.top).toBe("14px");    // max(10, 360*0.04)
  });

  it("honors a saved per-site fraction of the video frame", () => {
    S.badgePos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateTimeBadge();
    const el = badgeEl() as HTMLElement;
    expect(el.style.left).toBe("320px");  // 0 + 0.5 * 640
    expect(el.style.top).toBe("180px");   // 0 + 0.5 * 360
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
