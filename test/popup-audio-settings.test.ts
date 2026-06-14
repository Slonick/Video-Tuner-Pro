// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;
const valOf = (id: string) => document.getElementById(id + "Val")?.textContent;

// Imported dynamically AFTER the DOM + chrome exist — the module wires up its
// listeners at load time and would throw against an empty document.
let loadAudioSettings: () => void;

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
  const chrome = createMockChrome({ messages });
  (globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;

  ({ loadAudioSettings } = await import("../src/popup/audio-settings.js"));
});

// Read back what the popup persisted (the mock applies set() synchronously).
function saved(): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  (globalThis.chrome.storage.sync as unknown as { get: (k: null, cb: (r: Record<string, unknown>) => void) => void })
    .get(null, (r) => (out = r));
  return out;
}

describe("loadAudioSettings reflects stored values", () => {
  it("formats each param into its slider + readout", () => {
    globalThis.chrome.storage.sync.set({
      audioComp: true, audioCompThreshold: -40, audioCompKnee: 25, audioCompRatio: 6,
      audioCompAttack: 0.02, audioCompRelease: 0.5, audioCompGain: 12,
    });
    loadAudioSettings();
    expect(byId("audioCompToggle").checked).toBe(true);
    expect(byId("acThreshold").value).toBe("-40");
    expect(valOf("acThreshold")).toBe("-40 dB");
    expect(valOf("acRatio")).toBe("6:1");
    expect(valOf("acAttack")).toBe("20 ms");   // 0.02 s → 20 ms
    expect(valOf("acGain")).toBe("12 dB");
  });

  it("clamps out-of-range stored values to the slider bounds", () => {
    globalThis.chrome.storage.sync.set({ audioCompGain: 999, audioCompRatio: 0 });
    loadAudioSettings();
    expect(byId("acGain").value).toBe("24");   // gain cap
    expect(byId("acRatio").value).toBe("1");    // ratio floor
  });
});

describe("compressor preset leaves make-up gain untouched", () => {
  it("fills the comp sliders, turns compression on, but never overwrites gain", () => {
    byId("audioCompToggle").checked = false;
    byId("acGain").value = "18";
    document.querySelector<HTMLElement>('.btn-preset[data-preset="movie"]')!.click();
    expect(byId("acThreshold").value).toBe("-28");
    expect(byId("acRatio").value).toBe("8");
    expect(byId("acGain").value).toBe("18");        // the manual control is preserved
    expect(byId("audioCompToggle").checked).toBe(true);
  });
});

describe("slider + toggle persistence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("updates the readout live and saves the param after the 350 ms debounce", () => {
    const ratio = byId("acRatio");
    ratio.value = "12";
    ratio.dispatchEvent(new Event("input"));
    expect(valOf("acRatio")).toBe("12:1");          // immediate
    vi.advanceTimersByTime(350);
    expect(saved().audioCompRatio).toBe(12);        // persisted
  });

  it("saves make-up gain on its own key, independent of the presets", () => {
    const gain = byId("acGain");
    gain.value = "9";
    gain.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(350);
    expect(saved().audioCompGain).toBe(9);
  });

  it("merges rapid different-key writes instead of clobbering them", () => {
    byId("acRatio").value = "5"; byId("acRatio").dispatchEvent(new Event("input"));
    byId("acKnee").value = "10"; byId("acKnee").dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(350);
    const s = saved();
    expect(s.audioCompRatio).toBe(5);
    expect(s.audioCompKnee).toBe(10);
  });

  it("the toggle persists the audioComp flag", () => {
    const t = byId("audioCompToggle");
    t.checked = false;
    t.dispatchEvent(new Event("change"));
    expect(saved().audioComp).toBe(false);
  });
});
