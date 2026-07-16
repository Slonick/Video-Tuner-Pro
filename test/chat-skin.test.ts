// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { S } from "../src/content/state.js";
import { initChatFrameSkin, applyChatFrameSkin } from "../src/content/chat/skin.js";

function asOverlayPopout(hostname: string, pathname: string): void {
  Object.defineProperty(window, "top", { value: {}, configurable: true });
  vi.stubGlobal("location", { hostname, pathname, hash: "#vtp-chat-overlay" });
}

const skinStyle = () => document.head.querySelector("style[data-vtp-chat-skin]");

afterEach(() => {
  vi.unstubAllGlobals();
  skinStyle()?.remove();
  S.viewerChatInput = true;
});

describe("initChatFrameSkin", () => {
  it("skins a Twitch popout frame marked with the overlay hash", () => {
    asOverlayPopout("www.twitch.tv", "/popout/somechannel/chat");
    initChatFrameSkin();
    const css = skinStyle()?.textContent ?? "";
    expect(css).toContain("background:transparent!important");
    expect(css).toContain("text-shadow");
    // Input shown by default — no hide rule for it.
    expect(css).not.toContain(".chat-input:not(#vtp-a):not(#vtp-b){display:none");
  });

  it("hides the message input when the setting is off and restores it on apply", () => {
    asOverlayPopout("www.twitch.tv", "/popout/somechannel/chat");
    S.viewerChatInput = false;
    initChatFrameSkin();
    expect(skinStyle()?.textContent).toContain(
      ".chat-input:not(#vtp-a):not(#vtp-b){display:none!important}",
    );

    S.viewerChatInput = true;
    applyChatFrameSkin();
    expect(skinStyle()?.textContent).not.toContain(
      ".chat-input:not(#vtp-a):not(#vtp-b){display:none!important}",
    );
  });

  it("stays dormant without the hash marker, in the top frame, and off-platform", () => {
    // No hash.
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/popout/x/chat", hash: "" });
    initChatFrameSkin();
    expect(skinStyle()).toBeNull();

    // Unsupported platform.
    vi.stubGlobal("location", {
      hostname: "example.com",
      pathname: "/chat",
      hash: "#vtp-chat-overlay",
    });
    initChatFrameSkin();
    expect(skinStyle()).toBeNull();
  });
});
