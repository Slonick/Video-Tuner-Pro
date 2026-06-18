// Imported dynamically (after vi.resetModules + setting globalThis.chrome) so the
// whole popup module graph — React, react-dom and platform/browser's `api` alias —
// is fresh and bound to the per-test mock.
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { App } from "../../src/popup/components/App.js";

export function renderApp(container: HTMLElement): Root {
  const root = createRoot(container);
  root.render(createElement(App));
  return root;
}
