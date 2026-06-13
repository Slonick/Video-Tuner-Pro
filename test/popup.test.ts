// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";
import { scenario } from "./mocks/scenarios.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id)!;
const tick = () => new Promise((r) => setTimeout(r, 50));

let sendSpy: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
  (globalThis as unknown as { chrome: typeof chrome }).chrome = createMockChrome({ ...scenario("audio"), messages });

  // Import the popup entry AFTER the DOM + chrome exist → runs the whole popup.
  await import("../src/popup/index.js");
  await tick();
  sendSpy = vi.spyOn(globalThis.chrome.tabs, "sendMessage") as unknown as ReturnType<typeof vi.fn>;
});

describe("popup integration", () => {
  it("localizes [data-i18n] elements", () => {
    expect(document.querySelector('[data-i18n="meterLatency"]')?.textContent).toBe("Latency");
    expect(document.querySelector('[data-i18n="audioTitle"]')?.textContent).toBe("Audio compression");
  });

  it("reflects the current speed from the page", () => {
    expect(byId("currentSpeedPct").textContent).toBe("100%");
  });

  it("shows the extension version in the header", () => {
    expect(byId("extVersion").textContent).toBe("v0.0.0");
  });

  it("reflects stored settings in the toggles", () => {
    expect((byId("audioCompToggle") as HTMLInputElement).checked).toBe(true);
    expect((byId("liveSyncToggle") as HTMLInputElement).checked).toBe(true);
    expect((byId("onVideoToggle") as HTMLInputElement).checked).toBe(true);
  });

  it("a preset button applies the speed to the page", () => {
    const btn = document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!;
    btn.click();
    expect(byId("currentSpeedPct").textContent).toBe("150%");
    const calls = sendSpy.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual(expect.objectContaining({ action: "setSpeed", speed: 1.5 }));
  });
});
