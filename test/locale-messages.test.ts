import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type MessageBundle = Record<string, { message?: unknown }>;

const localesDir = path.resolve(process.cwd(), "src/_locales");

function readMessages(locale: string): MessageBundle {
  return JSON.parse(fs.readFileSync(path.join(localesDir, locale, "messages.json"), "utf8"));
}

function localeNames(): string[] {
  return fs
    .readdirSync(localesDir)
    .filter((name) => fs.existsSync(path.join(localesDir, name, "messages.json")))
    .sort();
}

describe("locale message bundles", () => {
  it("keeps every locale in key parity with English", () => {
    const locales = localeNames();
    const englishKeys = Object.keys(readMessages("en")).sort();

    expect(locales).toContain("en");
    for (const locale of locales) {
      expect(Object.keys(readMessages(locale)).sort(), locale).toEqual(englishKeys);
    }
  });

  it("defines a string message for every locale key", () => {
    for (const locale of localeNames()) {
      const messages = readMessages(locale);
      for (const [key, entry] of Object.entries(messages)) {
        expect(typeof entry.message, `${locale}.${key}`).toBe("string");
      }
    }
  });
});
