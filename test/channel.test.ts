// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { currentChannel, channelKeys, currentChannelName } from "../src/content/channel.js";

function at(hostname: string, pathname: string): void {
  vi.stubGlobal("location", { hostname, pathname });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("currentChannel (stable per-channel key)", () => {
  it("reads the @handle from the owner link on a watch page", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBe("@WGC098");
  });

  it("reads the /channel/UC… id when there's no handle", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/channel/UCabc_123">Name</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBe("channel/UCabc_123");
  });

  it("prefers the stable id (and exposes both) when the owner has handle + id links", () => {
    // Real YouTube: the owner section carries a /@handle link AND a /channel/UC…
    // link. The key must be deterministic (was flipping with DOM order), so the
    // id wins — but both forms are returned so a speed saved under either matches.
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/@WGC098">WGC</a>
         <ytd-channel-name><a class="yt-simple-endpoint" href="/channel/UCabc_123">WGC</a></ytd-channel-name>
       </ytd-video-owner-renderer>`;
    expect(currentChannel()).toBe("channel/UCabc_123");
    expect(channelKeys()).toEqual(["channel/UCabc_123", "@WGC098"]);
  });

  it("is empty (no keys) off a watch page", () => {
    at("www.youtube.com", "/results");
    expect(channelKeys()).toEqual([]);
  });

  it("does not read YouTube owner links off YouTube", () => {
    at("www.twitch.tv", "/directory"); // reserved → not a Twitch channel page
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBeNull();
  });

  it("reads the Twitch login from a channel page", () => {
    at("www.twitch.tv", "/Shroud");
    expect(currentChannel()).toBe("twitch:shroud");
    expect(channelKeys()).toEqual(["twitch:shroud"]);
  });

  it("ignores Twitch reserved routes (and a VOD with no channel rendered yet)", () => {
    at("www.twitch.tv", "/directory");
    expect(channelKeys()).toEqual([]);
    at("www.twitch.tv", "/videos/2795588124"); // channel link not in DOM yet
    expect(channelKeys()).toEqual([]);
  });

  it("resolves a Twitch VOD (/videos/<id>) from the channel link in the DOM", () => {
    at("www.twitch.tv", "/videos/2795588124"); // no channel in the URL
    document.body.innerHTML = `<a data-a-target="video-info-channel-name" href="/Inkmate03">Inkmate</a>`;
    expect(currentChannel()).toBe("twitch:inkmate03");
  });

  it("resolves a Twitch VOD from the broadcaster name in h1.tw-title", () => {
    at("www.twitch.tv", "/videos/2795588124");
    document.body.innerHTML = `<h1 class="tw-title">DooMxx</h1>`;
    expect(currentChannel()).toBe("twitch:doomxx");
  });

  it("resolves a Twitch VOD from the broadcaster avatar link as a fallback", () => {
    at("www.twitch.tv", "/videos/2795588124");
    document.body.innerHTML = `<a href="/Inkmate03"><img class="tw-image-avatar" src="x"></a>`;
    expect(currentChannel()).toBe("twitch:inkmate03");
  });

  it("reads the Kick login on live and record pages, ignoring reserved routes", () => {
    at("kick.com", "/xQc");
    expect(currentChannel()).toBe("kick:xqc");
    at("kick.com", "/inkmate03/videos/4592c135"); // record page → first segment
    expect(currentChannel()).toBe("kick:inkmate03");
    at("kick.com", "/browse");
    expect(channelKeys()).toEqual([]);
  });

  it("reads the VK Video Live login on live and deep record/playlist pages", () => {
    at("live.vkvideo.ru", "/Kuplinov");
    expect(currentChannel()).toBe("vkvideo:kuplinov");
    at("live.vkvideo.ru", "/lasqa/playlist/d39213db/video/8ef5ff0f"); // deep VOD path
    expect(currentChannel()).toBe("vkvideo:lasqa");
  });

  it("reads the w.tv login on live and record pages", () => {
    at("w.tv", "/KinoZALL");
    expect(currentChannel()).toBe("w:kinozall");
    at("w.tv", "/kinozall/videos/019ebb10");
    expect(currentChannel()).toBe("w:kinozall");
  });

  it("reads the TikTok login from /@user and /@user/live, requiring the @ prefix", () => {
    at("www.tiktok.com", "/@charli");
    expect(currentChannel()).toBe("tiktok:charli");
    at("www.tiktok.com", "/@charli/live");
    expect(currentChannel()).toBe("tiktok:charli");
    at("www.tiktok.com", "/live"); // directory, not a /@handle
    expect(channelKeys()).toEqual([]);
  });

  it("is null off a /watch page (home, channel page, search…)", () => {
    at("www.youtube.com", "/results");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBeNull();
  });

  it("is null before the owner link has rendered", () => {
    at("www.youtube.com", "/watch");
    expect(currentChannel()).toBeNull();
  });
});

describe("currentChannelName (display name for the header)", () => {
  it("returns the channel's display name", () => {
    document.body.innerHTML = `<ytd-video-owner-renderer><ytd-channel-name><a href="/@WGC098">WGC</a></ytd-channel-name></ytd-video-owner-renderer>`;
    expect(currentChannelName()).toBe("WGC");
  });

  it("skips a candidate that is just the @handle", () => {
    document.body.innerHTML = `<ytd-video-owner-renderer><ytd-channel-name><a href="/@WGC098">@WGC098</a></ytd-channel-name></ytd-video-owner-renderer>`;
    expect(currentChannelName()).toBe("");
  });

  it("returns an empty string when no owner section is present", () => {
    expect(currentChannelName()).toBe("");
  });

  it("reads the Twitch display name, falling back to the login", () => {
    at("www.twitch.tv", "/shroud");
    document.body.innerHTML = `<span data-a-target="user-display-name">Shroud</span>`;
    expect(currentChannelName()).toBe("Shroud");
    document.body.innerHTML = "";
    expect(currentChannelName()).toBe("shroud");
  });

  it("reads the Kick display name, falling back to the login", () => {
    at("kick.com", "/xqc");
    document.body.innerHTML = `<span data-testid="channel-username">xQc</span>`;
    expect(currentChannelName()).toBe("xQc");
    document.body.innerHTML = "";
    expect(currentChannelName()).toBe("xqc");
  });

  it("falls back to the login for sites without a matched name node (TikTok)", () => {
    at("www.tiktok.com", "/@charli/live");
    expect(currentChannelName()).toBe("charli");
  });
});
