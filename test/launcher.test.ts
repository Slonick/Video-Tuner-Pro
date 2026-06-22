// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// The on-video launcher: a draggable button over the video that opens the popup
// as an in-page overlay (an iframe). updateLauncher mounts/positions it by mode
// ("off"/"fullscreen"/"always"); a click without a drag toggles the iframe.
const h = vi.hoisted(() => ({ primary: null as unknown }));
vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => h.primary }));
// runtime.getURL is the only browser API the launcher touches at mount/open time.
vi.mock("../src/content/platform/browser.js", () => ({
  api: { runtime: { getURL: (p: string) => "chrome-extension://test/" + p } },
  ctxValid: () => true,
}));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));

import { S } from "../src/content/state.js";
import { updateLauncher, ownsLauncherNode } from "../src/content/overlay/launcher.js";

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
  return { getBoundingClientRect: () => r } as unknown as HTMLVideoElement;
}

const host = () => document.querySelector("[data-vtp-launcher]");
const fabEl = () =>
  (host()?.shadowRoot?.querySelector("button") as HTMLButtonElement | null) ?? null;
const frameEl = () =>
  (host()?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null) ?? null;
const fabShown = () => {
  const el = fabEl();
  return !!el && el.style.opacity === "1";
};

// MouseEvent carries button/clientX/clientY and fires "pointer*" listeners by type.
function fire(el: EventTarget, type: string, x = 0, y = 0) {
  el.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true }));
}

beforeEach(() => {
  host()?.remove();
  h.primary = null;
  S.overlayButton = "fullscreen";
  S.overlayBtnPos = null;
  // jsdom has no fullscreen — force the property the launcher reads.
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
});

function enterFullscreen(el: Element | null = document.body) {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

describe("updateLauncher — eligibility", () => {
  it("does not mount when disabled", () => {
    S.overlayButton = "off";
    h.primary = fakeVideo();
    updateLauncher();
    expect(host()).toBeNull();
  });

  it("does not mount in fullscreen mode while windowed", () => {
    h.primary = fakeVideo();
    updateLauncher();
    // Mounted lazily only once eligible — windowed + fullscreen mode → not shown.
    expect(fabShown()).toBe(false);
  });

  it("mounts and positions in fullscreen mode once fullscreen", () => {
    h.primary = fakeVideo();
    enterFullscreen();
    updateLauncher();
    expect(fabEl()).not.toBeNull();
  });

  it("mounts in always mode while windowed", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    expect(fabEl()).not.toBeNull();
  });
});

describe("updateLauncher — default position", () => {
  it("sits at the right-center of the video frame", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    // right(640) - size(44) - margin(16) = 580 ; top = (360-44)/2 = 158
    expect(fab.style.left).toBe("580px");
    expect(fab.style.top).toBe("158px");
  });
});

describe("launcher — open / close", () => {
  it("starts hidden, reveals on mousemove over the video", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    expect(fabShown()).toBe(false);
    fire(document, "mousemove", 100, 100);
    expect(fabShown()).toBe(true);
  });

  it("opens the popup iframe on a click (no drag) and closes on backdrop click", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    expect(frameEl()).toBeNull();
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointerup", 580, 158);
    const frame = frameEl();
    expect(frame).not.toBeNull();
    // src carries the host + OS schemes in the hash, so the popup can match the host's
    // color-scheme (transparency) and theme the glass to the OS.
    expect(frame!.src).toMatch(
      /^chrome-extension:\/\/test\/popup\/popup\.html#vtp-(light|dark)-(light|dark)$/,
    );
    expect(frame!.style.display).toBe("block");
    // Outside click (the backdrop) closes it.
    const backdrop = host()!.shadowRoot!.querySelector("div") as HTMLElement;
    fire(backdrop, "pointerdown");
    expect(frameEl()!.style.display).toBe("none");
  });

  it("recreates the iframe on each open so it loads the current popup", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    // Open, close, reopen.
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointerup", 580, 158);
    const first = frameEl()!;
    fire(host()!.shadowRoot!.querySelector("div") as HTMLElement, "pointerdown"); // backdrop → close
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointerup", 580, 158);
    const second = frameEl()!;
    expect(second).not.toBe(first); // fresh element each open
    expect(host()!.shadowRoot!.querySelectorAll("iframe").length).toBe(1); // old one removed
    expect(second.style.display).toBe("block");
    fire(host()!.shadowRoot!.querySelector("div") as HTMLElement, "pointerdown"); // leave closed
  });

  it("a drag repositions the button and persists the fraction instead of opening", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointermove", 100, 100);
    fire(fab, "pointerup", 100, 100);
    expect(frameEl()?.style.display ?? "none").not.toBe("block"); // dragged → not opened
    expect(S.overlayBtnPos).not.toBeNull();
  });
});

describe("ownsLauncherNode", () => {
  it("claims the launcher host, rejects foreign nodes", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    expect(ownsLauncherNode(host())).toBe(true);
    expect(ownsLauncherNode(document.body)).toBe(false);
    expect(ownsLauncherNode(null)).toBe(false);
  });
});
