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
// The pop-out viewer behind the radial menu — spied so clicks are observable
// and the viewer state is controllable per test.
const v = vi.hoisted(() => ({
  toggleViewer: vi.fn(),
  exitViewer: vi.fn(),
  format: null as string | null,
  anchor: null as unknown,
  paused: false,
}));
vi.mock("../src/content/viewer.js", () => ({
  VIEWER_LAYOUT_EVENT: "vtp-viewer-layout",
  toggleViewer: v.toggleViewer,
  exitViewer: v.exitViewer,
  viewerFormat: () => v.format,
  viewerAnchorVideo: () => v.anchor,
  viewerLayoutPaused: () => v.paused,
}));

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
  v.format = null;
  v.anchor = null;
  v.paused = false;
  vi.clearAllMocks();
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

  it("removes a stale launcher host left by a previous content script", () => {
    S.overlayButton = "always";
    const stale = document.createElement("div");
    stale.setAttribute("data-vtp-launcher", "");
    document.body.append(stale);
    h.primary = fakeVideo();
    updateLauncher();
    const hosts = document.querySelectorAll("[data-vtp-launcher]");
    expect(hosts.length).toBe(1);
    expect(hosts[0]).not.toBe(stale);
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

  it("uses the viewer anchor while the pop-out viewer is open", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    v.anchor = fakeVideo({ left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500 });
    updateLauncher();
    const fab = fabEl()!;
    expect(fab.style.left).toBe("840px"); // anchor right(900) - size(44) - margin(16)
    expect(fab.style.top).toBe("253px"); // anchor top(50) + (450-44)/2
  });

  it("repositions on window resize outside the pop-out viewer", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    updateLauncher();
    h.primary = fakeVideo({ left: 20, top: 30, width: 800, height: 450, right: 820, bottom: 480 });
    window.dispatchEvent(new Event("resize"));
    const fab = fabEl()!;
    expect(fab.style.left).toBe("760px");
    expect(fab.style.top).toBe("233px");
  });

  it("repositions immediately when the viewer anchor changes", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    v.anchor = fakeVideo({ left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500 });
    updateLauncher();
    v.anchor = null;
    document.dispatchEvent(new Event("vtp-viewer-layout"));
    const fab = fabEl()!;
    expect(fab.style.left).toBe("580px");
    expect(fab.style.top).toBe("158px");
  });

  it("keeps the launcher pinned while the viewer layout is animating", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 });
    updateLauncher();
    const fab = fabEl()!;
    expect(fab.style.left).toBe("580px");
    expect(fab.style.top).toBe("158px");

    v.anchor = fakeVideo({
      left: 100,
      top: 50,
      width: 800,
      height: 450,
      right: 900,
      bottom: 500,
    });
    v.paused = true;
    updateLauncher();
    expect(fab.style.left).toBe("580px");
    expect(fab.style.top).toBe("158px");

    v.paused = false;
    updateLauncher();
    expect(fab.style.left).toBe("840px");
    expect(fab.style.top).toBe("253px");
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

describe("launcher — radial viewer menu", () => {
  // The three radial items follow the FAB in the shadow root: normal, theater, exit.
  const items = () =>
    Array.from(host()?.shadowRoot?.querySelectorAll("button") ?? []).slice(
      1,
    ) as HTMLButtonElement[];
  const shown = (b: HTMLButtonElement) => b.style.opacity === "1";

  function openMenu() {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    fire(fabEl()!, "mouseenter");
  }

  it("hovering the FAB reveals both formats; exit stays hidden while closed", () => {
    openMenu();
    const [normal, theater, exit] = items();
    expect(shown(normal)).toBe(true);
    expect(shown(theater)).toBe(true);
    expect(exit.style.display).toBe("none");
  });

  it("while the viewer is open the menu offers exit and marks the active format", () => {
    v.format = "theater";
    openMenu();
    const [normal, theater, exit] = items();
    expect(exit.style.display).toBe("flex");
    expect(shown(exit)).toBe(true);
    expect(theater.getAttribute("aria-pressed")).toBe("true");
    expect(normal.getAttribute("aria-pressed")).toBe("false");
  });

  it("the items act on the viewer: formats toggle, exit closes", () => {
    v.format = "normal";
    openMenu();
    const [normal, theater, exit] = items();
    normal.click();
    expect(v.toggleViewer).toHaveBeenCalledWith("normal");
    theater.click();
    expect(v.toggleViewer).toHaveBeenCalledWith("theater");
    exit.click();
    expect(v.exitViewer).toHaveBeenCalled();
  });

  it("leaving the FAB closes the menu after the grace period", () => {
    vi.useFakeTimers();
    openMenu();
    fire(fabEl()!, "mouseleave");
    vi.advanceTimersByTime(400);
    expect(items().some(shown)).toBe(false);
    vi.useRealTimers();
  });

  it("hopping from the FAB onto an item keeps the menu open", () => {
    vi.useFakeTimers();
    openMenu();
    const [normal] = items();
    fire(fabEl()!, "mouseleave");
    fire(normal, "mouseenter");
    vi.advanceTimersByTime(400);
    expect(shown(normal)).toBe(true);
    vi.useRealTimers();
  });

  it("moving outside closes the menu even if mouseleave was missed", () => {
    vi.useFakeTimers();
    openMenu();
    fire(document, "pointermove", 900, 900);
    vi.advanceTimersByTime(400);
    expect(items().some(shown)).toBe(false);
    vi.useRealTimers();
  });

  it("clicking outside closes the menu immediately", () => {
    openMenu();
    fire(document.body, "pointerdown", 900, 900);
    expect(items().some(shown)).toBe(false);
  });

  it("opening the popup closes the radial menu", () => {
    openMenu();
    fire(fabEl()!, "pointerdown", 580, 158);
    fire(fabEl()!, "pointerup", 580, 158);
    expect(frameEl()?.style.display).toBe("block");
    expect(items().some(shown)).toBe(false);
  });

  it("in fullscreen mode the FAB surfaces while the viewer is open, even windowed", () => {
    v.format = "normal";
    h.primary = fakeVideo();
    updateLauncher(); // overlayButton stays "fullscreen", no fullscreen active
    expect(fabEl()).not.toBeNull();
    fire(document, "mousemove", 100, 100);
    expect(fabShown()).toBe(true);
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
