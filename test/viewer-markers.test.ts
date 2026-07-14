// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  primary: null as unknown,
  chapters: [
    { start: 0, title: "" },
    { start: 40, title: "Middle" },
  ],
}));

vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => h.primary,
  collectVideos: () => (h.primary ? [h.primary as HTMLVideoElement] : []),
  isDrmVideo: () => false,
}));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));
vi.mock("../src/content/markers.js", () => ({
  isYouTube: () => true,
  youTubeVideoId: () => "abc",
  hasNativeSponsorBlock: () => false,
  SPONSOR_COLORS: { sponsor: "#00d400" },
  readYouTubeChapters: () => h.chapters,
  fetchSponsorSegments: vi.fn().mockResolvedValue([{ start: 10, end: 20, category: "sponsor" }]),
}));

import { S } from "../src/content/state.js";
import { toggleViewer, exitViewer } from "../src/content/viewer.js";

function makeVideo(duration = 100) {
  const wrap = document.createElement("div");
  const v = document.createElement("video");
  Object.defineProperty(v, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(v, "videoHeight", { value: 720, configurable: true });
  Object.defineProperty(v, "duration", { value: duration, configurable: true });
  Object.defineProperty(v, "paused", { value: false, configurable: true });
  let ct = 0;
  Object.defineProperty(v, "currentTime", {
    get: () => ct,
    set: (x: number) => (ct = x),
    configurable: true,
  });
  v.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }) as DOMRect;
  wrap.appendChild(v);
  document.body.appendChild(wrap);
  return v;
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const overlayEl = () => document.querySelector("[data-vtp-viewer-overlay]") as HTMLElement | null;
const shadowRoot = () =>
  (
    Array.from(overlayEl()?.children ?? []).find((c) => (c as HTMLElement).shadowRoot) as
      | HTMLElement
      | undefined
  )?.shadowRoot ?? null;

beforeEach(() => {
  exitViewer();
  document.body.innerHTML = "";
  h.primary = null;
  h.chapters = [
    { start: 0, title: "" },
    { start: 40, title: "Middle" },
  ];
  S.sponsorMarks = true;
});

describe("viewer marker hover", () => {
  it("highlights SponsorBlock and YouTube chapter ranges with a tooltip", async () => {
    h.primary = makeVideo();
    toggleViewer("normal");
    await flush();

    const root = shadowRoot()!;
    const seekWrap = root.querySelector(".seekwrap") as HTMLElement;
    seekWrap.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 500, height: 16, right: 600, bottom: 16 }) as DOMRect;

    seekWrap.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 175, clientY: 8, bubbles: true }),
    );
    expect(root.querySelector(".mark-seg")?.classList.contains("active")).toBe(true);
    expect(root.querySelector(".mark-tip")?.textContent).toBe("Sponsor");

    seekWrap.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 350, clientY: 8, bubbles: true }),
    );
    expect(root.querySelector(".mark-chapter.active")).toBeTruthy();
    expect(root.querySelector(".mark-tip")?.textContent).toBe("Middle");
  });

  it("still highlights YouTube chapter ranges when chapter titles are unavailable", async () => {
    h.primary = makeVideo();
    toggleViewer("normal");
    await flush();

    const root = shadowRoot()!;
    const seekWrap = root.querySelector(".seekwrap") as HTMLElement;
    seekWrap.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 500, height: 16, right: 600, bottom: 16 }) as DOMRect;

    seekWrap.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 125, clientY: 8, bubbles: true }),
    );
    expect(root.querySelector(".mark-chapter.active")).toBeTruthy();
    expect(root.querySelector(".mark-tip")?.textContent).toBe("Chapter 1");
  });

  it("reuses the seek bar rect while hovering across markers", async () => {
    h.primary = makeVideo();
    toggleViewer("normal");
    await flush();

    const root = shadowRoot()!;
    const seekWrap = root.querySelector(".seekwrap") as HTMLElement;
    const measure = vi.fn(
      () => ({ left: 100, top: 0, width: 500, height: 16, right: 600, bottom: 16 }) as DOMRect,
    );
    seekWrap.getBoundingClientRect = measure;

    seekWrap.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 175, clientY: 8, bubbles: true }),
    );
    seekWrap.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 350, clientY: 8, bubbles: true }),
    );

    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("shows marker tooltips from keyboard seek focus and input", async () => {
    h.primary = makeVideo();
    toggleViewer("normal");
    await flush();

    const root = shadowRoot()!;
    const seekWrap = root.querySelector(".seekwrap") as HTMLElement;
    const seek = root.querySelector(".seek") as HTMLInputElement;
    seekWrap.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 500, height: 16, right: 600, bottom: 16 }) as DOMRect;

    seek.focus();
    seek.value = "150";
    seek.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.querySelector(".mark-seg")?.classList.contains("active")).toBe(true);
    expect(root.querySelector(".mark-tip")?.classList.contains("show")).toBe(true);
    expect(root.querySelector(".mark-tip")?.textContent).toBe("Sponsor");

    seek.blur();
    expect(root.querySelector(".mark-tip")?.classList.contains("show")).toBe(false);
  });
});
