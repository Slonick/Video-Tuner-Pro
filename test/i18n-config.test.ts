import { describe, it, expect, vi } from "vitest";
import { resolveLocale, LOCALES, LOCALE_NAMES } from "../src/shared/i18n-config.js";
import { createMockChrome } from "./mocks/chrome.js";

describe("resolveLocale", () => {
  it("returns an explicit choice unchanged", () => {
    expect(resolveLocale("de", "en-US")).toBe("de");
    expect(resolveLocale("zh_CN", "en-US")).toBe("zh_CN");
    expect(resolveLocale("pt_BR", "fr")).toBe("pt_BR");
  });

  it("maps the browser language to a bundled locale when set to system", () => {
    expect(resolveLocale("system", "de")).toBe("de");
    expect(resolveLocale("system", "ru-RU")).toBe("ru");
    expect(resolveLocale("system", "uk")).toBe("uk");
    expect(resolveLocale("system", "pt-BR")).toBe("pt_BR");
    expect(resolveLocale("system", "pt-PT")).toBe("pt_BR"); // any Portuguese → pt_BR
    expect(resolveLocale("system", "zh-Hans")).toBe("zh_CN");
    expect(resolveLocale("system", "zh-CN")).toBe("zh_CN");
  });

  it("falls back to English for unsupported or empty languages", () => {
    expect(resolveLocale("system", "ko")).toBe("en");
    expect(resolveLocale("system", "")).toBe("en");
  });

  it("ships a native name for every selectable locale", () => {
    for (const code of LOCALES) expect(LOCALE_NAMES[code]).toBeTruthy();
  });
});

describe("language preference storage", () => {
  async function fresh(settings: Record<string, unknown> = {}) {
    (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome =
      createMockChrome({ settings });
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    vi.resetModules();
    return import("../src/shared/i18n-config.js");
  }

  it("getLang defaults to system when nothing is saved", async () => {
    const { getLang } = await fresh({});
    let lang: string | undefined;
    getLang((l) => {
      lang = l;
    });
    expect(lang).toBe("system");
  });

  it("setLang persists a choice that getLang reads back", async () => {
    const { getLang, setLang } = await fresh({});
    setLang("ja");
    let lang: string | undefined;
    getLang((l) => {
      lang = l;
    });
    expect(lang).toBe("ja");
  });
});
