import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function loadMessages(locale = "en"): Promise<Record<string, { message: string }>> {
  const path = fileURLToPath(
    new URL(`../../src/_locales/${locale}/messages.json`, import.meta.url),
  );
  return JSON.parse(await readFile(path, "utf8"));
}
