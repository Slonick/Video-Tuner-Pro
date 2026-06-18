import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

// The on-video badge renders inside a shadow root on a marked host in the light
// DOM (document.querySelector doesn't pierce shadow roots, so go via shadowRoot).
const badge = (page: Page) => page.evaluate(() => {
  const host = document.querySelector("[data-vtp-badge]");
  const el = host?.shadowRoot?.querySelector("div");
  return el ? { text: el.textContent, opacity: (el as HTMLElement).style.opacity } : null;
});

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test("the on-video badge appears and shows the current speed", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { showRemaining: true });
  await page.goto("/");
  await page.locator("#v").click();
  await page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}));
  await page.waitForFunction(() => {
    const v = document.getElementById("v") as HTMLVideoElement;
    return v && isFinite(v.duration) && v.duration > 0;
  });
  // Reveal it by moving the pointer over the video.
  await page.mouse.move(320, 180);
  await expect.poll(async () => (await badge(page))?.text).toMatch(/×\s*·/);
});

test("the badge reflects a speed change", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { showRemaining: true });
  await page.goto("/");
  await page.locator("#v").click();
  await page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}));
  await sendToContent(serviceWorker, "setSpeed", { speed: 2 });
  await page.mouse.move(320, 180);
  await expect.poll(async () => (await badge(page))?.text).toMatch(/^2×/);
});
