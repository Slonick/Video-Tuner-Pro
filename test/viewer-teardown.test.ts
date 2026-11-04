// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// An extension update orphans the running content script and injects a fresh one
// into the same page. Each test loads its own viewer instance (a fresh module
// graph), so its teardown and its start-up cleanup run as they would in a tab.
const h = vi.hoisted(() => ({ primary: null as unknown }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => h.primary,
  collectVideos: () => (h.primary ? [h.primary as HTMLVideoElement] : []),
  isDrmVideo: () => false,
}));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));

// Writable view of the mock runtime: a dead extension context drops its id.
const runtime = globalThis.chrome.runtime as { id?: string };
let abortInstance: (() => void) | null = null;

async function loadInstance() {
  vi.resetModules();
  const viewer = await import("../src/content/viewer.js");
  const { S } = await import("../src/content/state.js");
  const { abortContentListeners } = await import("../src/content/lifecycle.js");
  abortInstance = abortContentListeners;
  S.siteDisabled = false;
  S.viewerAutoEnabled = true;
  return { ...viewer, teardown: abortContentListeners };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// A player-sized wrapper the viewer lifts into the top layer; jsdom has no
// Popover API, so it gets the part the viewer uses.
function liftablePlayer() {
  const wrap = document.createElement("div");
  const v = document.createElement("video");
  const rect = { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 } as DOMRect;
  v.getBoundingClientRect = () => rect;
  wrap.getBoundingClientRect = () => rect;
  let open = false;
  const matches = wrap.matches.bind(wrap);
  wrap.matches = (selector: string) => (selector === ":popover-open" ? open : matches(selector));
  Object.assign(wrap, {
    showPopover: () => {
      open = true;
    },
    hidePopover: () => {
      open = false;
    },
  });
  wrap.append(v);
  document.body.append(wrap);
  return { wrap, v, open: () => open };
}

afterEach(() => {
  abortInstance?.();
  abortInstance = null;
  runtime.id = "mock";
  h.primary = null;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-vtp-viewer");
  document.documentElement.style.overflow = "";
});

describe("viewer across an extension update", () => {
  it("hands the page back at once on teardown and never reopens", async () => {
    const { toggleViewer, viewerFormat, teardown } = await loadInstance();
    const player = liftablePlayer();
    h.primary = player.v;
    const root = document.documentElement;
    root.style.overflow = "auto"; // the page's own
    toggleViewer("theater");
    await flush();
    expect(viewerFormat()).toBe("theater");
    expect(player.open()).toBe(true);
    expect(root.style.overflow).toBe("hidden");

    runtime.id = undefined; // the update invalidated this instance's context…
    teardown(); // …and its teardown ran

    // Synchronously: nothing of this instance would be left to finish a transition.
    expect(viewerFormat()).toBeNull();
    expect(player.open()).toBe(false);
    expect(player.wrap.hasAttribute("popover")).toBe(false);
    expect(document.querySelector("[data-vtp-viewer-overlay]")).toBeNull();
    expect(root.hasAttribute("data-vtp-viewer")).toBe(false);
    expect(root.style.overflow).toBe("auto");

    toggleViewer("theater");
    await flush();
    expect(viewerFormat()).toBeNull();
    expect(player.open()).toBe(false);
  });

  it("strips a viewer an old instance left behind, letting a live one close it first", async () => {
    const root = document.documentElement;
    root.setAttribute("data-vtp-viewer", "theater");
    root.style.overflow = "hidden";
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    const oldClose = vi.fn();
    // The old instance's "a press on the dim closes" handler.
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) oldClose();
    });
    const player = document.createElement("div");
    player.setAttribute("popover", "manual");
    player.setAttribute("data-vtp-viewer-player", "");
    player.setAttribute("data-vtp-viewer-player-format", "theater");
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-vtp-viewer-player-stretch", "");
    const video = document.createElement("video");
    video.setAttribute("data-vtp-viewer-player-video", "");
    wrapper.append(video);
    player.append(wrapper);
    const dialog = document.createElement("div");
    dialog.setAttribute("popover", "manual");
    dialog.setAttribute("data-vtp-viewer-dialog", "");
    const style = document.createElement("style");
    style.setAttribute("data-vtp-viewer-player-style", "");
    document.head.append(style);
    document.body.append(player, dialog, overlay);

    await loadInstance();

    expect(oldClose).toHaveBeenCalledTimes(1);
    expect(overlay.isConnected).toBe(false);
    expect(style.isConnected).toBe(false);
    expect(root.hasAttribute("data-vtp-viewer")).toBe(false);
    expect(root.style.overflow).toBe("");
    expect(player.hasAttribute("popover")).toBe(false);
    expect(player.hasAttribute("data-vtp-viewer-player")).toBe(false);
    expect(player.hasAttribute("data-vtp-viewer-player-format")).toBe(false);
    expect(dialog.hasAttribute("popover")).toBe(false);
    expect(dialog.hasAttribute("data-vtp-viewer-dialog")).toBe(false);
    expect(wrapper.hasAttribute("data-vtp-viewer-player-stretch")).toBe(false);
    expect(video.hasAttribute("data-vtp-viewer-player-video")).toBe(false);
  });

  it("keeps the page overflow a still-live old instance restored while closing", async () => {
    const root = document.documentElement;
    root.setAttribute("data-vtp-viewer", "normal");
    root.style.overflow = "hidden";
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    overlay.addEventListener("pointerdown", () => {
      root.style.overflow = "scroll";
      root.removeAttribute("data-vtp-viewer");
    });
    document.body.append(overlay);

    await loadInstance();

    expect(root.style.overflow).toBe("scroll");
  });
});
