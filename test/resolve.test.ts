import { describe, it, expect } from "vitest";
import { resolveSpeed, resolveSyncTarget, resolveAutoSlow } from "../src/content/core/resolve.js";

// The priority chain (below the manual in-tab override, which the caller owns):
// channel > site > global > 100%.
describe("resolveSpeed", () => {
  const D = "youtube.com";

  it("a channel speed wins over site + global", () => {
    expect(resolveSpeed(["UC1"], D, { [D]: 1.5 }, { UC1: 2.0 }, 1.25)).toEqual({
      speed: 2.0,
      scope: "channel",
    });
  });

  it("matches a channel speed saved under either key form", () => {
    expect(resolveSpeed(["UC1", "@handle"], D, {}, { "@handle": 1.75 }, undefined)).toEqual({
      speed: 1.75,
      scope: "channel",
    });
  });

  it("falls to the site speed when no channel speed", () => {
    expect(resolveSpeed(["UC1"], D, { [D]: 1.5 }, {}, 1.25)).toEqual({ speed: 1.5, scope: "site" });
  });

  it("falls to the global speed when no channel/site speed", () => {
    expect(resolveSpeed([], D, {}, {}, 1.25)).toEqual({ speed: 1.25, scope: "global" });
  });

  it("falls to 100% with nothing saved (scope null)", () => {
    expect(resolveSpeed([], D, {}, {}, undefined)).toEqual({ speed: 1.0, scope: null });
  });

  it("treats a domain entry for another host as absent", () => {
    expect(resolveSpeed([], D, { "other.com": 2.0 }, {}, undefined)).toEqual({
      speed: 1.0,
      scope: null,
    });
  });
});

// Same priority chain as speed, defaulting to the 5s allowed delay.
describe("resolveSyncTarget", () => {
  const D = "twitch.tv";

  it("a channel target wins over site + global", () => {
    expect(resolveSyncTarget(["twitch:shroud"], D, { [D]: 8 }, { "twitch:shroud": 3 }, 12)).toEqual(
      { target: 3, scope: "channel" },
    );
  });

  it("matches a channel target saved under either key form", () => {
    expect(resolveSyncTarget(["UC1", "@h"], "youtube.com", {}, { "@h": 6 }, undefined)).toEqual({
      target: 6,
      scope: "channel",
    });
  });

  it("falls to the site target when no channel target", () => {
    expect(resolveSyncTarget(["twitch:x"], D, { [D]: 8 }, {}, 12)).toEqual({
      target: 8,
      scope: "site",
    });
  });

  it("falls to the global target when no channel/site target", () => {
    expect(resolveSyncTarget([], D, {}, {}, 12)).toEqual({ target: 12, scope: "global" });
  });

  it("falls to the 5s default with nothing saved (scope null)", () => {
    expect(resolveSyncTarget([], D, {}, {}, undefined)).toEqual({ target: 5, scope: null });
  });
});

// Each scope stores a bundle {on, target}; the highest-priority scope with an entry
// supplies both. Priority channel > site > global; default off/6. (Floor is global.)
describe("resolveAutoSlow", () => {
  const D = "youtube.com";
  const B = (on: boolean, target = 6) => ({ on, target });

  it("a channel bundle wins over site + global", () => {
    expect(resolveAutoSlow(["UC1"], D, { [D]: B(false) }, { UC1: B(true, 8) }, B(false))).toEqual({
      enabled: true,
      target: 8,
      scope: "channel",
    });
  });

  it("an explicit channel `off` overrides a broader `on`", () => {
    expect(resolveAutoSlow(["UC1"], D, { [D]: B(true) }, { UC1: B(false) }, B(true))).toEqual({
      enabled: false,
      target: 6,
      scope: "channel",
    });
  });

  it("falls to the site bundle when no channel entry", () => {
    expect(resolveAutoSlow(["UC1"], D, { [D]: B(true, 5) }, {}, B(false))).toEqual({
      enabled: true,
      target: 5,
      scope: "site",
    });
  });

  it("falls to the global bundle when no channel/site entry", () => {
    expect(resolveAutoSlow([], D, {}, {}, B(true, 7))).toEqual({
      enabled: true,
      target: 7,
      scope: "global",
    });
  });

  it("defaults to off with nothing saved (scope null)", () => {
    expect(resolveAutoSlow([], D, {}, {}, undefined)).toEqual({
      enabled: false,
      target: 6,
      scope: null,
    });
  });

  it("clamps an out-of-range target", () => {
    expect(resolveAutoSlow([], D, {}, {}, B(true, 99))).toEqual({
      enabled: true,
      target: 12,
      scope: "global",
    });
  });

  it("treats a site entry for another host as absent", () => {
    expect(resolveAutoSlow([], D, { "other.com": B(true) }, {}, undefined)).toEqual({
      enabled: false,
      target: 6,
      scope: null,
    });
  });
});
