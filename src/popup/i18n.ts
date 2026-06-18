// Localization. All locale bundles are compiled into this page's JS so msg() is
// synchronous and switching language never needs a fetch. The active locale is
// the browser UI language by default; loadLang() then applies the user's saved
// override. Missing keys in a partial translation fall back to English.
import { api } from "./platform/browser.js";
import { STORE } from "../shared/store.js";
import { resolveLocale, type Lang, type Locale } from "../shared/i18n-config.js";

import en from "../_locales/en/messages.json";
import ru from "../_locales/ru/messages.json";
import de from "../_locales/de/messages.json";
import es from "../_locales/es/messages.json";
import fr from "../_locales/fr/messages.json";
import hi from "../_locales/hi/messages.json";
import ja from "../_locales/ja/messages.json";
import pt_BR from "../_locales/pt_BR/messages.json";
import uk from "../_locales/uk/messages.json";
import zh_CN from "../_locales/zh_CN/messages.json";

type Bundle = Record<string, { message: string }>;
const MESSAGES = { en, ru, de, es, fr, hi, ja, pt_BR, uk, zh_CN } as Record<Locale, Bundle>;

// Guarded — getUILanguage exists in every real extension context, but a dead
// context (or a test harness without it) shouldn't throw at module load.
function uiLanguage(): string {
  try {
    return api.i18n.getUILanguage();
  } catch {
    return "en";
  }
}

let active: Bundle = MESSAGES[resolveLocale("system", uiLanguage())];

function substitute(text: string, subs: string | string[]): string {
  const arr = Array.isArray(subs) ? subs : [subs];
  return text.replace(/\$(\d+)/g, (_, n) => arr[Number(n) - 1] ?? "");
}

export const msg = (key: string, subs?: string | string[]): string => {
  const text = active[key]?.message ?? MESSAGES.en[key]?.message;
  if (text == null) return "";
  return subs != null ? substitute(text, subs) : text;
};

// Read the saved language override (if any) and switch the active locale, then
// run cb so callers can (re)localize and build their sections in that language.
export function loadLang(cb: () => void): void {
  STORE.get(["uiLang"], (r) => {
    active = MESSAGES[resolveLocale((r.uiLang as Lang) || "system", uiLanguage())];
    cb();
  });
}

export function localize(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const text = key ? msg(key) : "";
    if (text) el.textContent = text;
  });
  // Hover tooltips: localize the `title` attribute when present.
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle;
    const text = key ? msg(key) : "";
    if (text) el.title = text;
  });
}
