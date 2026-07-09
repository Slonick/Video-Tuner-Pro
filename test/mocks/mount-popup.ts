// Mount the real popup <App/> into jsdom for integration tests: seed chrome
// storage, control the content-script replies per action, render, and hand back
// helpers to drive + inspect it. React flushes asynchronously, so callers await
// `flush()` after mount and after interactions.
import { type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { vi } from "vitest";
import { createMockChrome } from "./chrome.js";
import messages from "../../src/_locales/en/messages.json";

export const flush = () => new Promise<void>((r) => setTimeout(r));
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const byId = (id: string) => document.getElementById(id) as HTMLElement;

// Sliders are Radix (a <span role="slider"> thumb), not <input type=range>. Read
// the value off aria-valuenow.
const thumbOf = (id: string) => byId(id).querySelector('[role="slider"]') as HTMLElement;
export const sliderValue = (id: string) => Number(thumbOf(id).getAttribute("aria-valuenow"));

// Drive a Radix slider to a value by faking a pointer drag: mock the geometry
// (jsdom has none) and dispatch pointerdown→move→up at the matching x. `commit`
// false stops before release (the "input, not yet change" case).
export function setSlider(id: string, value: number, { commit = true }: { commit?: boolean } = {}) {
  const root = byId(id);
  const thumb = thumbOf(id);
  const min = Number(thumb.getAttribute("aria-valuemin"));
  const max = Number(thumb.getAttribute("aria-valuemax"));
  const rect = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 10,
    width: 100,
    height: 10,
    x: 0,
    y: 0,
    toJSON() {},
  };
  root.getBoundingClientRect = () => rect as DOMRect;
  root
    .querySelectorAll("*")
    .forEach((el) => ((el as HTMLElement).getBoundingClientRect = () => rect as DOMRect));
  const clientX = ((value - min) / (max - min)) * rect.width;
  const opts = { bubbles: true, button: 0, clientX, clientY: 5 };
  // flushSync so the controlled value re-renders before the next event — else
  // Radix's commit-on-release sees an unchanged value and skips onValueCommit.
  flushSync(() => root.dispatchEvent(new MouseEvent("pointerdown", opts)));
  flushSync(() => root.dispatchEvent(new MouseEvent("pointermove", opts)));
  if (commit)
    flushSync(() => root.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 })));
}

interface MountOptions {
  tab?: { id: number; url: string };
  settings?: Record<string, unknown>;
  replies?: Record<string, unknown>;
  failSetKeys?: string[];
}

export interface Mounted {
  replies: Record<string, unknown>;
  sendSpy: ReturnType<typeof vi.fn>;
  saved: () => Record<string, unknown>;
  lastCall: (action: string) => Record<string, unknown> | undefined;
  emitRuntimeMessage: (msg: Record<string, unknown>, sender?: Record<string, unknown>) => void;
}

let root: Root | null = null;

export async function mountApp(opts: MountOptions = {}): Promise<Mounted> {
  if (root) {
    root.unmount();
    root = null;
  }
  document.body.innerHTML = '<div id="root"></div>';

  // Mark the first-open walkthrough as already seen so it doesn't render over the
  // popup in tests (a test can re-enable it with settings.popupGuideSeen = false).
  const chrome = createMockChrome({
    messages,
    tab: opts.tab,
    settings: { popupGuideSeen: true, ...opts.settings },
    failSetKeys: opts.failSetKeys,
  });
  const runtimeListeners: Array<
    (msg: Record<string, unknown>, sender?: Record<string, unknown>) => void
  > = [];
  chrome.runtime.onMessage.addListener = ((
    fn: (msg: Record<string, unknown>, sender?: Record<string, unknown>) => void,
  ) => {
    runtimeListeners.push(fn);
  }) as typeof chrome.runtime.onMessage.addListener;
  chrome.runtime.onMessage.removeListener = ((
    fn: (msg: Record<string, unknown>, sender?: Record<string, unknown>) => void,
  ) => {
    const i = runtimeListeners.indexOf(fn);
    if (i >= 0) runtimeListeners.splice(i, 1);
  }) as typeof chrome.runtime.onMessage.removeListener;
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = chrome;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;

  const replies: Record<string, unknown> = {
    getSpeed: { speed: 1, domain: "", channel: null, channelName: "", live: false },
    getTarget: { target: 5, scope: null, channel: null, channelName: "", live: false },
    getViewerAuto: { mode: "off", scope: null, channel: null, channelName: "" },
    getViewerState: { mode: "off" },
    setViewerState: { success: true, mode: "off" },
    getViewerFit: { mode: "contain", scope: null, channel: null, channelName: "" },
    setSpeed: { success: true, speed: undefined, live: false },
    setViewerFit: { success: true },
    ...opts.replies,
  };

  const sendSpy = vi.spyOn(chrome.tabs, "sendMessage").mockImplementation(((
    _id: number,
    msg: { action: string; speed?: number; mode?: string },
    optionsOrCb?: { frameId?: number } | ((r?: unknown) => void),
    cbArg?: (r?: unknown) => void,
  ) => {
    const cb = typeof optionsOrCb === "function" ? optionsOrCb : cbArg;
    const raw = replies[msg.action];
    const base =
      typeof raw === "function"
        ? (raw as (msg: Record<string, unknown>, chrome: typeof globalThis.chrome) => unknown)(
            msg,
            chrome,
          )
        : raw;
    // Mutating actions echo the requested value unless a test overrides it.
    const resp =
      base && msg.action === "setSpeed" && base.speed === undefined
        ? { ...base, speed: msg.speed }
        : base && msg.action === "setViewerFit" && base.mode === undefined
          ? { ...base, mode: msg.mode }
          : base;
    if (resp && typeof resp.__delayMs === "number") {
      const { __delayMs, ...delayed } = resp;
      setTimeout(() => cb?.(delayed), __delayMs);
    } else {
      cb?.(resp);
    }
  }) as unknown as typeof chrome.tabs.sendMessage) as unknown as ReturnType<typeof vi.fn>;
  const nativeRuntimeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(((
    msg: Record<string, unknown>,
    cb?: (r?: unknown) => void,
  ) => {
    if (msg.action === "whoami") {
      cb?.({ tab: opts.tab });
      return;
    }
    if (msg.action === "relayToTab" && typeof msg.tabId === "number" && msg.msg) {
      chrome.tabs.sendMessage(msg.tabId, msg.msg as Record<string, unknown>, cb);
      return;
    }
    if (msg.action === "mutateStoredMap") {
      nativeRuntimeSend(msg, cb);
      return;
    }
    cb?.(undefined);
  }) as unknown as typeof chrome.runtime.sendMessage);

  // Re-import the popup graph fresh so platform/browser's `api` binds to this mock.
  vi.resetModules();
  const { renderApp } = await import("./render-app.js");
  root = renderApp(byId("root"));
  // Settle: wait until the init round-trip (getSpeed) has fired — that means the
  // tab resolved and the cards' effects ran — then let the apply re-render flush.
  for (let i = 0; i < 20; i++) {
    await flush();
    if (sendSpy.mock.calls.some((c) => (c[1] as { action: string }).action === "getSpeed")) break;
  }
  await flush();
  // Belt and suspenders: if the walkthrough did render (e.g. a test enabled it),
  // dismiss it so the assertions run against the normal popup.
  (document.querySelector(".tour-skip") as HTMLElement | null)?.click();
  await flush();

  const saved = () => {
    let out: Record<string, unknown> = {};
    (chrome.storage.local as chrome.storage.StorageArea).get(null, (r) => (out = r));
    return out;
  };
  const lastCall = (action: string) =>
    sendSpy.mock.calls.filter((c) => (c[1] as { action: string }).action === action).at(-1)?.[1] as
      | Record<string, unknown>
      | undefined;

  const emitRuntimeMessage = (
    msg: Record<string, unknown>,
    sender: Record<string, unknown> = { tab: opts.tab },
  ) => {
    for (const fn of [...runtimeListeners]) fn(msg, sender);
  };

  return { replies, sendSpy, saved, lastCall, emitRuntimeMessage };
}
