import { test, expect, sendToContent, clearStorage } from "./fixtures/extension.js";

const rate = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate);

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test("the extension loads and the content script controls the page video", async ({ page }) => {
  await page.goto("/");
  // Content script runs at document_start and applies the default 1× speed.
  await expect.poll(() => rate(page)).toBe(1);
});

test("keyboard shortcuts change the video playback rate", async ({ page }) => {
  await page.goto("/");
  await page.locator("#v").click(); // focus + a user gesture
  await page.keyboard.press("KeyD"); // +5%
  await expect.poll(() => rate(page)).toBeCloseTo(1.05, 2);
  await page.keyboard.press("KeyD"); // +5%
  await expect.poll(() => rate(page)).toBeCloseTo(1.10, 2);
  await page.keyboard.press("KeyA"); // -5%
  await expect.poll(() => rate(page)).toBeCloseTo(1.05, 2);
  await page.keyboard.press("KeyR"); // reset
  await expect.poll(() => rate(page)).toBeCloseTo(1.0, 2);
});

test("a setSpeed message (the popup's contract) applies to the video", async ({ page, serviceWorker }) => {
  await page.goto("/");
  const resp = await sendToContent(serviceWorker, "setSpeed", { speed: 1.5 }) as { success: boolean; speed: number };
  expect(resp.success).toBe(true);
  expect(resp.speed).toBeCloseTo(1.5, 5);
  await expect.poll(() => rate(page)).toBeCloseTo(1.5, 2);
});
