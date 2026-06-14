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
    document.body.innerHTML =
      `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBe("@WGC098");
  });

  it("reads the /channel/UC… id when there's no handle", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML =
      `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/channel/UCabc_123">Name</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBe("channel/UCabc_123");
  });

  it("prefers the stable id (and exposes both) when the owner has handle + id links", () => {
    // Real YouTube: the owner section carries a /@handle link AND a /channel/UC…
    // link. The key must be deterministic (was flipping with DOM order), so the
    // id wins — but both forms are returned so a speed saved under either matches.
    at("www.youtube.com", "/watch");
    document.body.innerHTML =
      `<ytd-video-owner-renderer>
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

  it("is null off YouTube", () => {
    at("www.twitch.tv", "/watch");
    document.body.innerHTML =
      `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBeNull();
  });

  it("is null off a /watch page (home, channel page, search…)", () => {
    at("www.youtube.com", "/results");
    document.body.innerHTML =
      `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(currentChannel()).toBeNull();
  });

  it("is null before the owner link has rendered", () => {
    at("www.youtube.com", "/watch");
    expect(currentChannel()).toBeNull();
  });
});

describe("currentChannelName (display name for the header)", () => {
  it("returns the channel's display name", () => {
    document.body.innerHTML =
      `<ytd-video-owner-renderer><ytd-channel-name><a href="/@WGC098">WGC</a></ytd-channel-name></ytd-video-owner-renderer>`;
    expect(currentChannelName()).toBe("WGC");
  });

  it("skips a candidate that is just the @handle", () => {
    document.body.innerHTML =
      `<ytd-video-owner-renderer><ytd-channel-name><a href="/@WGC098">@WGC098</a></ytd-channel-name></ytd-video-owner-renderer>`;
    expect(currentChannelName()).toBe("");
  });

  it("returns an empty string when no owner section is present", () => {
    expect(currentChannelName()).toBe("");
  });
});
