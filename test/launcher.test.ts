// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// The on-video launcher: a draggable button over the video that opens the popup
// as an in-page overlay (an iframe). updateLauncher mounts/positions it by mode
// ("off"/"fullscreen"/"always"); a click without a drag toggles the iframe.
const h = vi.hoisted(() => ({ primary: null as unknown, drm: false }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => h.primary,
  isDrmVideo: () => h.drm,
}));
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
import { STORE } from "../src/content/platform/storage.js";
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

function fakeNativeVideo(rect: Partial<DOMRect> = {}) {
  const el = document.createElement("video");
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
  Object.defineProperty(el, "requestPictureInPicture", {
    value: vi.fn().mockResolvedValue({}),
    configurable: true,
  });
  return el;
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

function key(el: EventTarget, key: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};

beforeEach(() => {
  host()?.remove();
  h.primary = null;
  h.drm = false;
  v.format = null;
  v.anchor = null;
  v.paused = false;
  vi.clearAllMocks();
  S.overlayButton = "fullscreen";
  S.viewerAutoEnabled = true;
  S.overlayBtnPos = null;
  S.overlayPanelPos = null;
  STORE.set({ overlayBtnPos: {}, overlayPanelPos: {} });
  Object.defineProperty(document, "pictureInPictureEnabled", { value: false, configurable: true });
  Object.defineProperty(document, "pictureInPictureElement", { value: null, configurable: true });
  Object.defineProperty(document, "exitPictureInPicture", {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });
  // jsdom has no fullscreen — force the property the launcher reads.
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  Object.defineProperty(document, "webkitFullscreenElement", { value: null, configurable: true });
});

function enterFullscreen(el: Element | null = document.body) {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

function enterWebkitFullscreen(el: Element | null = document.body) {
  Object.defineProperty(document, "webkitFullscreenElement", { value: el, configurable: true });
}

describe("updateLauncher — eligibility", () => {
  it("registers global FAB drag fallbacks only once across remounts", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    S.overlayButton = "always";
    h.primary = fakeVideo();

    updateLauncher();
    host()?.remove();
    updateLauncher();

    expect(docAdd.mock.calls.filter(([type]) => type === "pointerup")).toHaveLength(1);
    expect(docAdd.mock.calls.filter(([type]) => type === "pointercancel")).toHaveLength(1);
    expect(winAdd.mock.calls.filter(([type]) => type === "pointerup")).toHaveLength(1);
    expect(winAdd.mock.calls.filter(([type]) => type === "pointercancel")).toHaveLength(1);
    expect(winAdd.mock.calls.filter(([type]) => type === "blur")).toHaveLength(1);
    docAdd.mockRestore();
    winAdd.mockRestore();
  });

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

  it("mounts and positions in fullscreen mode once prefixed fullscreen", () => {
    h.primary = fakeVideo();
    enterWebkitFullscreen();
    updateLauncher();
    expect(fabEl()).not.toBeNull();
  });

  it("mounts in always mode while windowed", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    expect(fabEl()).not.toBeNull();
  });

  it("keeps launcher controls in a top-level stacking context above Viewer", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();

    const launcher = host() as HTMLElement;
    expect(launcher.style.position).toBe("fixed");
    expect(launcher.style.zIndex).toBe("2147483647");
    expect(launcher.style.width).toBe("0px");
    expect(launcher.style.height).toBe("0px");
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

  it("removes current-version stale hosts without a repeated document-wide sweep", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    host()?.remove();

    const stale = document.createElement("div");
    stale.id = "vtp-launcher-host";
    stale.setAttribute("data-vtp-launcher", "");
    document.body.append(stale);
    const query = vi.spyOn(document, "querySelectorAll");

    updateLauncher();

    expect(host()).not.toBe(stale);
    expect(query).not.toHaveBeenCalledWith("[data-vtp-launcher]");
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

  it("clamps a saved button position inside the video frame", () => {
    S.overlayButton = "always";
    S.overlayBtnPos = { fx: 1, fy: 1 };
    h.primary = fakeVideo({ left: 20, top: 30, width: 640, height: 360, right: 660, bottom: 390 });
    updateLauncher();
    const fab = fabEl()!;
    fab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 44, height: 44, right: 44, bottom: 44 }) as DOMRect;

    updateLauncher();

    expect(fab.style.left).toBe("616px");
    expect(fab.style.top).toBe("346px");
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

  it("uses the viewer anchor as soon as it exists during the viewer animation", () => {
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
    expect(fab.style.left).toBe("840px");
    expect(fab.style.top).toBe("253px");

    v.paused = false;
    updateLauncher();
    expect(fab.style.left).toBe("840px");
    expect(fab.style.top).toBe("253px");
  });
});

describe("launcher — open / close", () => {
  it("starts hidden, reveals on mousemove over the video", async () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    expect(fabShown()).toBe(false);
    fire(document, "mousemove", 100, 100);
    await frame();
    expect(fabShown()).toBe(true);
  });

  it("self-heals its position on hover when the video moves with no other trigger", async () => {
    // A site player can resize/relayout its video for reasons we have no hook
    // into (an ad, a quality switch, its own transition) — nothing calls
    // updateLauncher() again on its own. Hovering the video is the one moment
    // we're guaranteed a chance to notice and correct a stale position.
    S.overlayButton = "always";
    const video = fakeVideo();
    h.primary = video;
    updateLauncher();
    fire(document, "mousemove", 100, 100);
    await frame();
    const fab = fabEl()!;
    expect(fab.style.left).toBe("580px"); // right-aligned default for a 640×360 box at (0,0)
    video.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 400, height: 225, right: 500, bottom: 275 }) as DOMRect;
    // No resize/viewer-layout event, no re-mount — only a hover.
    fire(document, "mousemove", 300, 250);
    await frame();
    expect(fab.style.left).toBe("440px");
    expect(fab.style.top).toBe("141px");
  });

  it("coalesces mousemove hover checks into one animation frame", async () => {
    S.overlayButton = "always";
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
    h.primary = { getBoundingClientRect: readRect } as unknown as HTMLVideoElement;
    updateLauncher();
    readRect.mockClear();

    fire(document, "mousemove", 100, 100);
    fire(document, "mousemove", 101, 101);

    expect(readRect).not.toHaveBeenCalled();
    await frame();
    expect(readRect).toHaveBeenCalledTimes(2);
  });

  it("opens the popup iframe on a click (no drag) and closes on backdrop click", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    expect(frameEl()).toBeNull();
    expect(fab.getAttribute("aria-label")).toBe("Open Video Tuner");
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointerup", 580, 158);
    const frame = frameEl();
    expect(frame).not.toBeNull();
    expect(fab.getAttribute("aria-label")).toBe("Close Video Tuner");
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
    expect(fab.getAttribute("aria-label")).toBe("Open Video Tuner");
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

  it("finishes a drag on document pointerup if the FAB lost pointer capture", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointermove", 100, 100);
    fire(document, "pointerup", 100, 100);
    const leftAfterDrop = fab.style.left;
    fire(fab, "pointermove", 200, 200);

    expect(frameEl()?.style.display ?? "none").not.toBe("block");
    expect(S.overlayBtnPos).not.toBeNull();
    expect(fab.style.left).toBe(leftAfterDrop);
  });

  it("cancels a drag on window blur without saving the transient position", () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointermove", 100, 100);
    window.dispatchEvent(new Event("blur"));
    const leftAfterBlur = fab.style.left;
    fire(fab, "pointermove", 200, 200);

    expect(frameEl()?.style.display ?? "none").not.toBe("block");
    expect(S.overlayBtnPos).toBeNull();
    expect(fab.style.left).toBe(leftAfterBlur);
  });

  it("does not mutate the previous button-position map while saving a drag", () => {
    const map = { other: { fx: 0.1, fy: 0.2 } };
    STORE.set({ overlayBtnPos: map });
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;

    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointermove", 100, 100);
    fire(fab, "pointerup", 100, 100);

    expect(map).toEqual({ other: { fx: 0.1, fy: 0.2 } });
    expect(get(["overlayBtnPos"]).overlayBtnPos).toMatchObject({ other: { fx: 0.1, fy: 0.2 } });
  });

  it("a double-click clears the last saved button position", () => {
    STORE.set({ overlayBtnPos: { localhost: { fx: 0.5, fy: 0.5 } } });
    S.overlayButton = "always";
    S.overlayBtnPos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateLauncher();

    fire(fabEl()!, "dblclick", 320, 180);

    expect(S.overlayBtnPos).toBeNull();
    expect(get(["overlayBtnPos"]).overlayBtnPos).toBeUndefined();
  });

  it("a panel reset clears the last saved panel position", () => {
    STORE.set({ overlayPanelPos: { localhost: { fx: 0.5, fy: 0.5 } } });
    S.overlayButton = "always";
    S.overlayPanelPos = { fx: 0.5, fy: 0.5 };
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;
    fire(fab, "pointerdown", 580, 158);
    fire(fab, "pointerup", 580, 158);
    const frame = frameEl()!;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "vtp-overlay", drag: "reset" },
        source: frame.contentWindow,
      }),
    );

    expect(S.overlayPanelPos).toBeNull();
    expect(get(["overlayPanelPos"]).overlayPanelPos).toBeUndefined();
  });
});

describe("launcher — radial viewer menu", () => {
  // The radial items follow the FAB in the shadow root: theater, viewer, PiP, exit.
  const items = () =>
    Array.from(host()?.shadowRoot?.querySelectorAll("button") ?? []).slice(
      1,
    ) as HTMLButtonElement[];
  const shown = (b: HTMLButtonElement) => b.style.opacity === "1";

  async function openMenu(video: HTMLVideoElement = fakeVideo()) {
    S.overlayButton = "always";
    h.primary = video;
    updateLauncher();
    fire(fabEl()!, "mouseenter");
    await frame();
  }

  it("hovering the FAB reveals both formats; exit stays hidden while closed", async () => {
    await openMenu();
    const [theater, normal, pip, exit] = items();
    expect(shown(normal)).toBe(true);
    expect(shown(theater)).toBe(true);
    expect(shown(pip)).toBe(false);
    expect(exit.style.display).toBe("none");
  });

  it("keeps fanning radial items click-through until they leave the FAB", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, "pictureInPictureEnabled", {
        value: true,
        configurable: true,
      });
      S.overlayButton = "always";
      h.primary = fakeNativeVideo();
      updateLauncher();
      fire(fabEl()!, "mouseenter");

      await vi.advanceTimersByTimeAsync(20);
      const [, , pip] = items();
      expect(pip.style.opacity).toBe("1");
      expect(pip.style.pointerEvents).toBe("none");

      await vi.advanceTimersByTimeAsync(230);
      expect(pip.style.pointerEvents).toBe("auto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens and navigates the radial menu from the keyboard", async () => {
    S.overlayButton = "always";
    h.primary = fakeVideo();
    updateLauncher();
    const fab = fabEl()!;

    expect(fab.getAttribute("aria-haspopup")).toBe("menu");
    expect(fab.getAttribute("aria-expanded")).toBe("false");
    key(fab, "ArrowLeft");
    await frame();

    const [theater, normal] = items();
    expect(shown(theater)).toBe(true);
    expect(shown(normal)).toBe(true);
    expect(fab.getAttribute("aria-expanded")).toBe("true");
    expect(fab.getAttribute("data-popup-open")).toBe("false");
    expect(host()?.shadowRoot?.activeElement).toBe(normal);

    key(normal, "ArrowDown");
    expect(host()?.shadowRoot?.activeElement).toBe(theater);

    key(theater, "Escape");
    expect(fab.getAttribute("aria-expanded")).toBe("false");
    expect(host()?.shadowRoot?.activeElement).toBe(fab);
  });

  it("hides radial viewer actions when viewer modes are disabled", async () => {
    S.viewerAutoEnabled = false;
    await openMenu();
    expect(items().some(shown)).toBe(false);
  });

  it("hides viewer format actions on protected video", async () => {
    h.drm = true;
    await openMenu();
    const [theater, normal, pip, exit] = items();
    expect(shown(normal)).toBe(false);
    expect(shown(theater)).toBe(false);
    expect(shown(pip)).toBe(false);
    expect(exit.style.display).toBe("none");
  });

  it("offers native Picture in Picture only when the video supports it", async () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    const video = fakeNativeVideo();
    await openMenu(video);
    const [, , pip] = items();
    expect(shown(pip)).toBe(true);
    pip.click();
    expect(video.requestPictureInPicture).toHaveBeenCalled();
  });

  it("keeps the PiP pressed state in sync with native PiP events", async () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    const video = fakeNativeVideo();
    await openMenu(video);
    const [, , pip] = items();

    Object.defineProperty(document, "pictureInPictureElement", {
      value: video,
      configurable: true,
    });
    document.dispatchEvent(new Event("enterpictureinpicture"));
    expect(pip.getAttribute("aria-pressed")).toBe("true");

    Object.defineProperty(document, "pictureInPictureElement", { value: null, configurable: true });
    document.dispatchEvent(new Event("leavepictureinpicture"));
    expect(pip.getAttribute("aria-pressed")).toBe("false");
  });

  it("exits native PiP instead of requesting it again when the source is already active", async () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    const video = fakeNativeVideo();
    await openMenu(video);
    const [, , pip] = items();
    Object.defineProperty(document, "pictureInPictureElement", {
      value: video,
      configurable: true,
    });

    pip.click();

    expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
  });

  it("does not offer native PiP when the site disabled it on the video", async () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    const video = fakeNativeVideo();
    Object.defineProperty(video, "disablePictureInPicture", { value: true, configurable: true });

    await openMenu(video);

    const [, , pip] = items();
    expect(shown(pip)).toBe(false);
  });

  it("animates radial items out from the FAB", async () => {
    await openMenu();
    const [normal] = items();
    const fannedLeft = normal.style.left;
    const fannedTop = normal.style.top;
    expect(normal.style.transform).toBe("scale(1)");
    fire(document.body, "pointerdown", 900, 900);
    expect(normal.style.left).toBe(fannedLeft);
    expect(normal.style.top).toBe(fannedTop);
    await frame();
    expect(normal.style.transform).toBe("scale(0.72)");
    expect(normal.style.opacity).toBe("0");
  });

  it("keeps radial items visible until the close animation finishes", async () => {
    await openMenu();
    const [normal] = items();
    vi.useFakeTimers();
    try {
      fire(document.body, "pointerdown", 900, 900);
      expect(normal.style.opacity).toBe("1");
      expect(normal.style.visibility).toBe("visible");
      await vi.advanceTimersByTimeAsync(16);
      expect(normal.style.opacity).toBe("0");
      expect(normal.style.transform).toBe("scale(0.72)");
      expect(normal.style.visibility).toBe("visible");
      await vi.advanceTimersByTimeAsync(240);
      expect(normal.style.visibility).toBe("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hide radial items before the close animation frame starts", async () => {
    await openMenu();
    const [normal] = items();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.useFakeTimers();
    try {
      fire(document.body, "pointerdown", 900, 900);
      await vi.advanceTimersByTimeAsync(500);
      expect(normal.style.opacity).toBe("1");
      expect(normal.style.visibility).toBe("visible");
    } finally {
      vi.useRealTimers();
      raf.mockRestore();
    }
  });

  it("starts the close animation from the fanned position without per-item layout reads", async () => {
    await openMenu();
    const [normal] = items();
    const readRect = vi.fn(
      () => ({ left: 0, top: 0, width: 36, height: 36, right: 36, bottom: 36 }) as DOMRect,
    );
    normal.getBoundingClientRect = readRect;

    fire(document.body, "pointerdown", 900, 900);

    expect(readRect).not.toHaveBeenCalled();
    expect(normal.style.opacity).toBe("1");
    expect(normal.style.transform).toBe("scale(1)");
    await frame();
    expect(normal.style.opacity).toBe("0");
    expect(normal.style.transform).toBe("scale(0.72)");
  });

  it("keeps open items at their fanned position when the menu refreshes", async () => {
    await openMenu();
    const [normal] = items();
    const left = normal.style.left;
    const top = normal.style.top;
    fire(normal, "mouseenter");
    expect(normal.style.left).toBe(left);
    expect(normal.style.top).toBe(top);
    expect(normal.style.transform).toBe("scale(1)");
  });

  it("closes an idle radial menu even while the pointer moves inside it", async () => {
    vi.useFakeTimers();
    try {
      S.overlayButton = "always";
      h.primary = fakeVideo();
      updateLauncher();
      fire(fabEl()!, "mouseenter");
      await vi.advanceTimersByTimeAsync(16);
      const [theater] = items();
      for (let i = 0; i < 6; i++) {
        fire(theater, "pointermove", 580, 158);
        await vi.advanceTimersByTimeAsync(500);
      }
      await vi.advanceTimersByTimeAsync(200);
      expect(items().some(shown)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not extend the radial idle timeout when launcher refreshes it", async () => {
    vi.useFakeTimers();
    try {
      S.overlayButton = "always";
      h.primary = fakeVideo();
      updateLauncher();
      fire(fabEl()!, "mouseenter");
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(1600);
      updateLauncher();
      await vi.advanceTimersByTimeAsync(1200);
      expect(items().some(shown)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("while the viewer is open the exit action replaces the active format slot", async () => {
    v.format = "theater";
    await openMenu();
    const [theater, normal, , exit] = items();
    expect(exit.style.display).toBe("flex");
    expect(shown(exit)).toBe(true);
    expect(shown(theater)).toBe(false);
    expect(normal.getAttribute("aria-pressed")).toBe("false");
    expect(exit.style.top).toBe(theater.style.top);
    expect(exit.style.left).toBe(theater.style.left);
  });

  it("the visible items act on the viewer: alternate format toggles, exit closes", async () => {
    v.format = "normal";
    await openMenu();
    const [theater, normal, , exit] = items();
    expect(shown(normal)).toBe(false);
    theater.click();
    expect(v.toggleViewer).toHaveBeenCalledWith("theater");
    exit.click();
    expect(v.exitViewer).toHaveBeenCalled();
  });

  it("fans actions in theater, viewer, PiP order", async () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    await openMenu(fakeNativeVideo());
    const [theater, viewer, pip] = items();
    expect(parseFloat(viewer.style.top)).toBeGreaterThan(parseFloat(theater.style.top));
    expect(parseFloat(pip.style.top)).toBeGreaterThan(parseFloat(viewer.style.top));
    expect(parseFloat(viewer.style.left)).toBeLessThan(parseFloat(theater.style.left));
    expect(parseFloat(viewer.style.left)).toBeLessThan(parseFloat(pip.style.left));
  });

  it("leaving the FAB closes the menu after the grace period", async () => {
    await openMenu();
    vi.useFakeTimers();
    fire(fabEl()!, "mouseleave");
    vi.advanceTimersByTime(400);
    expect(items().some(shown)).toBe(false);
    vi.useRealTimers();
  });

  it("hopping from the FAB onto an item keeps the menu open", async () => {
    await openMenu();
    vi.useFakeTimers();
    const [normal] = items();
    fire(fabEl()!, "mouseleave");
    fire(normal, "mouseenter");
    vi.advanceTimersByTime(400);
    expect(shown(normal)).toBe(true);
    vi.useRealTimers();
  });

  it("moving outside closes the menu even if mouseleave was missed", async () => {
    await openMenu();
    vi.useFakeTimers();
    fire(document, "pointermove", 900, 900);
    vi.advanceTimersByTime(400);
    expect(items().some(shown)).toBe(false);
    vi.useRealTimers();
  });

  it("outside movement does not keep postponing the radial close", async () => {
    await openMenu();
    vi.useFakeTimers();
    fire(document, "pointermove", 900, 900);
    vi.advanceTimersByTime(300);
    fire(document, "pointermove", 901, 901);
    vi.advanceTimersByTime(100);
    expect(items().some(shown)).toBe(false);
    vi.useRealTimers();
  });

  it("clicking outside closes the menu immediately", async () => {
    await openMenu();
    const [normal] = items();
    fire(document.body, "pointerdown", 900, 900);
    expect(normal.style.pointerEvents).toBe("none");
    await frame();
    expect(items().some(shown)).toBe(false);
  });

  it("opening the popup closes the radial menu", async () => {
    await openMenu();
    fire(fabEl()!, "pointerdown", 580, 158);
    fire(fabEl()!, "pointerup", 580, 158);
    expect(frameEl()?.style.display).toBe("block");
    await frame();
    expect(items().some(shown)).toBe(false);
  });

  it("in fullscreen mode the FAB surfaces while the viewer is open, even windowed", async () => {
    v.format = "normal";
    h.primary = fakeVideo();
    updateLauncher(); // overlayButton stays "fullscreen", no fullscreen active
    expect(fabEl()).not.toBeNull();
    fire(document, "mousemove", 100, 100);
    await frame();
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
