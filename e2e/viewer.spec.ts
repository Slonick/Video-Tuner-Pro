import { test, expect, clearAll } from "./fixtures/extension.js";

// The pop-out viewer against a Boosty-shaped page (viewer.html): sticky
// header, fixed modal, player guts in an open shadow root. In modern Chromium
// the viewer mirrors the source video through captureStream(), so the site-owned
// <video> stays in place while our overlay renders a separate surface.
const state = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const sr = document.getElementById("host")?.shadowRoot;
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const overlayVideo = overlay?.querySelector("video") as HTMLVideoElement | null;
    const sourceVideo = sr?.querySelector("video") as HTMLVideoElement | null;
    const v = overlayVideo ?? sourceVideo;
    const r = v?.getBoundingClientRect();
    const barHost = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
      el.shadowRoot?.querySelector(".bar"),
    );
    return {
      attr: document.documentElement.getAttribute("data-vtp-viewer"),
      overlay: !!overlay,
      videoInOverlay: !!overlayVideo,
      videoInShadow: !!sourceVideo,
      mirrored: !!overlayVideo && !!sourceVideo && overlayVideo !== sourceVideo,
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
  await clearAll(serviceWorker);
});

// The hotkey only acts once the media registry has picked up the shadow-DOM
// video; the on-video badge mounting is that signal (it anchors to the same
// primaryVideo the viewer uses).
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/viewer.html");
  await page.waitForSelector("[data-vtp-badge]", { state: "attached" });
  await page.locator("#modal").click({ position: { x: 20, y: 600 } }); // focus gesture off the player
}

async function readyLiveWithQuality(page: import("@playwright/test").Page) {
  await page.goto("/live.html");
  await page.waitForSelector("[data-vtp-badge]", { state: "attached" });
}

test("T mirrors the shadow-DOM video into the overlay over the whole window", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect
    .poll(() => state(page))
    .toMatchObject({
      attr: "theater",
      overlay: true,
      videoInOverlay: true,
      videoInShadow: true,
      mirrored: true,
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
      videoInShadow: true,
      mirrored: true,
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

test("the quality picker drives a generic HLS-like engine", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater" });
  await page.mouse.move(400, 400); // wake the auto-hidden bar
  await expect(page.locator("[data-vtp-viewer-overlay] .qwrap")).toHaveCount(2);
  const qwrap = page.locator("[data-vtp-viewer-overlay] .qwrap").nth(0);
  await expect(qwrap).toBeVisible();
  await qwrap.locator("> button").click();
  await expect(qwrap.locator(".qitem", { hasText: "720p" })).toBeVisible();
  await qwrap.locator(".qitem", { hasText: "720p" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const v = document.getElementById("host")?.shadowRoot?.querySelector("video") as
          | (HTMLVideoElement & { __vtpFakeHls?: { currentLevel: number } })
          | null;
        return v?.__vtpFakeHls?.currentLevel;
      }),
    )
    .toBe(1);
});

test("live viewer keeps a compact bar and compact quality label", async ({ page }) => {
  await readyLiveWithQuality(page);
  await page.keyboard.press("KeyT");
  await expect(page.locator("[data-vtp-viewer-overlay]")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.querySelector("[data-vtp-viewer-overlay]");
        const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
          el.shadowRoot?.querySelector(".bar"),
        )?.shadowRoot;
        const bar = shadow?.querySelector(".bar") as HTMLElement | null;
        const qwrap = shadow?.querySelector(".qwrap") as HTMLElement | null;
        return {
          barWidth: bar?.getBoundingClientRect().width ?? 0,
          live: bar?.classList.contains("live") ?? false,
          label: qwrap?.querySelector(".qbtn-label")?.textContent?.trim() || "",
          time: shadow?.querySelector(".time")?.textContent?.trim() || "",
          qualityVisible: qwrap?.style.display === "block",
        };
      }),
    )
    .toMatchObject({
      live: true,
      label: "1440p",
      time: "LIVE",
      qualityVisible: true,
    });
  const barWidth = await page.evaluate(() => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
      el.shadowRoot?.querySelector(".bar"),
    )?.shadowRoot;
    return (shadow?.querySelector(".bar") as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
  });
  expect(barWidth).toBeLessThanOrEqual(460);
});

test("switching formats keeps a single overlay, T again exits", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal" });
  await page.keyboard.press("KeyT"); // switch in place
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", theaterFits: true });
  expect(await page.locator("[data-vtp-viewer-overlay]").count()).toBe(1);
  await page.keyboard.press("KeyT");
  await expect
    .poll(() => state(page))
    .toMatchObject({ attr: null, overlay: false, videoInShadow: true });
});
