import { msg } from "./env.js";

// Replace text of every [data-i18n] element with its localized string.
export function localize() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const text = msg(el.dataset.i18n);
    if (text) el.textContent = text;
  });
}
