// One end-to-end user journey across every surface: configure in the options page,
// see the content script honour it live, drive the in-page popup, and confirm it all
// survives a reload through real chrome.storage. If the wiring between options ⇄
// storage ⇄ content ⇄ popup ever breaks, this is the test that catches it.
import {
  test,
  expect,
  readStored,
  clearAll,
  openExtensionPage,
  sendToContent,
  setStorage,
} from "./fixtures/extension.js";
import type { Frame, Page } from "@playwright/test";

const rate = (page: Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate);

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
  // Skip the popup's first-open walkthrough (its modal would intercept clicks).
  await setStorage(serviceWorker, { popupGuideSeen: true });
});

test("configure in options → use via popup → persist across reload", async ({
  context,
  extensionId,
  serviceWorker,
  page,
}) => {
  // 1. Fresh install: a video sits at 1×.
  await page.goto("/overlay.html");
  await expect.poll(() => rate(page)).toBe(1);

  // 2. In the options page: surface the on-video button, double the step, and remap
  //    "faster" to K.
  const opt = await openExtensionPage(context, extensionId, "options/options.html");
  await opt.locator("#overlayBtnSeg [role=radio]").nth(2).click(); // always (General pane)
  await opt.locator("#nav-speed").click(); // step + key remap live under the Speed group
  const stepThumb = opt
    .locator("section.opt-group", { has: opt.locator(".preset-rows") })
    .locator(".opt-params-grid .opt-param")
    .nth(1)
    .locator("[role=slider]");
  await stepThumb.focus();
  await stepThumb.press("End"); // step → 50%
  await opt.locator("#keyFaster").click();
  await opt.keyboard.press("KeyK"); // faster → K
  await expect
    .poll(async () => readStored(serviceWorker, ["overlayButton", "speedStep"]))
    .toEqual({ overlayButton: "always", speedStep: 50 });
  await expect
    .poll(async () => (await readStored(serviceWorker, "keymap")).keymap)
    .toMatchObject({ faster: "KeyK" });

  // 3. The content script picks the remap + step up live (no reload): K now adds 50%.
  await page.bringToFront();
  await page.locator("#v").click();
  await page.keyboard.press("KeyK");
  await expect.poll(() => rate(page)).toBeCloseTo(1.5, 2);

  // 4. Open the in-page popup and pick a quick-row preset — it overrides the speed.
  await page.mouse.move(400, 300);
  await page.keyboard.press("KeyO");
  await page.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  let popup: Frame | undefined;
  await expect
    .poll(() => {
      popup = page.frames().find((f) => f.url().includes("/popup/popup.html"));
      return !!popup;
    })
    .toBe(true);
  await popup!.locator("#speedUp").waitFor();
  await expect(popup!.locator("#currentSpeedPct")).toContainText("150%");
  const preset175 = popup!.locator('.btn-speed[data-percent="175"]');
  await expect(preset175).toBeEnabled();
  await preset175.click(); // a default-pinned preset
  // The media element is the authoritative outcome; assert it before the
  // animated readout so a throttled iframe animation cannot hide a messaging
  // failure (or misdiagnose a working command as one).
  await expect.poll(() => rate(page)).toBeCloseTo(1.75, 2);
  await expect(popup!.locator("#currentSpeedPct")).toContainText("175%");

  // 5. Remember it for this site (the popup's Save contract), then reload.
  await sendToContent(serviceWorker, "remember", { scope: "site", speed: 1.75 });
  await page.reload();

  // 6. The saved per-site speed is re-applied on load…
  await expect.poll(() => rate(page)).toBeCloseTo(1.75, 2);
  // …and the remapped key still works after the reload (storage-backed).
  await page.locator("#v").click();
  await page.keyboard.press("KeyK"); // +50%
  await expect.poll(() => rate(page)).toBeCloseTo(2.25, 2);
});
