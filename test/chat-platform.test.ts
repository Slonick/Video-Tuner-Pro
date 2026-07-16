// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { chatPlatform, sideChatUrl } from "../src/content/chat/platform.js";

let visit = 0;
function at(hostname: string, pathname: string, search = ""): void {
  visit++;
  const uniqueSearch = `${search}${search ? "&" : "?"}vtp-test=${visit}`;
  vi.stubGlobal("location", {
    hostname,
    pathname,
    search: uniqueSearch,
    href: `https://${hostname}${pathname}${uniqueSearch}`,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("chatPlatform", () => {
  it("detects the three supported platforms, with subdomains", () => {
    expect(chatPlatform("www.twitch.tv")).toBe("twitch");
    expect(chatPlatform("twitch.tv")).toBe("twitch");
    expect(chatPlatform("kick.com")).toBe("kick");
    expect(chatPlatform("www.youtube.com")).toBe("youtube");
    expect(chatPlatform("m.youtube.com")).toBe("youtube");
  });

  it("rejects everything else, including lookalike hosts", () => {
    expect(chatPlatform("vkvideo.ru")).toBeNull();
    expect(chatPlatform("w.tv")).toBeNull();
    expect(chatPlatform("nottwitch.tv")).toBeNull();
    expect(chatPlatform("kick.com.evil.example")).toBeNull();
  });
});

describe("sideChatUrl", () => {
  it("builds the Twitch popout URL from the lower-cased login", () => {
    at("www.twitch.tv", "/XQC");
    expect(sideChatUrl()).toBe("https://www.twitch.tv/popout/xqc/chat?darkpopout");
  });

  it("returns null on Twitch reserved routes and bare VOD pages", () => {
    at("www.twitch.tv", "/directory/gaming");
    expect(sideChatUrl()).toBeNull();
    at("www.twitch.tv", "/videos/123456");
    expect(sideChatUrl()).toBeNull();
  });

  it("builds the Kick popout URL", () => {
    at("kick.com", "/trainwreckstv");
    expect(sideChatUrl()).toBe("https://kick.com/popout/trainwreckstv/chat");
  });

  it("builds the YouTube live_chat URL from ?v= and /live/<id>", () => {
    at("www.youtube.com", "/watch", "?v=KYnjhnYNdsk");
    expect(sideChatUrl()).toBe("https://www.youtube.com/live_chat?is_popout=1&v=KYnjhnYNdsk");
    at("www.youtube.com", "/live/KYnjhnYNdsk");
    expect(sideChatUrl()).toBe("https://www.youtube.com/live_chat?is_popout=1&v=KYnjhnYNdsk");
  });

  it("returns null on a YouTube page without a video id", () => {
    at("www.youtube.com", "/feed/subscriptions");
    expect(sideChatUrl()).toBeNull();
  });

  it("returns null on unsupported hosts", () => {
    at("vkvideo.ru", "/somechannel");
    expect(sideChatUrl()).toBeNull();
  });
});

describe("sideChatUrl — YouTube channel-live fallback", () => {
  it("reads the id from ytd-watch-flexy when the URL carries none", () => {
    at("www.youtube.com", "/@LofiGirl/live");
    document.body.innerHTML = `<ytd-watch-flexy video-id="VAlMDl00mYY"></ytd-watch-flexy>`;
    expect(sideChatUrl()).toBe("https://www.youtube.com/live_chat?is_popout=1&v=VAlMDl00mYY");
  });
});
