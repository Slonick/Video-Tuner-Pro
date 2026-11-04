// @vitest-environment jsdom
// Extra popup-card branches the existing popup-*.test.ts don't reach: the live-
// stream lock, the SaveScope "remember" popover (open → save to a scope → the
// content-script `remember` message goes out), and the meters' guide lines.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { mountApp, byId, flush } from "./mocks/mount-popup.js";
import { createMockChrome } from "./mocks/chrome.js";
import messages from "../src/_locales/en/messages.json";
import type { UseAudioCompressor } from "../src/popup/hooks/useAudioCompressor.js";

const YT = { id: 7, url: "https://www.youtube.com/watch?v=x" };

describe("popup · live stream", () => {
  it("locks the speed card and surfaces the live warning on a stream", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: true },
      },
    });
    await flush();
    // The live warning chip is shown (display flips from none → inline-flex)…
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    // …and the speed section carries the locked class.
    expect(document.querySelector(".speed-section")!.className).toMatch(/locked/);
  });
});

// The card locks dim controls with pointer-events:none; the controls themselves must
// be disabled too, or Tab + Space/arrows still drive them.
describe("popup · locked cards disable their controls", () => {
  const thumbDisabled = (id: string) =>
    byId(id).querySelector('[role="slider"]')!.getAttribute("aria-disabled");

  it("on a stream, auto-slow's switch and sliders are disabled", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: true },
      },
    });
    expect(byId("autoSlowToggle")).toHaveProperty("disabled", true);
    expect(byId("autoSlowUp")).toHaveProperty("disabled", true);
    expect(thumbDisabled("autoSlowTarget")).toBe("true");
    expect(thumbDisabled("asFloor")).toBe("true");
    expect(byId("liveSyncToggle")).toHaveProperty("disabled", false);
  });

  it("off a stream, live-sync's switches and slider are disabled", async () => {
    await mountApp({ tab: YT });
    expect(byId("liveSyncToggle")).toHaveProperty("disabled", true);
    expect(byId("syncUp")).toHaveProperty("disabled", true);
    expect(thumbDisabled("syncTarget")).toBe("true");
    expect(byId("onStreamToggle")).toHaveProperty("disabled", true);
    expect(byId("superTheaterToggleStream")).toHaveProperty("disabled", true);
    expect(byId("autoSlowToggle")).toHaveProperty("disabled", false);
  });

  it("during a voice-over translation, the compressor's switch, presets and sliders are disabled", async () => {
    // `translating` comes from the graph poll in the full App, so render the card
    // alone — imported fresh so platform/browser's `api` binds to this mock.
    (globalThis as unknown as { chrome: unknown }).chrome = createMockChrome({ messages });
    vi.resetModules();
    const { AudioCard } = await import("../src/popup/components/AudioCard.js");
    const values = { threshold: -24, knee: 6, ratio: 4, attack: 0.003, release: 0.25 };
    const audio = {
      enabled: true,
      setEnabled: vi.fn(),
      comp: { values, animate: false },
      gain: 0,
      presets: [{ name: "Voice", ...values, pin: true }],
      activePreset: null,
      setParam: vi.fn(),
      setGain: vi.fn(),
      applyPreset: vi.fn(),
    } as unknown as UseAudioCompressor;
    document.body.innerHTML = '<div id="host"></div>';
    const root = createRoot(byId("host"));
    act(() => root.render(createElement(AudioCard, { audio, translating: true, blocked: false })));

    const preset = document.querySelector<HTMLButtonElement>(".btn-preset")!;
    preset.click();
    expect(audio.applyPreset).not.toHaveBeenCalled();
    expect(preset.disabled).toBe(true);
    expect(byId("audioCompToggle")).toHaveProperty("disabled", true);
    expect(thumbDisabled("acThreshold")).toBe("true");
    expect(thumbDisabled("acGain")).toBe("true");
    act(() => root.unmount());
  });
});

describe("popup · switch names", () => {
  it("gives every switch an accessible name", async () => {
    await mountApp({ tab: YT });
    const unnamed = [...document.querySelectorAll('[role="switch"]')]
      .filter((s) => !s.getAttribute("aria-label"))
      .map((s) => s.id);
    expect(unnamed).toEqual([]);
  });
});

describe("popup · speed step titles", () => {
  it("the Slower/Faster titles name the configured step", async () => {
    await mountApp({ tab: YT, settings: { speedStep: 10 } });
    expect(byId("speedDown").title).toBe("Slower (−10%)");
    expect(byId("speedUp").title).toBe("Faster (+10%)");
  });
});

describe("popup · protected video", () => {
  it("disables the viewer card when the active video is DRM-protected", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", drm: true },
      },
    });
    await flush();
    expect(byId("viewerAutoToggle")).toHaveProperty("disabled", true);
    expect(document.querySelector(".viewer-auto-section")!.className).toMatch(/locked/);
    expect(document.querySelector(".viewer-drm-note")?.textContent).toContain("Protected video");
  });
});

describe("popup · SaveScope remember", () => {
  it("opens the save menu and remembers the speed for a scope", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click();
    await flush();
    byId("setDefaultBtn").click(); // open the "Save for…" popover
    await flush();
    const primary = document.querySelector<HTMLElement>(".scope-menu .scope-primary");
    expect(primary).toBeTruthy();
    primary!.click(); // save the current speed for the active scope
    await flush();
    expect(lastCall("remember")).toMatchObject({ action: "remember" });
  });
});

describe("popup · graph guide lines", () => {
  // The threshold / allowed-delay sliders are <span role="slider"> widgets with no
  // form value, so the meters must draw them from the cards' state.
  it("draws the stored compressor threshold and the allowed delay on the meters", async () => {
    const drawn = new Map<string, string[]>();
    const noop = () => {};
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (this: HTMLCanvasElement) {
        const texts: string[] = [];
        drawn.set(this.id, texts);
        return {
          setTransform: noop,
          clearRect: noop,
          fillRect: noop,
          beginPath: noop,
          moveTo: noop,
          lineTo: noop,
          quadraticCurveTo: noop,
          closePath: noop,
          rect: noop,
          clip: noop,
          fill: noop,
          stroke: noop,
          save: noop,
          restore: noop,
          setLineDash: noop,
          roundRect: noop,
          fillText: (text: string) => texts.push(text),
          measureText: (text: string) => ({ width: text.length * 6 }),
          createLinearGradient: () => ({ addColorStop: noop }),
        };
      } as unknown as HTMLCanvasElement["getContext"]);
    try {
      await mountApp({
        tab: YT,
        settings: { audioCompThreshold: -30 },
        replies: {
          getTarget: { target: 7, scope: null, channel: null, channelName: "", live: true },
          getMonitor: { audio: { active: true, enabled: true, in: -12, out: -20 }, live: true },
        },
      });
      // The real rAF loop + monitor poll draw these; wait for them rather than a guess.
      await vi.waitFor(
        () => {
          expect(drawn.get("audioMeter")).toContain("−30 dB");
          expect(drawn.get("bufferMeter")).toContain("7s");
        },
        { timeout: 3000 },
      );
    } finally {
      getContext.mockRestore();
    }
  });
});
