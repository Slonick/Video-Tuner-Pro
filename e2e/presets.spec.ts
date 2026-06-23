// Options · Speed presets + Compressor presets — the two editable list sections.
// Exercises every kind of control: range sliders (via Home/End), number inputs,
// name fields, pins, hotkey capture, add/remove, reset — asserting the chrome.storage
// the popup + content script read back.
import {
  test,
  expect,
  readStored,
  clearAll,
  openExtensionPage,
  setStorage,
} from "./fixtures/extension.js";
import type { BrowserContext, Locator, Page } from "@playwright/test";

const OPTIONS = "options/options.html";

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
});

async function edge(locator: Locator, key: "Home" | "End") {
  const thumb = locator.locator('[role="slider"]');
  await thumb.focus();
  await thumb.press(key);
}

function speedSection(page: Page) {
  return page.locator("section.opt-group", { has: page.locator(".preset-rows") });
}
function compSection(page: Page) {
  return page.locator("section.opt-group", { has: page.locator("#presetEditors") });
}

// Speed presets live under the Speed nav group, compressor presets under Audio —
// both panes are hidden until their sidebar item is selected.
async function openSpeed(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openExtensionPage(context, extensionId, OPTIONS);
  await page.locator("#nav-speed").click();
  return page;
}
async function openAudio(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openExtensionPage(context, extensionId, OPTIONS);
  await page.locator("#nav-audio").click();
  return page;
}

test.describe("Options · Speed presets", () => {
  test("max-speed / step / hold sliders persist their extremes", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSpeed(context, extensionId);
    const params = speedSection(page).locator(".opt-params-grid .opt-param");
    await edge(params.nth(0), "End"); // max → 1600
    await edge(params.nth(1), "End"); // step → 50
    await edge(params.nth(2), "End"); // hold → speedMax (1600 after the line above)
    await expect
      .poll(async () => readStored(serviceWorker, ["speedMax", "speedStep", "holdSpeed"]))
      .toEqual({ speedMax: 1600, speedStep: 50, holdSpeed: 1600 });
  });

  test("the step setting changes the keyboard increment on a live video", async ({
    context,
    extensionId,
    serviceWorker,
    page,
  }) => {
    await page.goto("/");
    const opt = await openSpeed(context, extensionId);
    await edge(speedSection(opt).locator(".opt-params-grid .opt-param").nth(1), "End"); // step 50%
    await expect
      .poll(async () => (await readStored(serviceWorker, "speedStep")).speedStep)
      .toBe(50);
    await page.bringToFront();
    await page.locator("#v").click();
    await page.keyboard.press("KeyD"); // +50%
    await expect
      .poll(() =>
        page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate),
      )
      .toBeCloseTo(1.5, 2);
  });

  test("editing a preset value re-sorts and persists", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSpeed(context, extensionId);
    const first = speedSection(page).locator(".preset-rows input[type=number]").first();
    await first.fill("30");
    await first.press("Enter");
    await expect
      .poll(
        async () => ((await readStored(serviceWorker, "speedPresets")).speedPresets as number[])[0],
      )
      .toBe(30);
  });

  test("adding a preset grows the list", async ({ context, extensionId, serviceWorker }) => {
    const page = await openSpeed(context, extensionId);
    const before = speedSection(page).locator(".preset-row");
    await expect(before).toHaveCount(12); // DEFAULT_PRESETS
    await speedSection(page).getByText("Add preset").click();
    await expect(before).toHaveCount(13);
    await expect
      .poll(
        async () =>
          ((await readStored(serviceWorker, "speedPresets")).speedPresets as number[]).length,
      )
      .toBe(13);
  });

  test("pinning a preset records it in presetPins", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSpeed(context, extensionId);
    const firstPin = speedSection(page).locator(".preset-row .preset-pin").first();
    expect(await firstPin.getAttribute("aria-pressed")).toBe("false"); // 25% isn't a default pin
    await firstPin.click();
    await expect
      .poll(
        async () => ((await readStored(serviceWorker, "presetPins")).presetPins as boolean[])[0],
      )
      .toBe(true);
  });

  test("assigning a hotkey to a preset persists the chord", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSpeed(context, extensionId);
    await speedSection(page).locator(".preset-row .preset-key").first().click();
    await page.keyboard.press("KeyG");
    await expect
      .poll(async () => ((await readStored(serviceWorker, "presetKeys")).presetKeys as string[])[0])
      .toBe("KeyG");
  });

  test("reset restores the default preset set", async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { speedPresets: [42], presetKeys: [null], presetPins: [true] });
    const page = await openSpeed(context, extensionId);
    const reset = speedSection(page).locator(".card-actions .btn-danger");
    await reset.click();
    await reset.click();
    await expect
      .poll(async () => (await readStored(serviceWorker, "speedPresets")).speedPresets)
      .toEqual([25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 1600]);
  });
});

test.describe("Options · Compressor presets", () => {
  test("global gain persists to both the base and the live value", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openAudio(context, extensionId);
    await edge(compSection(page).locator(".opt-param").first(), "End"); // global gain → 24
    await expect
      .poll(async () => readStored(serviceWorker, ["audioCompBaseGain", "audioCompGain"]))
      .toEqual({ audioCompBaseGain: 24, audioCompGain: 24 });
  });

  test("editing a compressor parameter persists into compPresets", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openAudio(context, extensionId);
    await edge(compSection(page).locator(".comp-detail .opt-param").nth(0), "Home"); // threshold → -100
    await expect
      .poll(
        async () =>
          (
            (await readStored(serviceWorker, "compPresets")).compPresets as Array<{
              threshold: number;
            }>
          )[0].threshold,
      )
      .toBe(-100);
  });

  test("renaming a preset persists the custom name", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openAudio(context, extensionId);
    await compSection(page).locator(".preset-name-input").fill("My Voice");
    await expect
      .poll(
        async () =>
          (
            (await readStored(serviceWorker, "compPresets")).compPresets as Array<{ name?: string }>
          )[0].name,
      )
      .toBe("My Voice");
  });

  test("adding a compressor preset grows the list", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openAudio(context, extensionId);
    const rows = compSection(page).locator(".comp-list-row");
    await expect(rows).toHaveCount(3); // the three shipped defaults have loaded
    await compSection(page).locator(".comp-list-add").click();
    await expect(rows).toHaveCount(4);
    await expect
      .poll(
        async () =>
          ((await readStored(serviceWorker, "compPresets")).compPresets as unknown[]).length,
      )
      .toBe(4);
  });

  test("the make-up-gain override switch adds a per-preset gain", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openAudio(context, extensionId);
    await compSection(page).locator(".comp-detail [role=switch]").click();
    await expect
      .poll(
        async () =>
          (
            (await readStored(serviceWorker, "compPresets")).compPresets as Array<{ gain?: number }>
          )[0].gain,
      )
      .not.toBe(undefined);
  });

  test("reset restores the three default compressor presets", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setStorage(serviceWorker, {
      compPresets: [{ threshold: -10, knee: 0, ratio: 2, attack: 0, release: 0.5, pin: true }],
    });
    const page = await openAudio(context, extensionId);
    const reset = compSection(page).locator(".comp-actions .btn-danger");
    await reset.click();
    await reset.click();
    // Reset removes the stored override entirely, so the shipped three defaults apply.
    await expect
      .poll(async () => (await readStored(serviceWorker, "compPresets")).compPresets)
      .toBe(undefined);
    await expect(compSection(page).locator(".comp-list-row")).toHaveCount(3);
  });
});
