import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, PROMO_CARDS, PROMO_SCREENS, ROOT, storeCopy } from "../tools/promo-lib.mjs";

async function popupSource(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const chunks = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return popupSource(path);
      return /\.tsx?$/.test(entry.name) ? readFile(path, "utf8") : "";
    }),
  );
  return chunks.join("\n");
}

describe("promo configuration", () => {
  it("has one dedicated state for every configured popup card", async () => {
    expect(PROMO_SCREENS).toEqual(["overview", ...PROMO_CARDS.map(({ key }) => key)]);
    expect(new Set(PROMO_SCREENS).size).toBe(PROMO_SCREENS.length);

    const source = await popupSource(join(ROOT, "src/popup"));
    for (const { selector } of PROMO_CARDS) expect(source).toContain(selector.slice(1));
    expect(source.match(/className="[^"]*card-slot[^"]*"/g)).toHaveLength(PROMO_CARDS.length);

    const guide = await readFile(join(ROOT, "src/popup/components/GuideTour.tsx"), "utf8");
    for (const { selector } of PROMO_CARDS) expect(guide).toContain(`selector: "${selector}"`);
  });

  it("has non-empty localized copy for every store screen", async () => {
    for (const locale of LOCALES) {
      const copy = await storeCopy(locale);
      expect(copy.head, `${locale} headline`).not.toBe("");
      expect(copy.lead, `${locale} lead`).not.toBe("");
      for (const { key } of PROMO_CARDS) {
        expect(copy.cards[key]?.title, `${locale}/${key} title`).not.toBe("");
        expect(copy.cards[key]?.desc, `${locale}/${key} description`).not.toBe("");
      }
    }
  });
});
