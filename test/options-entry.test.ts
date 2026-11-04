// @vitest-environment jsdom
// The options entry applies the theme only once the selective-sync config has
// loaded: the theme is a routed setting, so an earlier read would come from the
// default (all-synced) area.
import { expect, it, vi } from "vitest";
import type * as I18n from "../src/popup/i18n.js";
import type * as Store from "../src/shared/store.js";
import type * as Theme from "../src/shared/theme.js";

const fx = vi.hoisted(() => ({
  whenReady: vi.fn((fn: () => void) => fn()),
  initTheme: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: fx.render }) }));
vi.mock("../src/shared/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Store>()),
  whenReady: fx.whenReady,
}));
vi.mock("../src/popup/i18n.js", async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  loadLang: (fn: () => void) => fn(),
}));
vi.mock("../src/shared/theme.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Theme>()),
  initTheme: fx.initTheme,
}));

it("applies the theme only after the sync config has loaded", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  // The entry boots on import, so it must load after the DOM above exists.
  await import("../src/options/index.js");

  expect(fx.render).toHaveBeenCalledOnce();
  expect(fx.initTheme).toHaveBeenCalledOnce();
  expect(fx.whenReady.mock.invocationCallOrder[0]).toBeLessThan(
    fx.initTheme.mock.invocationCallOrder[0],
  );
});
