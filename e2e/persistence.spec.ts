import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

const rate = (page: Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate);

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test("remember-site persists the speed across a reload (real chrome.storage)", async ({ page, serviceWorker }) => {
  await page.goto("/");
  await sendToContent(serviceWorker, "setSpeed", { speed: 1.5 });
  await sendToContent(serviceWorker, "rememberSite", { speed: 1.5 });
  await page.reload();
  await expect.poll(() => rate(page)).toBeCloseTo(1.5, 2);
});

test("a stored per-site speed is applied to the video on load", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { domains: { localhost: 1.25 } });
  await page.goto("/");
  await expect.poll(() => rate(page)).toBeCloseTo(1.25, 2);
});

test("an un-remembered site stays at 100%", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => rate(page)).toBe(1);
});
