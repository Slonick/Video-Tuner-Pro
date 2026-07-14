import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

// The on-video badge renders inside a shadow root on a marked host in the light
// DOM (document.querySelector doesn't pierce shadow roots, so go via shadowRoot).
const badge = (page: Page) =>
  page.evaluate(() => {
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
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );
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
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );
  await sendToContent(serviceWorker, "setSpeed", { speed: 2 });
  await page.mouse.move(320, 180);
  await expect.poll(async () => (await badge(page))?.text).toMatch(/^2×/);
});

test("a player attaching its shadow root after load is detected immediately", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { showRemaining: true });
  await page.goto("/late-shadow.html");
  await page.waitForFunction(() =>
    document.getElementById("late-player")?.shadowRoot?.querySelector("video"),
  );

  // The old reconcile fallback takes 30 seconds on a media-free page. Keep this
  // assertion tight so a regression cannot masquerade as a merely slow player.
  await expect(page.locator("[data-vtp-badge]")).toBeAttached({ timeout: 3000 });
});

test("a detached player host populated after insertion is detected immediately", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { showRemaining: true });
  await page.goto("/detached-shadow.html");
  await page.waitForFunction(() =>
    document.getElementById("detached-player")?.shadowRoot?.querySelector("video"),
  );
  await expect(page.locator("[data-vtp-badge]")).toBeAttached({ timeout: 3000 });
});

test("an SPA route replacement tracks a newly populated shadow player immediately", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { showRemaining: true, globalSpeed: 1.75 });
  await page.goto("/spa-shadow.html");
  await expect(page.locator("[data-vtp-badge]")).toBeAttached({ timeout: 3000 });

  await page.getByRole("button", { name: "Open next video" }).click();
  await page.waitForFunction(() =>
    document.getElementById("next-player")?.shadowRoot?.querySelector("video"),
  );

  await expect(page.locator("[data-vtp-badge]")).toBeAttached({ timeout: 3000 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            document
              .getElementById("next-player")
              ?.shadowRoot?.querySelector("video") as HTMLVideoElement | null
          )?.playbackRate,
      ),
    )
    .toBe(1.75);
});

test("the badge stays visible while the hold key is pressed", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { showRemaining: true });
  await page.goto("/");
  await page.locator("#v").click();
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );
  await page.waitForFunction(() => {
    const v = document.getElementById("v") as HTMLVideoElement;
    return v && isFinite(v.duration) && v.duration > 0;
  });
  await page.keyboard.down("KeyX"); // hold → 2×, badge revealed
  await expect.poll(async () => (await badge(page))?.text).toMatch(/^2×/);
  // Past the 2.6s auto-hide window it must still be visible (the hold pins it).
  await page.waitForTimeout(3000);
  expect((await badge(page))?.opacity).toBe("1");
  await page.keyboard.up("KeyX"); // release → resumes auto-hide
  await expect.poll(async () => (await badge(page))?.opacity).toBe("0");
});
