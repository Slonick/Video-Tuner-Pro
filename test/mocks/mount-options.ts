// Mount the REAL options page into jsdom for behavioural tests: seed chrome
// storage, render the entry (which mounts every section), and hand back helpers to
// read storage and drive the custom controls (Slider thumb via keyboard, Switch via
// click, number inputs via the native value setter so React notices). Mirrors
// mount-popup, but for the options sections — which were previously only smoke-tested.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { createMockChrome } from "./chrome.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const messages = JSON.parse(read("../../src/_locales/en/messages.json"));

export const flush = () => new Promise<void>((r) => setTimeout(r));
export const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
export const byId = (id: string) => document.getElementById(id) as HTMLElement;

export interface MountedOptions {
  get: (keys: string[] | null) => Record<string, unknown>;
}

export async function mountOptions(
  settings: Record<string, unknown> = {},
  opts: { failSetKeys?: string[] } = {},
): Promise<MountedOptions> {
  document.body.innerHTML = read("../../src/options/options.html")
    .replace(/[\s\S]*<body>/, "")
    .replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const chrome = createMockChrome({ messages, settings, failSetKeys: opts.failSetKeys });
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = chrome;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.resetModules();
  await import("../../src/options/index.js");
  await settle();
  // Prior tests' roots aren't unmounted (the entry self-renders), so their
  // document-level capture listeners linger. If one was left mid key-capture it
  // would swallow later keydowns — an Escape resets any such stray state to idle.
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
  );
  await flush();
  return {
    get: (keys) => {
      let out: Record<string, unknown> = {};
      (globalThis.chrome.storage.local as chrome.storage.StorageArea).get(keys, (r) => (out = r));
      return out;
    },
  };
}

// --- Control drivers ---------------------------------------------------------

// Press a key on a Slider's thumb (role="slider"); the thumb's onKeyDown maps
// Home/End/Arrow*/Page* to a committed value. Deterministic — no geometry needed.
export function sliderKey(thumb: Element, key: string): void {
  thumb.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

// Set a controlled <input>'s value the way React notices (native setter), then fire
// the input event; optionally commit with Enter (the preset rows blur on Enter).
export function typeInput(input: HTMLInputElement, value: string, commit = true): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  // React's onBlur is delegated off focusout (which bubbles); jsdom's blur() alone
  // doesn't reach it, so fire focusout directly to trigger the row's commit.
  if (commit) input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

// Fire a bare keydown at the document (the Keys / preset capture handlers bind there).
export function pressDoc(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}
