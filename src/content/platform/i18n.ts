// Localized strings, guarded so a dead extension context never throws.
import { api } from "./browser.js";

export function i18n(key: string, subs?: string | string[]): string {
  try { return api.i18n.getMessage(key, subs) || ""; } catch (e) { return ""; }
}
