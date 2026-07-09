// Network smokes against real youtube.com (not CI tests — run manually).
// The VOD case verifies on the real player: mirroring, style enforcement (no
// drift), the quality mirror, chapter ticks and sponsor bands.
import { test, expect } from "./fixtures/extension.js";

test.setTimeout(120_000);

// Real-network VOD smoke. A separate test below requires an actual live URL.
//   YT_NETWORK=1 npx playwright test e2e/yt-live.spec.ts

// A video known for chapters + SponsorBlock segments (LTT-style tech video
// tends to have both). Fall back assertions are lenient where content varies.
const URL_CHAPTERS = "https://www.youtube.com/watch?v=1La4QzGeaaQ"; // typical chaptered video

test("real YouTube VOD: viewer, quality, chapters, no drift", async ({
  page,
  serviceWorker,
}, testInfo) => {
  test.skip(!process.env.YT_NETWORK, "real YouTube VOD smoke — set YT_NETWORK=1 to run");
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ sponsorMarks: true }));
  await page.goto(URL_CHAPTERS, { waitUntil: "domcontentloaded" });
  // Consent wall (fresh profile) — take whatever reject/accept button exists.
  const consent = page.locator(
    'button:has-text("Reject all"), button:has-text("Отклонить все"), [aria-label*="Reject"], button:has-text("Accept all")',
  );
  try {
    await consent.first().click({ timeout: 7000 });
  } catch {
    /* no consent wall */
  }
  await page.waitForSelector("video.html5-main-video", { timeout: 30_000 });
  await page.evaluate(() => {
    const v = document.querySelector("video.html5-main-video") as HTMLVideoElement;
    v.muted = true;
    return v.play().catch(() => {});
  });
  await page.waitForTimeout(4000); // player settles; badge/launcher mount
  await page.evaluate(() => {
    const v = document.querySelector("video.html5-main-video") as HTMLVideoElement;
    const r = v.getBoundingClientRect();
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: r.left + 100,
        clientY: r.top + 100,
        bubbles: true,
      }),
    );
  });
  // Mimic a third-party control inside the player chrome; quality probing must
  // ignore unrelated buttons.
  await page.evaluate(() => {
    const controls =
      document.querySelector(".ytp-right-controls") ?? document.querySelector("#movie_player");
    const b = document.createElement("button");
    b.className = "third-party-icon-button";
    b.setAttribute("aria-label", "Third-party settings");
    const panel = document.createElement("div");
    panel.style.display = "none";
    panel.textContent = "Third-party panel without quality controls";
    b.addEventListener("click", () => {
      document.body.dataset.thirdPartyClicks = String(
        Number(document.body.dataset.thirdPartyClicks || 0) + 1,
      );
      panel.style.display = panel.style.display === "none" ? "" : "none";
    });
    controls!.prepend(b);
    controls!.append(panel);
  });
  const siteChapters = await page.evaluate(
    () => document.querySelectorAll(".ytp-chapters-container > *").length,
  );
  console.log("SITE CHAPTERS:", siteChapters);
  await page.keyboard.press("KeyT");
  await page.waitForTimeout(3500); // enter + quality probe + sponsor fetch

  const state = await page.evaluate(() => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const v = overlay?.querySelector("video") as HTMLVideoElement | null;
    const r = v?.getBoundingClientRect();
    // The dance re-appends the video, so the bar host's index varies.
    const barSh = Array.from(overlay?.children ?? []).find(
      (c) => (c as HTMLElement).shadowRoot,
    )?.shadowRoot;
    return {
      overlay: !!overlay,
      adopted: !!v,
      playing: !!v && !v.paused,
      t: v?.currentTime ?? -1,
      fills:
        !!r &&
        Math.round(r.width) === window.innerWidth &&
        Math.round(r.height) === window.innerHeight,
      qualityShown:
        (barSh?.querySelectorAll(".qwrap")[0] as HTMLElement | undefined)?.style.display ===
        "block",
      ticks: barSh?.querySelectorAll(".mark-tick").length ?? -1,
      bands: barSh?.querySelectorAll(".mark-seg").length ?? -1,
    };
  });
  console.log("STATE1:", JSON.stringify(state));
  expect(state.overlay).toBe(true);
  expect(state.adopted).toBe(true);
  expect(state.fills).toBe(true);
  expect(state.ticks).toBe(Math.max(0, siteChapters - 1)); // chapter boundaries mirrored

  // Drift check: YouTube keeps restyling its video — ours must win for 6s.
  await page.waitForTimeout(6000);
  const state2 = await page.evaluate(() => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const v = overlay?.querySelector("video") as HTMLVideoElement | null;
    const r = v?.getBoundingClientRect();
    return {
      stillFills:
        !!r &&
        Math.round(r.width) === window.innerWidth &&
        Math.round(r.height) === window.innerHeight,
      t: v?.currentTime ?? -1,
      playing: !!v && !v.paused,
    };
  });
  console.log("STATE2:", JSON.stringify(state2));
  await page.screenshot({ path: testInfo.outputPath("yt-live.png") });
  console.log("SCREENSHOT:", testInfo.outputPath("yt-live.png"));
  expect(state2.stillFills).toBe(true);

  // Quality: the button must be there (the probe retries with the video
  // handed back when the player tears its UI down). Then pick a low rung and
  // watch the real decode resolution drop.
  const qualityShown = await page.evaluate(() => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const barSh = Array.from(overlay?.children ?? []).find(
      (c) => (c as HTMLElement).shadowRoot,
    )?.shadowRoot;
    return (
      (barSh?.querySelectorAll(".qwrap")[0] as HTMLElement | undefined)?.style.display === "block"
    );
  });
  console.log("QUALITY SHOWN (first look):", qualityShown);
  // The probe may still be mid-dance — poll for the button.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const overlay = document.querySelector("[data-vtp-viewer-overlay]");
          const barSh = (Array.from(overlay?.children ?? []) as HTMLElement[]).find(
            (c) => c.shadowRoot,
          )?.shadowRoot;
          return (
            (barSh?.querySelectorAll(".qwrap")[0] as HTMLElement | undefined)?.style.display ===
            "block"
          );
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.mouse.move(500, 500);
  const qbtn = page.locator("[data-vtp-viewer-overlay] .qwrap").nth(0).locator("> button");
  await qbtn.click();
  const items = await page
    .locator("[data-vtp-viewer-overlay] .qwrap")
    .nth(0)
    .locator(".qitem")
    .allTextContents();
  console.log("QUALITY OPTIONS:", JSON.stringify(items));
  const before = await page.evaluate(
    () =>
      (document.querySelector("[data-vtp-viewer-overlay] video") as HTMLVideoElement).videoHeight,
  );
  await page
    .locator("[data-vtp-viewer-overlay] .qwrap")
    .nth(0)
    .locator(".qitem", { hasText: /^144p/ })
    .click();
  await page.waitForTimeout(9000); // dance + the player switching rungs
  const after = await page.evaluate(() => {
    const v = document.querySelector("[data-vtp-viewer-overlay] video") as HTMLVideoElement;
    return { h: v.videoHeight, playing: !v.paused, inOverlay: !!v };
  });
  console.log("PICK 144p:", JSON.stringify({ before, after }));
  const thirdPartyClicks = await page.evaluate(() =>
    Number(document.body.dataset.thirdPartyClicks || 0),
  );
  console.log("THIRD-PARTY CLICKS:", thirdPartyClicks);
  expect(thirdPartyClicks).toBe(0); // foreign buttons must never be poked
  await page.screenshot({ path: testInfo.outputPath("yt-quality.png") });
  expect(after.inOverlay).toBe(true);
  expect(after.h).toBeLessThan(before);
});

test("real YouTube live: live layout, playback, and no VOD seek bar", async ({
  page,
}, testInfo) => {
  const liveUrl = process.env.YT_LIVE_URL;
  test.skip(!liveUrl, "real YouTube live smoke — set YT_LIVE_URL to an active broadcast");

  await page.goto(liveUrl!, { waitUntil: "domcontentloaded" });
  const consent = page.locator(
    'button:has-text("Reject all"), button:has-text("Отклонить все"), [aria-label*="Reject"], button:has-text("Accept all")',
  );
  try {
    await consent.first().click({ timeout: 7000 });
  } catch {
    /* no consent wall */
  }
  await page.waitForSelector("video.html5-main-video", { timeout: 30_000 });
  await page.evaluate(() => {
    const video = document.querySelector("video.html5-main-video") as HTMLVideoElement;
    video.muted = true;
    return video.play().catch(() => {});
  });
  await expect
    .poll(() => page.locator("html").getAttribute("data-vtp-live"), { timeout: 30_000 })
    .toBe("1");

  await page.keyboard.press("KeyT");
  await expect(page.locator("[data-vtp-viewer-overlay]")).toBeVisible({ timeout: 15_000 });
  const before = await page.evaluate(
    () => (document.querySelector("video.html5-main-video") as HTMLVideoElement).currentTime,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const overlay = document.querySelector("[data-vtp-viewer-overlay]");
          const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((element) =>
            element.shadowRoot?.querySelector(".bar"),
          )?.shadowRoot;
          const seek = shadow?.querySelector('input[type="range"]') as HTMLElement | null;
          return {
            time: shadow?.querySelector(".time")?.textContent?.trim() || "",
            seekVisible: !!seek && seek.style.display !== "none",
          };
        }),
      { timeout: 15_000 },
    )
    .toEqual({ time: "LIVE", seekVisible: false });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(
    () => (document.querySelector("video.html5-main-video") as HTMLVideoElement).currentTime,
  );
  expect(after).toBeGreaterThan(before + 0.5);
  await page.screenshot({ path: testInfo.outputPath("youtube-live.png") });
});
