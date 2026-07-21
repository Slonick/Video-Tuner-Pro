// @vitest-environment jsdom
// Facade-level tests for the viewer chat controller (chat/index.ts): mode
// reconciliation, the satisfied/retry contract, and teardown. These exercise the
// otherwise indirectly-covered mount paths of panel.ts and side.ts, and lock the
// regression where overlay chat parked a permanent "unavailable" panel when the
// popout URL wasn't buildable yet (YouTube's video id arriving after navigation).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));

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
});
