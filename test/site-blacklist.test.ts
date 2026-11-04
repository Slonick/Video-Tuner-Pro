import { describe, it, expect } from "vitest";
import {
  SITE_BLACKLIST_KEY,
  normalizeSiteEntry,
  normalizeSiteList,
  matchingSite,
  isSiteBlacklisted,
  blockSite,
  allowSite,
} from "../src/shared/site-blacklist.js";
import { normalizeHost } from "../src/content/core/domain.js";

describe("normalizeSiteEntry", () => {
  const cases: [string, string][] = [
    ["youtube.com", "youtube.com"],
    ["  YouTube.COM  ", "youtube.com"],
    ["https://www.youtube.com/watch?v=1#t=5", "youtube.com"],
    ["http://m.youtube.com", "youtube.com"],
    ["music.youtube.com", "music.youtube.com"],
    ["example.com:8080/path", "example.com"],
    ["user:secret@example.com", "example.com"],
    ["*.example.com", "example.com"],
    ["*.www.example.com", "example.com"],
    ["example.com.", "example.com"],
    ["пример.рф", "xn--e1afmkfd.xn--p1ai"],
    ["localhost", "localhost"],
    ["127.0.0.1:3000", "127.0.0.1"],
    ["[::1]:8080", "[::1]"],
    ["example.com/out?to=https://other.org", "example.com"],
    ["s3://bucket.example.com", "bucket.example.com"],
    ["stream.example.com", "stream.example.com"],
  ];
  it.each(cases)("%s → %s", (raw, expected) => {
    expect(normalizeSiteEntry(raw)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "foo bar",
    "http://",
    "://",
    "/",
    "?x",
    "javascript:alert(1)",
    "exa$mple.com",
    "a..b.com",
    "a.com,b.com",
    "a*.example.com",
  ])("ignores the garbage entry %j", (raw) => {
    expect(normalizeSiteEntry(raw)).toBeNull();
  });

  it("ignores anything that is not a string", () => {
    for (const raw of [undefined, null, 42, {}, ["a.com"]])
      expect(normalizeSiteEntry(raw)).toBeNull();
  });

  it("lines up with the host the page side derives (content/core/domain.ts normalizeHost)", () => {
    for (const host of [
      "www.twitch.tv",
      "m.youtube.com",
      "youtube.com",
      "docs.google.com",
      "a.b.c.d",
    ]) {
      expect(normalizeSiteEntry(host)).toBe(normalizeHost(host));
    }
  });
});

describe("normalizeSiteList", () => {
  it("normalizes, dedupes and keeps first-seen order", () => {
    expect(
      normalizeSiteList(["Example.com", "https://www.example.com/", "other.org", "example.com"]),
    ).toEqual(["example.com", "other.org"]);
  });

  it("drops unusable items so a hand-edited backup cannot break matching", () => {
    expect(normalizeSiteList(["", 5, null, "a b", "ok.com"])).toEqual(["ok.com"]);
  });

  it("treats a stored value that is not a list as empty", () => {
    for (const raw of [undefined, null, "youtube.com", {}, 7])
      expect(normalizeSiteList(raw)).toEqual([]);
  });

  it("is stable: normalizing a normalized list changes nothing", () => {
    const once = normalizeSiteList(["https://WWW.Example.com/x", "m.other.org"]);
    expect(normalizeSiteList(once)).toEqual(once);
  });
});

describe("matching", () => {
  it("matches the host itself", () => {
    expect(isSiteBlacklisted("youtube.com", ["youtube.com"])).toBe(true);
  });

  it("an entry covers its subdomains, however deep", () => {
    expect(isSiteBlacklisted("music.youtube.com", ["youtube.com"])).toBe(true);
    expect(isSiteBlacklisted("a.b.youtube.com", ["youtube.com"])).toBe(true);
  });

  it("a subdomain entry never covers its parent or a sibling", () => {
    expect(isSiteBlacklisted("youtube.com", ["music.youtube.com"])).toBe(false);
    expect(isSiteBlacklisted("studio.youtube.com", ["music.youtube.com"])).toBe(false);
  });

  it("does not match look-alikes that merely end with the entry", () => {
    expect(isSiteBlacklisted("notyoutube.com", ["youtube.com"])).toBe(false);
    expect(isSiteBlacklisted("youtube.com.evil.org", ["youtube.com"])).toBe(false);
    expect(isSiteBlacklisted("youtube.co", ["youtube.com"])).toBe(false);
  });

  it("never matches an empty host or an empty list", () => {
    expect(isSiteBlacklisted("", ["youtube.com"])).toBe(false);
    expect(isSiteBlacklisted("youtube.com", [])).toBe(false);
  });

  it("reports the entry that switched the site off", () => {
    expect(matchingSite("music.youtube.com", ["other.org", "youtube.com"])).toBe("youtube.com");
    expect(matchingSite("example.com", ["youtube.com"])).toBeNull();
    expect(matchingSite("", ["youtube.com"])).toBeNull();
  });
});

describe("blockSite / allowSite", () => {
  it("adds the (normalized) site once", () => {
    expect(blockSite(["a.com"], "b.com")).toEqual(["a.com", "b.com"]);
    expect(blockSite(["a.com", "b.com"], "b.com")).toEqual(["a.com", "b.com"]);
    expect(blockSite(["a.com"], "https://www.b.com/x")).toEqual(["a.com", "b.com"]);
  });

  it("refuses a domain that is not a host", () => {
    expect(blockSite(["a.com"], "")).toEqual(["a.com"]);
    expect(blockSite(["a.com"], "not a host")).toEqual(["a.com"]);
  });

  it("switching a site back on removes its own entry", () => {
    expect(allowSite(["a.com", "b.com"], "b.com")).toEqual(["a.com"]);
  });

  it("…and a parent's entry, the only way to un-cover a subdomain", () => {
    expect(allowSite(["youtube.com", "other.org"], "music.youtube.com")).toEqual(["other.org"]);
    expect(allowSite(["music.youtube.com", "youtube.com"], "music.youtube.com")).toEqual([]);
  });

  it("leaves narrower and unrelated entries alone", () => {
    expect(allowSite(["music.youtube.com", "other.org"], "youtube.com")).toEqual([
      "music.youtube.com",
      "other.org",
    ]);
  });

  it("never mutates its input", () => {
    const list = Object.freeze(["a.com", "b.com"]);
    expect(blockSite(list, "c.com")).toEqual(["a.com", "b.com", "c.com"]);
    expect(allowSite(list, "a.com")).toEqual(["b.com"]);
    expect(list).toEqual(["a.com", "b.com"]);
  });
});

describe("storage key", () => {
  it("is the documented one", () => {
    expect(SITE_BLACKLIST_KEY).toBe("siteBlacklist");
  });
});
