// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";
import { scenario } from "./mocks/scenarios.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id)!;
// Toggles are Radix Switches (role="switch" buttons), not checkboxes.
const isOn = (id: string) => byId(id).getAttribute("aria-checked") === "true";
const tick = () => new Promise((r) => setTimeout(r, 50));

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html
    .replace(/[\s\S]*<body>/, "")
    .replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
  (globalThis as unknown as { chrome: typeof chrome }).chrome = createMockChrome({
    ...scenario("audio"),
    messages,
  });

  // Import the popup entry AFTER the DOM + chrome exist → runs the whole popup.
  await import("../src/popup/index.js");
  await tick();
});

describe("popup integration", () => {
  it("renders localized section text", () => {
    expect(document.body.textContent).toContain("Latency");
    expect(document.body.textContent).toContain("Audio compression");
  });

  it("localizes tooltips via msg()", () => {
    expect(byId("speedDown").title).toBe("Slower (−5%)");
    expect(byId("speedReset").title).toBe("Reset to the saved speed");
  });

  it("reflects the current speed from the page", () => {
    expect(byId("currentSpeedPct").textContent).toBe("100%");
  });

  it("shows the extension version in the header", () => {
    expect(byId("extVersion").textContent).toBe("v0.0.0");
  });

  it("reflects stored settings in the toggles", () => {
    expect(isOn("audioCompToggle")).toBe(true);
    expect(isOn("liveSyncToggle")).toBe(true);
    expect(isOn("onVideoToggle")).toBe(true);
  });

  // Interaction behaviour (presets, sliders, scopes) is covered deterministically
  // in popup-speed / popup-audio-settings via mountApp — this file only smoke-tests
  // that the entry wires the page up.
});
