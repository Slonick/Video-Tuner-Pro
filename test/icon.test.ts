// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const realTop = Object.getOwnPropertyDescriptor(window, "top");
  const asSubframe = () => Object.defineProperty(window, "top", { value: {}, configurable: true });

  beforeEach(() => {
    vi.resetModules();
    h.videos = [];
    h.messages = [];
    h.live = false;
    window.history.replaceState(null, "", "/one");
  });

  afterEach(async () => {
    if (realTop) Object.defineProperty(window, "top", realTop);
    // Drop this test's pagehide listener so it can't answer a later test's event.
    const { abortContentListeners } = await import("../src/content/lifecycle.js");
    abortContentListeners();
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

  it("clears the toolbar badge when the site is switched off, then stays quiet", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");
    const { S } = await import("../src/content/state.js");
    h.videos = [document.createElement("video")];

    updateBadge();
    S.siteDisabled = true;
    updateBadge();
    updateBadge();

    expect(h.messages).toEqual([
      { action: "icon", text: "1.0", live: false },
      { action: "icon", clear: true },
    ]);
  });

  it("never sets a toolbar badge on a blacklisted site", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");
    const { S } = await import("../src/content/state.js");
    h.videos = [document.createElement("video")];
    S.siteDisabled = true;

    updateBadge();

    expect(h.messages).toEqual([]);
  });

  it("hands the toolbar badge back when its iframe goes away", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");
    asSubframe();
    h.videos = [document.createElement("video")];

    updateBadge();
    window.dispatchEvent(new Event("pagehide"));
    // Restored from the back/forward cache: the badge is reported again.
    updateBadge();

    expect(h.messages).toEqual([
      { action: "icon", text: "1.0", live: false },
      { action: "icon", clear: true },
      { action: "icon", text: "1.0", live: false },
    ]);
  });

  it("leaves the top frame's badge to the tab navigation, then re-reports it", async () => {
    const { updateBadge } = await import("../src/content/badge/icon.js");
    h.videos = [document.createElement("video")];

    updateBadge();
    window.dispatchEvent(new Event("pagehide"));
    updateBadge();

    expect(h.messages).toEqual([
      { action: "icon", text: "1.0", live: false },
      { action: "icon", text: "1.0", live: false },
    ]);
  });

  it("stays silent on pagehide in a frame that never showed a badge", async () => {
    await import("../src/content/badge/icon.js");
    asSubframe();

    window.dispatchEvent(new Event("pagehide"));

    expect(h.messages).toEqual([]);
  });
});
