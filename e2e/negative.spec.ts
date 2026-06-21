import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

// Guard tests: assert the extension does NOT do what it shouldn't.
const rate = (page: Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement | null)?.playbackRate);
// The badge renders inside a shadow root on a marked host — pierce it (a plain
// document query never sees shadow content, which would make this trivially pass).
const hasBadge = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-vtp-badge]")?.shadowRoot?.querySelector("div");
    return !!el && /×/.test(el.textContent || "");
  });

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

test("ignores keyboard shortcuts while typing in a field", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "f";
    document.body.appendChild(i);
    i.focus();
  });
  await page.keyboard.press("KeyD");
  await page.keyboard.press("KeyD");
  expect(await rate(page)).toBe(1); // unchanged
});

test("ignores shortcuts combined with a modifier key", async ({ page }) => {
  await page.goto("/");
  await page.locator("#v").click();
  await page.keyboard.press("Control+KeyD");
  await page.keyboard.press("Alt+KeyD");
  await page.keyboard.press("Meta+KeyD");
  expect(await rate(page)).toBe(1);
});

test("does nothing and doesn't crash on a page with no video", async ({ page, serviceWorker }) => {
  await page.goto("/blank.html");
  await page.locator("body").click();
  await page.keyboard.press("KeyD");
  // The content script is still alive and answers, with no speed applied.
  const resp = (await sendToContent(serviceWorker, "getSpeed")) as { speed: number };
  expect(resp.speed).toBe(1);
});

test("clamps an out-of-range speed instead of applying it verbatim", async ({
  page,
  serviceWorker,
}) => {
  await page.goto("/");
  const hi = (await sendToContent(serviceWorker, "setSpeed", { speed: 99 })) as { speed: number };
  expect(hi.speed).toBeLessThanOrEqual(16);
  expect(await rate(page)).toBeLessThanOrEqual(16);
  const lo = (await sendToContent(serviceWorker, "setSpeed", { speed: 0.001 })) as {
    speed: number;
  };
  expect(lo.speed).toBeGreaterThanOrEqual(0.1);
});

test("a live stream refuses a manual speed change", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { liveSync: false }); // hold the stream at 100%, no catch-up
  await page.goto("/live.html");
  await page.waitForFunction(() => {
    const v = document.getElementById("v") as HTMLVideoElement;
    return !!v && v.readyState >= 2 && v.duration === Infinity;
  });
  const resp = (await sendToContent(serviceWorker, "setSpeed", { speed: 1.5 })) as {
    speed: number;
    live: boolean;
  };
  expect(resp.live).toBe(true);
  expect(resp.speed).not.toBeCloseTo(1.5, 2); // manual change refused — live is owned by sync
});

test("the badge does NOT appear when the on-video display is off", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { showRemaining: false });
  await page.goto("/");
  await page.locator("#v").click();
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );
  await page.mouse.move(320, 180);
  await page.waitForTimeout(1500); // give the 1s badge tick a chance to (not) show it
  expect(await hasBadge(page)).toBe(false);
});
