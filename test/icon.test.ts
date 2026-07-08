// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  videos: [] as HTMLVideoElement[],
  messages: [] as unknown[],
  live: false,
}));

vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => h.videos,
  hasVideos: () => h.videos.length > 0,
}));

vi.mock("../src/content/live/detection.js", () => ({
  onStreamPage: () => h.live,
}));

vi.mock("../src/content/platform/browser.js", () => ({
  ctxValid: () => true,
  api: {
    runtime: {
      sendMessage: (payload: unknown) => h.messages.push(payload),
    },
  },
}));

describe("toolbar badge updates", () => {
  beforeEach(() => {
    vi.resetModules();
    h.videos = [];
    h.messages = [];
    h.live = false;
    window.history.replaceState(null, "", "/one");
  });

  it("does not clear the toolbar badge from a frame that never owned a video", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");

    updateBadge();
    window.history.replaceState(null, "", "/two");
    updateBadge();

    expect(h.messages).toEqual([]);
  });

  it("clears the toolbar badge after its own video disappears", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");
    const video = document.createElement("video");

    h.videos = [video];
    updateBadge();
    h.videos = [];
    updateBadge();

    expect(h.messages).toEqual([
      { action: "icon", text: "1.0", live: false },
      { action: "icon", clear: true },
    ]);
  });
});
