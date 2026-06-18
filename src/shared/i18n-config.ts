// Language preference for the extension UI (popup + options). The build's
// default_locale stays "en"; this layer lets the user override the browser
// language with an explicit pick. All locale message bundles are compiled into
// the page JS (see popup/i18n.ts) so switching never needs a network fetch.
import { STORE } from "./store.js";

// Selectable locales, in picker display order. Codes match the _locales folders.
export const LOCALES = ["en", "ru", "de", "es", "fr", "hi", "ja", "pt_BR", "uk", "zh_CN"] as const;
export type Locale = (typeof LOCALES)[number];
export type Lang = "system" | Locale;

// Native names shown in the picker.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  hi: "हिन्दी",
  ja: "日本語",
  pt_BR: "Português (Brasil)",
  uk: "Українська",
  zh_CN: "中文 (简体)",
};

// Map a chosen language (or the browser UI language, when "system") to a bundled
// locale, falling back to English for anything we don't ship.
export function resolveLocale(lang: Lang, uiLanguage: string): Locale {
  if (lang !== "system") return lang;
  const lc = uiLanguage.toLowerCase().replace("_", "-");
  if (lc.startsWith("pt")) return "pt_BR";
  if (lc.startsWith("zh")) return "zh_CN";
  const two = lc.slice(0, 2);
  return (LOCALES as readonly string[]).includes(two) ? (two as Locale) : "en";
}

export function getLang(cb: (lang: Lang) => void): void {
  STORE.get(["uiLang"], (r) => cb((r.uiLang as Lang) || "system"));
}

export function setLang(lang: Lang, done?: () => void): void {
  STORE.set({ uiLang: lang }, done);
}
