// @vitest-environment jsdom
// Facade-level tests for the viewer chat controller (chat/index.ts): mode
// reconciliation, the satisfied/retry contract, and teardown. These exercise the
// otherwise indirectly-covered mount paths of panel.ts and side.ts, and lock the
// regression where overlay chat parked a permanent "unavailable" panel when the
// popout URL wasn't buildable yet (YouTube's video id arriving after navigation).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as MapMutation from "../src/shared/map-mutation.js";

const fx = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));
vi.mock("../src/shared/map-mutation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof MapMutation>()),
  mutateStoredMap: fx.mutate,
}));

import { S } from "../src/content/state.js";
import {
  mountViewerChat,
  unmountViewerChat,
  updateViewerChat,
  chatSatisfied,
  setChatMode,
  cycleChatMode,
  chatGutterWidth,
  layoutSideChat,
  layoutChatPanel,
  layoutChatFab,
  applyChatPanelSettings,
  animateChatLayout,
} from "../src/content/chat/index.js";

const panelEl = () => document.querySelector("[data-vtp-viewer-chat-panel]");
const sideEl = () => document.querySelector("[data-vtp-viewer-chat-side]");
const fabEl = () => document.querySelector("[data-vtp-viewer-chat-fab]");
const panelSrc = () => panelEl()?.shadowRoot?.querySelector("iframe")?.getAttribute("src") ?? null;

let overlay: HTMLElement;

function ctx(format: "normal" | "theater" = "theater") {
  return {
    overlay,
    nativeSurface: false,
    liveHint: true,
    format: () => format,
    relayout: () => {},
    relayoutSmooth: () => {},
  };
}

function atTwitchLive(): void {
  vi.stubGlobal("location", {
    hostname: "www.twitch.tv",
    pathname: "/somechannel",
    search: "",
    href: "https://www.twitch.tv/somechannel",
  });
}

function atYouTubeChannelLive(): void {
  vi.stubGlobal("location", {
    hostname: "www.youtube.com",
    pathname: "/@handle/live",
    search: "",
    href: "https://www.youtube.com/@handle/live",
  });
}

beforeEach(() => {
  overlay = document.createElement("div");
  document.body.appendChild(overlay);
  S.viewerChatMode = "off";
  S.viewerChatPanelSites = {};
  S.viewerChatSideWidths = {};
  fx.mutate.mockClear();
});

afterEach(() => {
  unmountViewerChat();
  overlay.remove();
  document.querySelectorAll("ytd-watch-flexy").forEach((n) => n.remove());
  vi.unstubAllGlobals();
});

describe("viewer chat facade", () => {
  it("mounts only the on-video toggle in off mode, and reports satisfied", () => {
    atTwitchLive();
    S.viewerChatMode = "off";
    mountViewerChat(ctx());
    expect(fabEl()).not.toBeNull();
    expect(sideEl()).toBeNull();
    expect(panelEl()).toBeNull();
    expect(chatSatisfied()).toBe(true);
  });

  it("mounts the side column and reserves its gutter in side mode", () => {
    atTwitchLive();
    S.viewerChatMode = "side";
    mountViewerChat(ctx());
    expect(sideEl()).not.toBeNull();
    expect(panelEl()).toBeNull();
    expect(chatGutterWidth("theater")).toBe(340);
    expect(chatSatisfied()).toBe(true);
  });

  it("mounts the floating panel in overlay mode when the popout URL resolves", () => {
    atTwitchLive();
    S.viewerChatMode = "overlay";
    mountViewerChat(ctx());
    expect(panelEl()).not.toBeNull();
    expect(sideEl()).toBeNull();
    expect(chatGutterWidth("theater")).toBe(0);
    expect(panelSrc()).toBe(
      "https://www.twitch.tv/popout/somechannel/chat?darkpopout#vtp-chat-overlay",
    );
    expect(chatSatisfied()).toBe(true);
  });

  it("overlay recovers once a late popout URL becomes buildable (regression)", () => {
    atYouTubeChannelLive(); // channel-live URL carries no video id yet
    S.viewerChatMode = "overlay";
    mountViewerChat(ctx());
    // No id → no panel, and the guard is told to keep retrying.
    expect(panelEl()).toBeNull();
    expect(chatSatisfied()).toBe(false);

    // The watch element (which carries the id) arrives after navigation settles.
    const flexy = document.createElement("ytd-watch-flexy");
    flexy.setAttribute("video-id", "abc123DEF45");
    document.body.appendChild(flexy);

    updateViewerChat(); // a guard tick
    expect(panelEl()).not.toBeNull();
    expect(panelSrc()).toContain("https://www.youtube.com/live_chat?is_popout=1&v=abc123DEF45");
    expect(chatSatisfied()).toBe(true);
  });

  it("switches surfaces and tears them down as the mode changes", () => {
    atTwitchLive();
    mountViewerChat(ctx());

    setChatMode("side");
    expect(sideEl()).not.toBeNull();
    expect(panelEl()).toBeNull();

    // off → side → overlay via the hotkey cycle.
    setChatMode("off");
    expect(cycleChatMode()).toBe("side");
    expect(sideEl()).not.toBeNull();
    expect(cycleChatMode()).toBe("overlay");
    expect(panelEl()).not.toBeNull();
    expect(sideEl()).toBeNull();
    expect(cycleChatMode()).toBe("off");
    expect(panelEl()).toBeNull();
    expect(sideEl()).toBeNull();
    // The toggle stays put across all mode changes.
    expect(fabEl()).not.toBeNull();
  });

  it("stays off (no surfaces, no toggle) on an unsupported host", () => {
    vi.stubGlobal("location", {
      hostname: "example.com",
      pathname: "/",
      search: "",
      href: "https://example.com/",
    });
    S.viewerChatMode = "overlay";
    mountViewerChat(ctx());
    expect(fabEl()).toBeNull();
    expect(panelEl()).toBeNull();
    expect(sideEl()).toBeNull();
    expect(chatSatisfied()).toBe(true); // nothing to satisfy
  });

  it("lays out and restyles the mounted side column without error", () => {
    atTwitchLive();
    S.viewerChatMode = "side";
    mountViewerChat(ctx());
    const col = sideEl() as HTMLElement;

    // Theater docks full-height at the right edge…
    layoutSideChat({ fill: true, width: 400 });
    expect(col.style.width).toBe("400px");
    expect(col.style.borderRadius).toBe("0px");

    // …normal glues it beside the video card with only its outer corners rounded.
    layoutSideChat({ left: 100, top: 20, height: 300, width: 340 });
    expect(col.style.left).toBe("100px");
    expect(col.style.height).toBe("300px");
    expect(col.style.borderRadius).toBe("0 12px 12px 0");

    S.viewerChatOpacity = 0.6;
    applyChatPanelSettings(); // re-derives the side tint from the new opacity
    animateChatLayout(200); // opens a glide window on the surface
    expect(col.style.transition).toContain("width 200ms");
    S.viewerChatOpacity = 0.4;
  });

  it("lays out and restyles the mounted overlay panel without error", () => {
    atTwitchLive();
    S.viewerChatMode = "overlay";
    mountViewerChat(ctx());
    const host = panelEl() as HTMLElement;

    layoutChatFab({ right: 500, top: 40 });
    layoutChatPanel({ left: 60, top: 30, right: 660, bottom: 400, width: 600, height: 370 });

    S.viewerChatWidth = 380;
    S.viewerChatHeight = 300;
    applyChatPanelSettings();
    expect(host.style.width).toBe("380px");
    expect(host.style.height).toBe("300px");
    S.viewerChatWidth = 340;
    S.viewerChatHeight = 420;
  });

  it("removes every surface on unmount", () => {
    atTwitchLive();
    S.viewerChatMode = "side";
    mountViewerChat(ctx());
    expect(sideEl()).not.toBeNull();
    expect(fabEl()).not.toBeNull();

    unmountViewerChat();
    expect(sideEl()).toBeNull();
    expect(panelEl()).toBeNull();
    expect(fabEl()).toBeNull();
  });

  it("reports whether the viewer needs a new layout pass", () => {
    atTwitchLive();
    S.viewerChatMode = "side";
    mountViewerChat(ctx());
    layoutSideChat({ fill: true, width: 340 }); // the viewer's layout pass
    expect(updateViewerChat()).toBe(false); // e.g. the storage echo of our own write

    S.viewerChatSideWidths = { "twitch.tv": { theater: 420 } }; // saved in another tab
    expect(updateViewerChat()).toBe(true);
    layoutSideChat({ fill: true, width: 420 });
    expect(updateViewerChat()).toBe(false);

    S.viewerChatMode = "overlay";
    expect(updateViewerChat()).toBe(true);
    expect(updateViewerChat()).toBe(false);
  });

  it("saves the side width once per real drag, through the background's map write", () => {
    atTwitchLive();
    S.viewerChatMode = "side";
    mountViewerChat(ctx());
    const col = sideEl() as HTMLElement;
    col.getBoundingClientRect = () => ({ width: 340 }) as DOMRect;
    const grip = col.lastElementChild as HTMLElement;
    const fire = (type: string, x: number) =>
      grip.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x }));

    fire("pointerdown", 500);
    fire("pointerup", 500);
    expect(fx.mutate).not.toHaveBeenCalled(); // a plain press

    fire("pointerdown", 500);
    fire("pointermove", 440);
    fire("pointerup", 440);
    expect(fx.mutate).toHaveBeenCalledTimes(1);
    expect(fx.mutate).toHaveBeenCalledWith(
      "viewerChatSideWidths",
      { "twitch.tv": { theater: 400 } },
      [],
    );
    expect(S.viewerChatSideWidths).toEqual({ "twitch.tv": { theater: 400 } });

    // The finished gesture took its cancel handler along: a stray cancel saves nothing.
    fire("pointercancel", 0);
    expect(fx.mutate).toHaveBeenCalledTimes(1);
  });

  it("saves the panel spot once per real drag, through the background's map write", () => {
    atTwitchLive();
    S.viewerChatMode = "overlay";
    mountViewerChat(ctx());
    layoutChatPanel({ left: 60, top: 30, right: 660, bottom: 400, width: 600, height: 370 });
    const head = panelEl()!.shadowRoot!.querySelector<HTMLElement>(".head")!;
    const fire = (type: string, x: number, y: number) =>
      head.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y }));

    fire("pointerdown", 100, 100);
    fire("pointerup", 100, 100);
    expect(fx.mutate).not.toHaveBeenCalled(); // a plain click

    fire("pointerdown", 100, 100);
    fire("pointermove", 140, 120);
    fire("pointerup", 140, 120);
    expect(fx.mutate).toHaveBeenCalledTimes(1);
    const [map, set] = fx.mutate.mock.calls[0];
    expect(map).toBe("viewerChatPanelSites");
    expect(Object.keys(set)).toEqual(["twitch.tv"]);

    fire("pointercancel", 0, 0);
    expect(fx.mutate).toHaveBeenCalledTimes(1);
  });

  it("builds the on-video toggle's icons without innerHTML", () => {
    atTwitchLive();
    const innerHTML = vi.spyOn(Element.prototype, "innerHTML", "set");
    try {
      mountViewerChat(ctx());
      const buttons = fabEl()!.shadowRoot!.querySelectorAll("button");
      expect(buttons).toHaveLength(3);
      for (const b of buttons) expect(b.querySelector("svg")).not.toBeNull();
      expect(innerHTML).not.toHaveBeenCalled();
    } finally {
      innerHTML.mockRestore();
    }
  });
});
