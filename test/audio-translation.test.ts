// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { S } from "../src/content/state.js";
import { translationActive, compOn } from "../src/content/audio/translation.js";

// VOT marks its active button data-status="success" inside an OPEN shadow root
// under <vot-shadow-host>. Build that exact shape to drive detection.
function mountVot(status: string | null): void {
  const host = document.createElement("vot-shadow-host");
  const sr = host.attachShadow({ mode: "open" });
  if (status != null) {
    const btn = document.createElement("button");
    btn.setAttribute("data-status", status);
    sr.appendChild(btn);
  }
  document.body.appendChild(host);
}

describe("translationActive", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    S.audioCompEnabled = true;
  });

  it("false when VOT host is absent", () => {
    expect(translationActive()).toBe(false);
  });

  it("false when VOT is mounted but no button is playing", () => {
    mountVot("idle");
    expect(translationActive()).toBe(false);
  });

  it("false when VOT is present with no status button (always-mounted UI)", () => {
    mountVot(null);
    expect(translationActive()).toBe(false);
  });

  it("true while a translation is actively playing (data-status=success)", () => {
    mountVot("success");
    expect(translationActive()).toBe(true);
  });

  it("searches the document once per synchronous pass", async () => {
    const query = vi.spyOn(document, "querySelector");
    try {
      translationActive();
      translationActive();
      compOn();
      expect(query).toHaveBeenCalledTimes(1);

      mountVot("success");
      await Promise.resolve(); // the next pass looks again
      expect(translationActive()).toBe(true);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      query.mockRestore();
    }
  });
});

describe("compOn", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    S.siteDisabled = false;
  });

  it("on when enabled and no translation is playing", () => {
    S.audioCompEnabled = true;
    expect(compOn()).toBe(true);
  });

  it("off when the user disabled compression", () => {
    S.audioCompEnabled = false;
    expect(compOn()).toBe(false);
  });

  it("off on a blacklisted site, even when enabled", () => {
    S.audioCompEnabled = true;
    S.siteDisabled = true;
    expect(compOn()).toBe(false);
  });

  it("off (yields) while a translation is actively playing, even when enabled", () => {
    S.audioCompEnabled = true;
    mountVot("success");
    expect(compOn()).toBe(false);
  });
});
