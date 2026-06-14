// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createMockChrome } from "./mocks/chrome.js";
import en from "../src/_locales/en/messages.json";
import ja from "../src/_locales/ja/messages.json";

// The i18n module compiles every locale bundle in; getUILanguage decides the
// default, and a saved uiLang (applied by loadLang) overrides it.
async function fresh(settings: Record<string, unknown>, uiLang: string) {
  const c = createMockChrome({ settings });
  c.i18n.getUILanguage = () => uiLang;
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = c;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.resetModules();
  return import("../src/popup/i18n.js");
}

describe("popup i18n (bundled locales)", () => {
  it("defaults to the browser UI language", async () => {
    const { msg } = await fresh({}, "ru");
    expect(msg("optThemeLabel")).toBe("Тема");
  });

  it("uses English when the UI language isn't bundled", async () => {
    const { msg } = await fresh({}, "ko");
    expect(msg("optThemeLabel")).toBe(en.optThemeLabel.message);
  });

  it("loadLang applies a saved language override", async () => {
    const { msg, loadLang } = await fresh({ uiLang: "ja" }, "en");
    expect(msg("optThemeLabel")).toBe(en.optThemeLabel.message); // before: browser default
    await new Promise<void>((res) => loadLang(res));
    expect(msg("optThemeLabel")).toBe(ja.optThemeLabel.message); // after: saved override
  });

  it("returns '' for an unknown key", async () => {
    const { msg } = await fresh({}, "en");
    expect(msg("totallyMadeUpKey")).toBe("");
  });

  it("passes a message without placeholders through unchanged when subs are given", async () => {
    const { msg } = await fresh({}, "en");
    expect(msg("optThemeLabel", ["x"])).toBe("Theme");
  });

  it("localize fills [data-i18n] text and [data-i18n-title] titles", async () => {
    const { localize } = await fresh({}, "en");
    document.body.innerHTML =
      '<span data-i18n="optThemeLabel"></span><a data-i18n-title="optDelete"></a>';
    localize();
    expect(document.querySelector("span")!.textContent).toBe("Theme");
    expect(document.querySelector("a")!.title).toBe("Remove");
  });
});
