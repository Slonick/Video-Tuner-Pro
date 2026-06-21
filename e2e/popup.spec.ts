// The popup, driven the way a user actually reaches it on a page: the on-video
// launcher opens popup.html as an in-page iframe, and the popup targets the host
// tab's video. Playwright clicks the controls inside that frame and asserts the
// real <video> responds. (The standalone popup tab can't resolve a video tab, and
// the Claude-in-Chrome MCP can't touch another extension's page at all — this is
// the faithful path.)
import { test, expect, setStorage, clearAll } from "./fixtures/extension.js";
import type { Frame, Page } from "@playwright/test";

const rate = (page: Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate);

async function openPopup(page: Page): Promise<Frame> {
  await page.goto("/overlay.html");
  await page.waitForSelector("#v");
  await page.mouse.move(400, 300);
  await page.keyboard.press("KeyO"); // overlay hotkey — opens the popup iframe
  await page.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  let frame: Frame | undefined;
  await expect
    .poll(() => {
      frame = page.frames().find((f) => f.url().includes("/popup/popup.html"));
      return !!frame;
    })
    .toBe(true);
  await frame!.locator("#speedUp").waitFor();
  return frame!;
}

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
  // Past the first-open walkthrough — its modal overlay would otherwise intercept
  // every click on the popup's controls.
  await setStorage(serviceWorker, { popupGuideSeen: true });
});

test("a quick-row preset sets the video speed", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator('.btn-speed[data-percent="175"]').click(); // a default-pinned preset
  await expect.poll(() => rate(page)).toBeCloseTo(1.75, 2);
});

test("the +/− steppers and reset drive the video", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator("#speedUp").click(); // +5%
  await expect.poll(() => rate(page)).toBeCloseTo(1.05, 2);
  await popup.locator("#speedUp").click();
  await popup.locator("#speedDown").click();
  await expect.poll(() => rate(page)).toBeCloseTo(1.05, 2);
  await popup.locator("#speedReset").click(); // back to the resolved (no-save) 1×
  await expect.poll(() => rate(page)).toBeCloseTo(1.0, 2);
});

test("the slider sets the video speed", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  const thumb = popup.locator("#speedSlider [role=slider]");
  await thumb.focus();
  await thumb.press("Home"); // → 25%
  await expect.poll(() => rate(page)).toBeCloseTo(0.25, 2);
});

test("the popup reflects a custom max-speed from options", async ({ page, serviceWorker }) => {
  // speedMax governs the slider's range; End must reach the configured ceiling.
  await setStorage(serviceWorker, { overlayButton: "always", speedMax: 300 });
  const popup = await openPopup(page);
  const thumb = popup.locator("#speedSlider [role=slider]");
  await expect(thumb).toHaveAttribute("aria-valuemax", "300");
  await thumb.focus();
  await thumb.press("End");
  await expect.poll(() => rate(page)).toBeCloseTo(3.0, 2);
});

test("Escape closes the overlay popup", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  await openPopup(page);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const f = document
          .querySelector("[data-vtp-launcher]")
          ?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null;
        return !!f && getComputedStyle(f).display !== "none";
      }),
    )
    .toBe(false);
});
