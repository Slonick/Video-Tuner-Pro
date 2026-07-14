// The popup, driven the way a user actually reaches it on a page: the on-video
// launcher opens popup.html as an in-page iframe, and the popup targets the host
// tab's video. Playwright clicks the controls inside that frame and asserts the
// real <video> responds. A standalone popup tab can't resolve a video tab; this
// is the faithful path.
import { test, expect, setStorage, clearAll, readStored } from "./fixtures/extension.js";
import type { Frame, Page } from "@playwright/test";

const rate = (page: Page) =>
  page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).playbackRate);

async function openPopup(page: Page, playVideo = false): Promise<Frame> {
  await page.goto("/overlay.html");
  await page.waitForSelector("#v");
  if (playVideo) {
    await page.evaluate(async () => {
      const video = document.getElementById("v") as HTMLVideoElement;
      const blob = await fetch("sample.webm").then((response) => response.blob());
      video.src = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      });
      await video.play().catch(() => {});
    });
  }
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

test("the first-open guide can be dismissed and stays dismissed", async ({
  page,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.sync.remove("popupGuideSeen");
    await chrome.storage.local.remove("popupGuideSeen");
  });
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  const guide = popup.getByRole("dialog", { name: "Quick tour" });
  await expect(guide).toBeVisible();
  await guide.locator(".tour-skip").click();
  await expect(guide).toHaveCount(0);
  await expect
    .poll(async () => (await readStored(serviceWorker, "popupGuideSeen")).popupGuideSeen)
    .toBe(true);

  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyO");
  await expect(popup.getByRole("dialog", { name: "Quick tour" })).toHaveCount(0);
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

test("expanded speed settings toggle and persist through real popup clicks", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator(".speed-section .sec-main").click();
  await expect(popup.locator("#speedBody")).toHaveClass(/open/);

  await popup.locator("#onVideoToggle").click();
  await popup.locator("#superTheaterToggle").click();
  await popup.locator("#kbdToggle").click();
  await popup.locator("#audioSpeedToggle").click();

  await expect
    .poll(async () =>
      readStored(serviceWorker, ["showRemaining", "superTheater", "keyboard", "audioSpeed"]),
    )
    .toEqual({
      showRemaining: false,
      superTheater: true,
      keyboard: false,
      audioSpeed: true,
    });
});

test("speed can be saved for the current site from the scope menu", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator('.btn-speed[data-percent="175"]').click();
  await popup.locator("#setDefaultBtn").click();
  await popup.locator('.scope-row-wrap[data-key="site"] .scope-row').click();

  await expect
    .poll(async () => (await readStored(serviceWorker, "domains")).domains)
    .toMatchObject({ localhost: 1.75 });
});

test("viewer mode, auto-open, backdrop, and fit controls work from the popup", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator(".viewer-auto-section .sec-main").click();
  await expect(popup.locator("#viewerAutoVisual")).toBeVisible();

  await popup.locator("#viewerAutoVisual .viewer-auto-state.is-viewer").click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-vtp-viewer")))
    .toBe("normal");
  await popup.locator("#viewerAutoModeToggle").click();
  await popup.locator("#viewerBackdropVideoToggle").click();
  await popup.locator("#viewerAutoSetBtn").click();
  await popup.locator('.scope-row-wrap[data-key="site"] .scope-row').click();
  await popup.locator("#viewerFitSeg [role=radio]").nth(1).click(); // cover
  await popup.locator("#viewerFitSetBtn").click();
  await popup.locator('.scope-row-wrap[data-key="site"] .scope-row').click();

  await expect
    .poll(async () =>
      readStored(serviceWorker, ["viewerBackdropVideo", "viewerAutoSites", "viewerFitSites"]),
    )
    .toMatchObject({
      viewerBackdropVideo: true,
      viewerAutoSites: { localhost: "normal" },
      viewerFitSites: { localhost: "cover" },
    });
  await expect(popup.locator("#viewerFitSeg [role=radio]").nth(1)).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("auto-slow and compressor controls persist their real popup interactions", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always", audioSeen: true });
  const popup = await openPopup(page, true);

  await popup.locator("#autoSlowToggle").click();
  await popup.locator(".autoslow-section .sec-main").click();
  const floor = popup.locator("#asFloor [role=slider]");
  const knee = popup.locator("#asKnee [role=slider]");
  await floor.focus();
  await floor.press("Home");
  await knee.focus();
  await knee.press("End");

  await popup.locator(".autoslow-section .sec-main").click();
  await expect(popup.locator(".autoslow-section")).not.toHaveClass(/is-overlay/);
  await popup.waitForTimeout(350); // let the closing FLIP release pointer interception
  await popup.locator(".audio-section .sec-main").click();
  await expect(popup.locator("#audioBody")).toHaveClass(/open/);
  await popup.locator("#audioCompToggle").click();
  await popup.locator('.audio-section .btn-preset[data-preset="0"]').click();
  const gain = popup.locator("#acGain [role=slider]");
  await gain.focus();
  await gain.press("End");

  await expect
    .poll(async () =>
      readStored(serviceWorker, [
        "autoSlowEnabled",
        "autoSlowFloor",
        "autoSlowKnee",
        "audioComp",
        "audioCompBaseGain",
        "audioCompGain",
      ]),
    )
    .toMatchObject({
      autoSlowEnabled: true,
      autoSlowFloor: 0.5,
      autoSlowKnee: 2,
      audioComp: true,
      audioCompBaseGain: 24,
      audioCompGain: 24,
    });
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
