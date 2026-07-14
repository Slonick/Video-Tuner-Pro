// Drives the real options page (chrome-extension://…/options/options.html) the way
// a user would — clicking every control — and asserts the resulting chrome.storage
// writes (and, where it propagates live, the effect on a video tab). Playwright is
// the browser driver, so it can click extension pages that another extension cannot.
import {
  test,
  expect,
  readStored,
  clearAll,
  openExtensionPage,
  setStorage,
} from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

const OPTIONS = "options/options.html";

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
});

// A focused range thumb honours Home/End → its min/max, deterministically, no matter
// the step. Returns after the commit has had a chance to persist.
async function sliderTo(page: Page, sliderLocator: string, edge: "Home" | "End") {
  const thumb = page.locator(`${sliderLocator} [role="slider"]`);
  await thumb.focus();
  await thumb.press(edge);
}

test.describe("Options · General", () => {
  test("theme radios persist the chosen theme", async ({ context, extensionId, serviceWorker }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    const radios = page.locator("#themeSeg [role=radio]"); // [system, light, dark]
    await radios.nth(2).click();
    await expect.poll(async () => (await readStored(serviceWorker, "theme")).theme).toBe("dark");
    await radios.nth(1).click();
    await expect.poll(async () => (await readStored(serviceWorker, "theme")).theme).toBe("light");
  });

  test("on-video button mode persists", async ({ context, extensionId, serviceWorker }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    const radios = page.locator("#overlayBtnSeg [role=radio]"); // [off, fullscreen, always]
    await radios.nth(2).click();
    await expect
      .poll(async () => (await readStored(serviceWorker, "overlayButton")).overlayButton)
      .toBe("always");
    await radios.nth(0).click();
    await expect
      .poll(async () => (await readStored(serviceWorker, "overlayButton")).overlayButton)
      .toBe("off");
  });

  test("viewer auto-open default and SponsorBlock markers persist", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#viewerAutoSeg [role=radio]").nth(2).click(); // theater
    const sponsor = page.getByRole("switch", { name: /SponsorBlock/i });
    await sponsor.click();

    await expect
      .poll(async () => readStored(serviceWorker, ["viewerAutoGlobal", "sponsorMarks"]))
      .toEqual({ viewerAutoGlobal: "theater", sponsorMarks: true });
  });

  test("language selection survives the options-page reload", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    const radios = page.locator("#langGrid [role=radio]"); // system, en, ru, ...
    await radios.nth(2).click();
    await expect.poll(async () => (await readStored(serviceWorker, "uiLang")).uiLang).toBe("ru");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#langGrid [role=radio]").nth(2)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("glass-opacity slider persists min/max via Home/End", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await sliderTo(page, "#glassOpacity", "End");
    await expect
      .poll(async () => (await readStored(serviceWorker, "glassOpacity")).glassOpacity)
      .toBeCloseTo(1.4, 2);
    await sliderTo(page, "#glassOpacity", "Home");
    await expect
      .poll(async () => (await readStored(serviceWorker, "glassOpacity")).glassOpacity)
      .toBeCloseTo(0.3, 2);
  });

  test("force-speed toggle persists", async ({ context, extensionId, serviceWorker }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-speed").click(); // Force speed lives under the Speed group
    await expect
      .poll(async () => (await readStored(serviceWorker, "forceRate")).forceRate)
      .toBe(undefined);
    await page.locator("#forceRateToggle").click();
    await expect
      .poll(async () => (await readStored(serviceWorker, "forceRate")).forceRate)
      .toBe(true);
  });

  test("backup export downloads a JSON of the current settings", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setStorage(serviceWorker, { globalSpeed: 1.6 });
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Backup lives under the Data group
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#exportBtn").click(),
    ]);
    expect(download.suggestedFilename()).toBe("video-tuner-pro-settings.json");
    const stream = await download.createReadStream();
    const text = await new Promise<string>((resolve, reject) => {
      let s = "";
      stream.on("data", (c) => (s += c));
      stream.on("end", () => resolve(s));
      stream.on("error", reject);
    });
    expect(JSON.parse(text).globalSpeed).toBeCloseTo(1.6, 2);
  });

  test("backup import writes the file's settings and reloads", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Backup lives under the Data group
    await page.locator("#importBtn").click(); // opens the hidden file picker (no-op for us)
    await page.locator("input[type=file]").setInputFiles({
      name: "settings.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ globalSpeed: 1.33 })),
    });
    await expect
      .poll(async () => (await readStored(serviceWorker, "globalSpeed")).globalSpeed)
      .toBeCloseTo(1.33, 2);
  });

  test("invalid backup import is rejected without damaging existing settings", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setStorage(serviceWorker, { globalSpeed: 1.6 });
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click();
    await page.locator("input[type=file]").setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{ definitely not json"),
    });
    await expect(page.locator("#importBtn")).toHaveClass(/btn-err/);
    expect((await readStored(serviceWorker, "globalSpeed")).globalSpeed).toBeCloseTo(1.6, 2);
  });
});

test.describe("Options · Keys", () => {
  test("remapping an action persists and takes effect on a live video", async ({
    context,
    extensionId,
    serviceWorker,
    page,
  }) => {
    await page.goto("/"); // a video tab the remap must reach via storage.onChanged
    const opt = await openExtensionPage(context, extensionId, OPTIONS);
    await opt.locator("#nav-speed").click(); // Keys lives under the Speed group
    await opt.locator("#keyFaster").click(); // arm capture
    await opt.keyboard.press("KeyK"); // bind "faster" → K
    await expect
      .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
      .toMatchObject({ faster: "KeyK" });

    await page.bringToFront();
    await page.locator("#v").click();
    await page.keyboard.press("KeyK");
    await expect
      .poll(() =>
        page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate),
      )
      .toBeCloseTo(1.05, 2);
  });

  test("a duplicate key is rejected", async ({ context, extensionId, serviceWorker }) => {
    const opt = await openExtensionPage(context, extensionId, OPTIONS);
    await opt.locator("#nav-speed").click(); // Keys lives under the Speed group
    await opt.locator("#keyReset").click();
    await opt.keyboard.press("KeyA"); // KeyA already belongs to "slower" → rejected
    // reset keeps its default; give the rejection flash time to settle.
    await opt.waitForTimeout(300);
    expect((await readStored(serviceWorker, "keymap")).keymap ?? {}).not.toMatchObject({
      reset: "KeyA",
    });
  });

  test("Backspace unbinds an action", async ({ context, extensionId, serviceWorker }) => {
    const opt = await openExtensionPage(context, extensionId, OPTIONS);
    await opt.locator("#nav-speed").click(); // Keys lives under the Speed group
    await opt.locator("#keyToggle").click();
    await opt.keyboard.press("Backspace");
    await expect
      .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
      .toMatchObject({ toggle: "" });
  });

  test("the per-action switch turns it off then restores it", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const opt = await openExtensionPage(context, extensionId, OPTIONS);
    await opt.locator("#nav-speed").click(); // Keys lives under the Speed group
    const slowerSwitch = opt.locator("#keyRows .key-row").first().locator("[role=switch]");
    await slowerSwitch.click(); // off
    await expect
      .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
      .toMatchObject({ slower: "" });
    await slowerSwitch.click(); // on → restored to the default A
    await expect
      .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
      .toMatchObject({ slower: "KeyA" });
  });

  test("reset-to-defaults restores the full keymap", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setStorage(serviceWorker, { keymap: { faster: "KeyK", slower: "KeyA" } });
    const opt = await openExtensionPage(context, extensionId, OPTIONS);
    await opt.locator("#nav-speed").click(); // Keys lives under the Speed group
    const reset = opt.locator("#keyRows ~ .card-actions .confirm-btn");
    await reset.click(); // arm
    await reset.click(); // confirm
    await expect
      .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
      .toMatchObject({ faster: "KeyD", slower: "KeyA", reset: "KeyR", toggle: "KeyS" });
  });
});

test.describe("Options · Auto-slow", () => {
  test("the five global knobs persist their extremes", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-audio").click(); // Auto-slow lives under the Audio group
    await sliderTo(page, "#autoSlowFloor", "Home"); // 50% → 0.5
    await sliderTo(page, "#autoSlowKnee", "End"); // ±2 /s
    await sliderTo(page, "#autoSlowHold", "End"); // 4 s
    await sliderTo(page, "#autoSlowReaction", "End"); // 100%
    await sliderTo(page, "#autoSlowEaseBack", "End"); // 100%
    await expect
      .poll(async () =>
        readStored(serviceWorker, [
          "autoSlowFloor",
          "autoSlowKnee",
          "autoSlowHold",
          "autoSlowReaction",
          "autoSlowEaseBack",
        ]),
      )
      .toEqual({
        autoSlowFloor: 0.5,
        autoSlowKnee: 2,
        autoSlowHold: 4,
        autoSlowReaction: 100,
        autoSlowEaseBack: 100,
      });
  });
});

test.describe("Options · Sync", () => {
  test("the master switch disables the per-category rows", async ({ context, extensionId }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Sync lives under the Data group
    const firstCat = page.locator("#syncRows .sync-cat-row [role=switch]").first();
    await expect(firstCat).toBeEnabled();
    await page.locator("#syncMaster [role=switch]").click(); // master off
    await expect(page.locator("#syncRows")).toHaveClass(/is-off/);
    await expect(firstCat).toBeDisabled();
  });

  test("a category switch toggles off", async ({ context, extensionId }) => {
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Sync lives under the Data group
    const firstCat = page.locator("#syncRows .sync-cat-row [role=switch]").first();
    await expect(firstCat).toHaveAttribute("aria-checked", "true");
    await firstCat.click();
    await expect(firstCat).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("Options · Saved", () => {
  test("renders saved speeds and deletes a single one", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setStorage(serviceWorker, { domains: { "example.com": 1.5 }, globalSpeed: 1.25 });
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Saved lives under the Data group
    await expect(page.locator("#savedLists")).toContainText("example.com");
    await page.locator(".saved-row", { hasText: "example.com" }).locator(".saved-del").click();
    await expect
      .poll(async () => (await readStored(serviceWorker, "domains")).domains)
      .toBeUndefined();
    // The global speed is untouched.
    expect((await readStored(serviceWorker, "globalSpeed")).globalSpeed).toBeCloseTo(1.25, 2);
  });

  test("reset clears every saved speed", async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      domains: { "a.com": 1.5 },
      channels: { "twitch:foo": 2 },
      globalSpeed: 1.25,
    });
    const page = await openExtensionPage(context, extensionId, OPTIONS);
    await page.locator("#nav-data").click(); // Saved lives under the Data group
    // The first category (speeds) reset button.
    const speedsReset = page.locator(".saved-cat").first().locator(".card-actions .confirm-btn");
    await speedsReset.click();
    await speedsReset.click();
    await expect
      .poll(async () => readStored(serviceWorker, ["domains", "channels", "globalSpeed"]))
      .toEqual({});
  });
});
