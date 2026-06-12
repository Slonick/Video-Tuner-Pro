import { api } from "./platform/browser.js";

export const msg = (key: string, subs?: string | string[]): string => api.i18n.getMessage(key, subs);

export function localize(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const text = key ? msg(key) : "";
    if (text) el.textContent = text;
  });
}
