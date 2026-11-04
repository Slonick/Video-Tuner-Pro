// The popup, driven the way a user actually reaches it on a page: the on-video
// launcher opens popup.html as an in-page iframe, and the popup targets the host
// tab's video. Playwright clicks the controls inside that frame and asserts the
// real <video> responds. A standalone popup tab can't resolve a video tab; this
// is the faithful path.
import {
  test,
  expect,
  setStorage,
  clearAll,
  readStored,
  popupActive,
} from "./fixtures/extension.js";
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
  await popupActive(frame!);
  await frameSettled(page, frame!);
  return frame!;
}

// The panel is centred with translate(-50%) and animates open, so its controls move
// in page coordinates while it scales in or adopts a new content height. Playwright's
// stability check only sees the element inside the frame; wait until the iframe has
// taken the popup's reported height and its open animation is over.
async function frameSettled(page: Page, popup: Frame): Promise<void> {
  await expect
    .poll(async () => {
      const content = await popup.evaluate(() =>
        Math.ceil(document.documentElement.getBoundingClientRect().height),
      );
      return page.evaluate((h) => {
        const f = document
          .querySelector("[data-vtp-launcher]")
          ?.shadowRoot?.querySelector("iframe");
        return !!f && parseFloat(f.style.height) === h && f.getAnimations().length === 0;
      }, content);
    })
    .toBe(true);
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
  await frameSettled(page, popup);
  await guide.locator(".tour-skip").click();
  await expect(guide).toHaveCount(0);
  await expect
    .poll(async () => (await readStored(serviceWorker, "popupGuideSeen")).popupGuideSeen)
    .toBe(true);

  // Closing removes the popup frame; reopening builds a fresh one. Focus is inside
  // the out-of-process popup frame after the click, and a CDP key press there never
  // completes once the frame is removed, so fire the popup's own Escape handler.
  await popup.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await expect.poll(() => popup.isDetached()).toBe(true);
  await page.keyboard.press("KeyO");
  let reopened: Frame | undefined;
  await expect
    .poll(() => {
      reopened = page
        .frames()
        .find((f) => f.url().includes("/popup/popup.html") && !f.isDetached());
      return !!reopened;
    })
    .toBe(true);
  await popupActive(reopened!);
  await expect(reopened!.getByRole("dialog", { name: "Quick tour" })).toHaveCount(0);
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

test("the expanded popup keeps a four-digit preset centered and inside its cell", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  const popup = await openPopup(page);
  await popup.locator(".speed-section .sec-main").click();

  const preset = popup.locator('.btn-speed[data-percent="1600"]');
  await expect(preset).toBeVisible();
  const fit = await preset.evaluate((button) => {
    const style = getComputedStyle(button);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = style.font;
    const textWidth = context.measureText(button.textContent || "").width;
    const r = button.getBoundingClientRect();
    const grid = button.closest(".presetgrid")!.getBoundingClientRect();
    return {
      textWidth,
      available:
        button.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      textAlign: style.textAlign,
      width: r.width,
      height: r.height,
      insideGrid:
        r.left >= grid.left &&
        r.right <= grid.right &&
        r.top >= grid.top &&
        r.bottom <= grid.bottom,
    };
  });
  expect(fit.width).toBeGreaterThan(0);
  expect(fit.height).toBeGreaterThan(0);
  expect(fit.available).toBeGreaterThan(fit.textWidth + 1);
  expect(fit.textAlign).toBe("center");
  expect(fit.insideGrid).toBe(true);
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
  // The closing FLIP keeps the card over its neighbours until the animation ends.
  await expect
    .poll(() => popup.locator(".autoslow-section").evaluate((el) => el.getAnimations().length))
    .toBe(0);
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
