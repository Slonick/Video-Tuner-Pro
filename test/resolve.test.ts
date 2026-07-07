import { describe, it, expect } from "vitest";
import {
  resolveSpeed,
  resolveSyncTarget,
  resolveAutoSlow,
  resolveViewerAuto,
  resolveViewerFit,
} from "../src/content/core/resolve.js";

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

  it("uses the latest saved alias when both channel key forms exist", () => {
    expect(
      resolveSpeed(["UC1", "@handle"], D, {}, { UC1: 2.0, "@handle": 1.75 }, undefined),
    ).toEqual({
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

  it("uses the latest saved alias when both channel target key forms exist", () => {
    expect(
      resolveSyncTarget(["UC1", "@h"], "youtube.com", {}, { UC1: 9, "@h": 6 }, undefined),
    ).toEqual({
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

// Each scope stores a target; the highest-priority scope with an entry supplies
// it. Priority channel > site > global; default 6. Enable/floor are global.
describe("resolveAutoSlow", () => {
  const D = "youtube.com";
  const B = (target = 6, on?: boolean) => (on == null ? { target } : { target, on });

  it("a channel target wins over site + global", () => {
    expect(resolveAutoSlow(["UC1"], D, { [D]: B() }, { UC1: B(8) }, B())).toEqual({
      target: 8,
      scope: "channel",
    });
  });

  it("ignores the legacy scoped on/off field", () => {
    expect(
      resolveAutoSlow(["UC1"], D, { [D]: B(9, true) }, { UC1: B(5, false) }, B(8, true)),
    ).toEqual({
      target: 5,
      scope: "channel",
    });
  });

  it("uses the latest saved alias when both auto-slow channel key forms exist", () => {
    expect(resolveAutoSlow(["UC1", "@h"], D, {}, { UC1: B(8), "@h": B(5) }, undefined)).toEqual({
      target: 5,
      scope: "channel",
    });
  });

  it("falls to the site target when no channel entry", () => {
    expect(resolveAutoSlow(["UC1"], D, { [D]: B(5) }, {}, B())).toEqual({
      target: 5,
      scope: "site",
    });
  });

  it("falls to the global target when no channel/site entry", () => {
    expect(resolveAutoSlow([], D, {}, {}, B(7))).toEqual({
      target: 7,
      scope: "global",
    });
  });

  it("defaults to no scope with nothing saved", () => {
    expect(resolveAutoSlow([], D, {}, {}, undefined)).toEqual({
      target: 6,
      scope: null,
    });
  });

  it("clamps an out-of-range target", () => {
    expect(resolveAutoSlow([], D, {}, {}, B(99))).toEqual({
      target: 12,
      scope: "global",
    });
  });

  it("treats a site entry for another host as absent", () => {
    expect(resolveAutoSlow([], D, { "other.com": B() }, {}, undefined)).toEqual({
      target: 6,
      scope: null,
    });
  });
});

describe("resolveViewerAuto", () => {
  const D = "youtube.com";

  it("a channel mode wins over site + global", () => {
    expect(resolveViewerAuto(["UC1"], D, { [D]: "off" }, { UC1: "theater" }, "normal")).toEqual({
      mode: "theater",
      scope: "channel",
    });
  });

  it("an explicit channel off overrides a broader mode", () => {
    expect(resolveViewerAuto(["UC1"], D, { [D]: "normal" }, { UC1: "off" }, "theater")).toEqual({
      mode: "off",
      scope: "channel",
    });
  });

  it("uses the latest saved alias when both viewer-auto channel key forms exist", () => {
    expect(
      resolveViewerAuto(["UC1", "@h"], D, {}, { UC1: "theater", "@h": "normal" }, "off"),
    ).toEqual({
      mode: "normal",
      scope: "channel",
    });
  });

  it("falls to the site mode when no channel entry", () => {
    expect(resolveViewerAuto(["UC1"], D, { [D]: "normal" }, {}, "theater")).toEqual({
      mode: "normal",
      scope: "site",
    });
  });

  it("falls to the global mode when no channel/site entry", () => {
    expect(resolveViewerAuto([], D, {}, {}, "theater")).toEqual({
      mode: "theater",
      scope: "global",
    });
  });

  it("defaults to off with nothing saved", () => {
    expect(resolveViewerAuto([], D, {}, {}, undefined)).toEqual({ mode: "off", scope: null });
  });
});

describe("resolveViewerFit", () => {
  const D = "youtube.com";

  it("a channel mode wins over site + global", () => {
    expect(resolveViewerFit(["UC1"], D, { [D]: "cover" }, { UC1: "fill" }, "contain")).toEqual({
      mode: "fill",
      scope: "channel",
    });
  });

  it("uses the latest saved alias when both viewer-fit channel key forms exist", () => {
    expect(
      resolveViewerFit(["UC1", "@h"], D, {}, { UC1: "cover", "@h": "fill" }, "contain"),
    ).toEqual({
      mode: "fill",
      scope: "channel",
    });
  });

  it("falls to the site mode when no channel entry", () => {
    expect(resolveViewerFit(["UC1"], D, { [D]: "cover" }, {}, "fill")).toEqual({
      mode: "cover",
      scope: "site",
    });
  });

  it("falls to the global mode when no channel/site entry", () => {
    expect(resolveViewerFit([], D, {}, {}, "fill")).toEqual({
      mode: "fill",
      scope: "global",
    });
  });

  it("defaults to contain with nothing saved", () => {
    expect(resolveViewerFit([], D, {}, {}, undefined)).toEqual({ mode: "contain", scope: null });
  });
});
