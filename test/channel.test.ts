// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as Channel from "../src/content/channel.js";

let channelKeys: typeof Channel.channelKeys;
let currentChannelName: typeof Channel.currentChannelName;
let sameChannelIdentity: typeof Channel.sameChannelIdentity;
let sameChannelKeys: typeof Channel.sameChannelKeys;

// A fresh module per test: its cached keys can't leak between tests, and its module-level
// site tables load inside a test, where Stryker's per-test coverage sees them. Imported at
// the top they'd count as static coverage only, and an incremental run never retests a
// surviving static mutant against newly added tests.
beforeEach(async () => {
  vi.resetModules();
  const channel = await import("../src/content/channel.js");
  ({ channelKeys, currentChannelName, sameChannelIdentity, sameChannelKeys } = channel);
});

function at(hostname: string, pathname: string, search = ""): void {
  vi.stubGlobal("location", { hostname, pathname, search });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("channelKeys (stable per-channel keys)", () => {
  it("reads the @handle from the owner link on a watch page", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@WGC098"]);
  });

  it("reads the owner link on a /live/<id> page (live-stream short link)", () => {
    at("www.youtube.com", "/live/KYnjhnYNdsk");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@WGC098"]);
  });

  it("reads a non-ASCII @handle that YouTube percent-encodes in the href", () => {
    at("www.youtube.com", "/watch");
    // The href is percent-encoded; the key is the decoded handle.
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@caf%C3%A9">Cafe</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@café"]);
  });

  it("reads the /channel/UC… id when there's no handle", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/channel/UCabc_123">Name</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCabc_123"]);
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
    expect(channelKeys()).toEqual(["channel/UCabc_123", "@WGC098"]);
  });

  it("is empty (no keys) off a watch page", () => {
    at("www.youtube.com", "/results");
    expect(channelKeys()).toEqual([]);
  });

  it("does not read YouTube owner links off YouTube", () => {
    at("www.twitch.tv", "/directory"); // reserved → not a Twitch channel page
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual([]);
  });

  it("reads the Twitch login from a channel page", () => {
    at("www.twitch.tv", "/Shroud");
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
    expect(channelKeys()).toEqual(["twitch:inkmate03"]);
  });

  it("resolves a Twitch VOD from the broadcaster name in h1.tw-title", () => {
    at("www.twitch.tv", "/videos/2795588124");
    document.body.innerHTML = `<h1 class="tw-title">DooMxx</h1>`;
    expect(channelKeys()).toEqual(["twitch:doomxx"]);
  });

  it("resolves a Twitch VOD from the broadcaster avatar link as a fallback", () => {
    at("www.twitch.tv", "/videos/2795588124");
    document.body.innerHTML = `<a href="/Inkmate03"><img class="tw-image-avatar" src="x"></a>`;
    expect(channelKeys()).toEqual(["twitch:inkmate03"]);
  });

  it("reads the Kick login on live and record pages, ignoring reserved routes", () => {
    at("kick.com", "/xQc");
    expect(channelKeys()).toEqual(["kick:xqc"]);
    at("kick.com", "/inkmate03/videos/4592c135"); // record page → first segment
    expect(channelKeys()).toEqual(["kick:inkmate03"]);
    at("kick.com", "/browse");
    expect(channelKeys()).toEqual([]);
  });

  it("reads the VK Video Live login on live and deep record/playlist pages", () => {
    at("live.vkvideo.ru", "/Kuplinov");
    expect(channelKeys()).toEqual(["vkvideo:kuplinov"]);
    at("live.vkvideo.ru", "/lasqa/playlist/d39213db/video/8ef5ff0f"); // deep VOD path
    expect(channelKeys()).toEqual(["vkvideo:lasqa"]);
  });

  it("reads the w.tv login on live and record pages", () => {
    at("w.tv", "/KinoZALL");
    expect(channelKeys()).toEqual(["w:kinozall"]);
    at("w.tv", "/kinozall/videos/019ebb10");
    expect(channelKeys()).toEqual(["w:kinozall"]);
  });

  it("reads the TikTok login from /@user and /@user/live, requiring the @ prefix", () => {
    at("www.tiktok.com", "/@charli");
    expect(channelKeys()).toEqual(["tiktok:charli"]);
    at("www.tiktok.com", "/@charli/live");
    expect(channelKeys()).toEqual(["tiktok:charli"]);
    at("www.tiktok.com", "/live"); // directory, not a /@handle
    expect(channelKeys()).toEqual([]);
  });

  it("is empty off a /watch page (home, channel page, search…)", () => {
    at("www.youtube.com", "/results");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual([]);
  });

  it("is empty before the owner link has rendered", () => {
    at("www.youtube.com", "/watch");
    expect(channelKeys()).toEqual([]);
  });

  it("does not cache an empty YouTube owner before it renders", () => {
    at("www.youtube.com", "/watch", "?v=one");
    expect(channelKeys()).toEqual([]);
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@Later">Later</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@Later"]);
  });

  it("keeps the owner keys through a re-render that briefly drops the owner link", () => {
    at("www.youtube.com", "/watch", "?v=one");
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/@Stable">Stable</a>
         <a class="yt-simple-endpoint" href="/channel/UCstable">Stable</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCstable", "@Stable"]);
    document.body.innerHTML = "";
    expect(channelKeys()).toEqual(["channel/UCstable", "@Stable"]);
  });

  it("does not freeze a YouTube handle before the canonical id appears", () => {
    at("www.youtube.com", "/watch", "?v=one");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@Stable">Stable</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@Stable"]);
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/@Stable">Stable</a>
         <a class="yt-simple-endpoint" href="/channel/UCstable">Stable</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCstable", "@Stable"]);
  });

  it("invalidates rendered YouTube owner keys when the video URL changes", () => {
    at("www.youtube.com", "/watch", "?v=one");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@One">One</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@One"]);
    at("www.youtube.com", "/watch", "?v=two");
    document.body.innerHTML = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@Two">Two</a></ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@Two"]);
  });

  it("follows the owner link when it re-renders on the same video URL", () => {
    at("www.youtube.com", "/watch", "?v=two");
    // Right after an in-page navigation the previous video's owner can still be shown.
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/@One">One</a>
         <a class="yt-simple-endpoint" href="/channel/UCone">One</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCone", "@One"]);
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/@Two">Two</a>
         <a class="yt-simple-endpoint" href="/channel/UCtwo">Two</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCtwo", "@Two"]);
  });

  it("follows a Twitch VOD's broadcaster link when it re-renders on the same URL", () => {
    at("www.twitch.tv", "/videos/2795588125");
    document.body.innerHTML = `<a data-a-target="video-info-channel-name" href="/OldStreamer">Old</a>`;
    expect(channelKeys()).toEqual(["twitch:oldstreamer"]);
    document.body.innerHTML = `<a data-a-target="video-info-channel-name" href="/NewStreamer">New</a>`;
    expect(channelKeys()).toEqual(["twitch:newstreamer"]);
  });
});

describe("channelKeys host and path matching", () => {
  // A watch page's owner link — YouTube also keeps it in the DOM after navigating away.
  const owner = `<ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@WGC098">WGC</a></ytd-video-owner-renderer>`;

  it.each([
    ["youtube.com", "/watch", ["@WGC098"]],
    ["twitch.tv", "/Shroud", ["twitch:shroud"]],
    ["vkvideo.ru", "/Kuplinov", ["vkvideo:kuplinov"]],
    ["vkplay.live", "/Kuplinov", ["vkvideo:kuplinov"]],
    ["tiktok.com", "/@charli", ["tiktok:charli"]],
  ])("recognizes the bare %s domain, not only its subdomains", (host, path, keys) => {
    at(host, path);
    document.body.innerHTML = owner;
    expect(channelKeys()).toEqual(keys);
  });

  it.each([
    ["www.youtube.com.example.org", "/watch"],
    ["www.twitch.tv.example.org", "/shroud"],
    ["kick.com.example.org", "/xqc"],
    ["live.vkvideo.ru.example.org", "/kuplinov"],
    ["vkplay.live.example.org", "/kuplinov"],
    ["w.tv.example.org", "/kinozall"],
    ["www.tiktok.com.example.org", "/@charli"],
  ])("has no keys on %s, which only starts with a supported domain", (host, path) => {
    at(host, path);
    document.body.innerHTML = owner;
    expect(channelKeys()).toEqual([]);
  });

  it.each([
    ["/watchmojo", "legacy vanity channel URL starting with /watch"],
    ["/user/watch", "legacy channel URL ending in /watch"],
    ["/c/live/videos", "a channel named live, not a /live/<id> stream link"],
  ])("is empty on YouTube %s (%s) despite the stale owner link", (path) => {
    at("www.youtube.com", path);
    document.body.innerHTML = owner;
    expect(channelKeys()).toEqual([]);
  });

  it.each([
    [
      "ytd-channel-name outside an owner renderer",
      `<ytd-channel-name><a class="yt-simple-endpoint" href="/@Solo">Solo</a></ytd-channel-name>`,
    ],
    [
      "#owner #channel-name without the endpoint class",
      `<div id="owner"><div id="channel-name"><a href="/@Solo">Solo</a></div></div>`,
    ],
  ])("reads the owner link from the %s layout", (_layout, html) => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = html;
    expect(channelKeys()).toEqual(["@Solo"]);
  });

  it("skips an owner anchor that has no href yet", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint">WGC</a>
         <a class="yt-simple-endpoint" href="/@WGC098">WGC</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["@WGC098"]);
  });

  it("keys a video listing several channels by the first owner's id and handle", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer>
         <a class="yt-simple-endpoint" href="/channel/UCfirst">First</a>
         <a class="yt-simple-endpoint" href="/@First">First</a>
         <a class="yt-simple-endpoint" href="/channel/UCsecond">Second</a>
         <a class="yt-simple-endpoint" href="/@Second">Second</a>
       </ytd-video-owner-renderer>`;
    expect(channelKeys()).toEqual(["channel/UCfirst", "@First"]);
  });

  it("does not carry the previous video's keys to one whose owner hasn't rendered", () => {
    at("www.youtube.com", "/watch", "?v=one");
    document.body.innerHTML = owner;
    expect(channelKeys()).toEqual(["@WGC098"]);
    at("www.youtube.com", "/watch", "?v=two");
    document.body.innerHTML = "";
    expect(channelKeys()).toEqual([]);
  });

  it.each(["www.twitch.tv", "kick.com"])("has no channel on the %s front page", (host) => {
    at(host, "/");
    expect(channelKeys()).toEqual([]);
  });
});

describe("channelKeys Twitch VOD fallback", () => {
  const vod = "/videos/2795588124";

  it("trims the broadcaster name before matching it as a login", () => {
    at("www.twitch.tv", vod);
    document.body.innerHTML = `<h1 class="tw-title">
        DooMxx
      </h1>`;
    expect(channelKeys()).toEqual(["twitch:doomxx"]);
  });

  it.each(["잉크 Inkmate03", "Inkmate03 잉크"])(
    "uses the channel link when the name '%s' isn't login-shaped",
    (name) => {
      at("www.twitch.tv", vod);
      document.body.innerHTML = `<h1 class="tw-title">${name}</h1><a data-a-target="video-info-channel-name" href="/inkmate03">${name}</a>`;
      expect(channelKeys()).toEqual(["twitch:inkmate03"]);
    },
  );

  it("skips a name that reads like a reserved route and uses the channel link", () => {
    at("www.twitch.tv", vod);
    document.body.innerHTML = `<h1 class="tw-title">Videos</h1><a data-a-target="video-info-channel-name" href="/inkmate03">Inkmate03</a>`;
    expect(channelKeys()).toEqual(["twitch:inkmate03"]);
  });

  it("never keys a VOD by the host of an absolute channel link", () => {
    at("www.twitch.tv", vod);
    document.body.innerHTML = `<a data-a-target="video-info-channel-name" href="https://www.twitch.tv/Inkmate03">Inkmate03</a>
       <a href="/Inkmate03"><img class="tw-image-avatar" src="x"></a>`;
    expect(channelKeys()).toEqual(["twitch:inkmate03"]);
  });

  it("does not borrow a streamer card's avatar link on directory pages", () => {
    document.body.innerHTML = `<a href="/shroud"><img class="tw-image-avatar" src="x"></a>`;
    at("www.twitch.tv", "/directory/category/just-chatting");
    expect(channelKeys()).toEqual([]);
    at("www.twitch.tv", "/directory/category/just-chatting/videos/all");
    expect(channelKeys()).toEqual([]);
  });
});

describe("channelKeys reserved first-segment routes", () => {
  // Site pages whose first path segment is a route, not a channel login.
  it.each([
    [
      "www.twitch.tv",
      [
        "/directory/following",
        "/settings/profile",
        "/subscriptions",
        "/following",
        "/friends",
        "/inventory",
        "/wallet",
        "/drops/campaigns",
        "/prime",
        "/turbo",
        "/downloads",
        "/jobs",
        "/store",
        "/search",
        "/p/en/legal/terms-of-service",
        "/u",
        "/team/esl",
        "/communities",
        "/popout/xqc/chat",
        "/moderator/xqc",
        "/payments",
        "/clips",
        "/collections/abc123",
        "/dashboard",
        "/broadcast",
      ],
    ],
    [
      "kick.com",
      [
        "/categories",
        "/category/just-chatting",
        "/following",
        "/subscriptions",
        "/messages",
        "/search",
        "/help",
        "/settings/profile",
        "/account",
        "/wallet",
        "/clips",
        "/about",
        "/dashboard/stream",
        "/creator",
        "/partner",
        "/terms",
        "/privacy",
        "/careers",
        "/ranking",
        "/store",
      ],
    ],
    [
      "live.vkvideo.ru",
      [
        "/app",
        "/api",
        "/search",
        "/following",
        "/categories",
        "/category/just_chatting",
        "/top",
        "/about",
        "/support",
        "/help",
        "/settings",
        "/feed",
        "/promo",
      ],
    ],
    [
      "w.tv",
      [
        "/about",
        "/search",
        "/help",
        "/login",
        "/signup",
        "/register",
        "/terms",
        "/privacy",
        "/settings",
        "/browse",
        "/categories",
        "/category/games",
      ],
    ],
  ])("%s non-channel routes have no keys", (host, paths) => {
    for (const path of paths) {
      at(host, path);
      expect(channelKeys(), path).toEqual([]);
    }
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

  it("trims whitespace around the YouTube owner name", () => {
    at("www.youtube.com", "/watch");
    document.body.innerHTML = `<ytd-video-owner-renderer><ytd-channel-name><a href="/@WGC098">
          WGC
        </a></ytd-channel-name></ytd-video-owner-renderer>`;
    expect(currentChannelName()).toBe("WGC");
  });

  it("trims whitespace around a site's display name", () => {
    at("www.twitch.tv", "/shroud");
    document.body.innerHTML = `<span data-a-target="user-display-name">
        Shroud
      </span>`;
    expect(currentChannelName()).toBe("Shroud");
  });

  it("skips an @handle name node and reads the TikTok display name", () => {
    at("www.tiktok.com", "/@charli/live");
    document.body.innerHTML = `<h1 data-e2e="user-title">@charli</h1><span data-e2e="live-anchor-username">Charli D'Amelio</span>`;
    expect(currentChannelName()).toBe("Charli D'Amelio");
  });

  it.each([
    ["VK Video DisplayName", "live.vkvideo.ru", "/kuplinov", "StreamInfo_DisplayName_x1"],
    ["VK Video channel-name", "live.vkvideo.ru", "/kuplinov", "channel-name"],
    ["w.tv channel-name", "w.tv", "/kinozall", "channel-name__title"],
    ["w.tv DisplayName", "w.tv", "/kinozall", "Header_DisplayName"],
  ])("reads the display name from the %s node", (_node, host, path, cls) => {
    at(host, path);
    document.body.innerHTML = `<span class="${cls}">Streamer ► Live</span>`;
    expect(currentChannelName()).toBe("Streamer ► Live");
  });

  it("is empty on a non-channel route without a name node", () => {
    at("www.twitch.tv", "/directory");
    expect(currentChannelName()).toBe("");
  });
});

describe("sameChannelIdentity", () => {
  it("treats a late-rendered canonical id as the same YouTube channel", () => {
    expect(sameChannelIdentity(["@WGC098"], ["channel/UCabc_123", "@WGC098"])).toBe(true);
  });

  it("treats unrelated channels as different", () => {
    expect(sameChannelIdentity(["channel/UCone", "@one"], ["channel/UCtwo", "@two"])).toBe(false);
    expect(sameChannelIdentity([], ["@one"])).toBe(false);
  });
});

describe("sameChannelKeys", () => {
  it("detects a late-rendered alias so saved speeds can be re-resolved", () => {
    expect(sameChannelKeys(["channel/UCabc_123"], ["channel/UCabc_123", "@WGC098"])).toBe(false);
  });

  it("ignores order but requires the same full key set", () => {
    expect(
      sameChannelKeys(["@WGC098", "channel/UCabc_123"], ["channel/UCabc_123", "@WGC098"]),
    ).toBe(true);
    expect(sameChannelKeys(["@one"], ["@two"])).toBe(false);
  });

  it("treats a dropped alias as a key change", () => {
    expect(sameChannelKeys(["channel/UCabc_123", "@WGC098"], ["channel/UCabc_123"])).toBe(false);
  });

  it("treats a renamed handle on the same channel id as a key change", () => {
    expect(
      sameChannelKeys(["channel/UCabc_123", "@OldName"], ["channel/UCabc_123", "@NewName"]),
    ).toBe(false);
  });
});
