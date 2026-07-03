import { test, expect, clearStorage } from "./fixtures/extension.js";

// The pop-out viewer against a Boosty-shaped page (viewer.html): sticky
// header, fixed modal, player guts in an open shadow root. The bare <video>
// is adopted into our overlay (never the site's containers — re-parenting a
// React-owned node crashes such sites into a full reload) and put back
// exactly on exit.
const state = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const sr = document.getElementById("host")?.shadowRoot;
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const v = (overlay?.querySelector("video") ??
      sr?.querySelector("video")) as HTMLVideoElement | null;
    const r = v?.getBoundingClientRect();
    const barHost = overlay?.children[1] as HTMLElement | undefined;
    return {
      attr: document.documentElement.getAttribute("data-vtp-viewer"),
      overlay: !!overlay,
      videoInOverlay: !!overlay?.querySelector("video"),
      videoInShadow: !!sr?.querySelector("video"),
      bar: !!barHost?.shadowRoot?.querySelector(".bar"),
      theaterFits:
        !!r &&
        Math.round(r.left) === 0 &&
        Math.round(r.top) === 0 &&
        Math.round(r.width) === window.innerWidth &&
        Math.round(r.height) === window.innerHeight,
      normalFits:
        !!r &&
        r.width < window.innerWidth &&
        Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 2,
    };
  });

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

// The hotkey only acts once the media registry has picked up the shadow-DOM
// video; the on-video badge mounting is that signal (it anchors to the same
// primaryVideo the viewer uses).
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/viewer.html");
  await page.waitForSelector("[data-vtp-badge]", { state: "attached" });
  await page.locator("#modal").click({ position: { x: 20, y: 600 } }); // focus gesture off the player
}

test("T adopts the shadow-DOM video into the overlay over the whole window", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect
    .poll(() => state(page))
    .toMatchObject({
      attr: "theater",
      overlay: true,
      videoInOverlay: true,
      videoInShadow: false,
      bar: true,
      theaterFits: true,
    });
});

test("V uses the normal format — a centred box below viewport size", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect
    .poll(() => state(page))
    .toMatchObject({
      attr: "normal",
      videoInOverlay: true,
      normalFits: true,
    });
});

test("Escape returns the video into the shadow root exactly", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater" });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => state(page))
    .toMatchObject({
      attr: null,
      overlay: false,
      videoInShadow: true,
    });
});

test("the quality button mirrors the site player's menu", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater" });
  // The probe (behind the dim) walks the fixture's gear → menu and reports in.
  const qbtn = page.locator("[data-vtp-viewer-overlay] .qwrap").nth(1).locator("> button");
  await expect(qbtn).toBeVisible({ timeout: 5000 });
  await page.mouse.move(400, 400); // wake the auto-hidden bar
  await qbtn.click();
  await page.locator("[data-vtp-viewer-overlay] .qitem", { hasText: "720p" }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.picked ?? null)).toBe("720p");
});

test("switching formats keeps a single overlay, T again exits", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal" });
  await page.keyboard.press("KeyT"); // switch in place
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", theaterFits: true });
  expect(await page.locator("[data-vtp-viewer-overlay]").count()).toBe(1);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: null, videoInShadow: true });
});
