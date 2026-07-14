import { test, expect, setStorage, clearAll, readStored } from "./fixtures/extension.js";
import type { Frame, Locator, Page } from "@playwright/test";

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
  await setStorage(serviceWorker, { popupGuideSeen: true, overlayButton: "always" });
});

async function playerFrame(page: Page): Promise<Frame> {
  await page.goto("/iframe.html");
  const frame = page.frames().find((candidate) => candidate.url().endsWith("/frame-video.html"));
  expect(frame).toBeTruthy();
  await frame!.locator("#frame-video").waitFor();
  return frame!;
}

const frameRate = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("frame-video") as HTMLVideoElement).playbackRate);

async function clickNestedPopup(page: Page, player: Frame, locator: Locator): Promise<void> {
  const outer = await page.locator("#player-frame").boundingBox();
  const panel = await player.evaluate(() => {
    const iframe = document
      .querySelector("[data-vtp-launcher]")
      ?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null;
    if (!iframe) return null;
    const rect = iframe.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      scaleX: rect.width / iframe.offsetWidth,
      scaleY: rect.height / iframe.offsetHeight,
    };
  });
  const inner = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  expect(outer).not.toBeNull();
  expect(panel).not.toBeNull();
  await page.mouse.click(
    outer!.x + panel!.left + (inner.left + inner.width / 2) * panel!.scaleX,
    outer!.y + panel!.top + (inner.top + inner.height / 2) * panel!.scaleY,
  );
}

test("keyboard shortcuts control a video inside a child frame", async ({ page }) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  await frame.locator("body").press("KeyD");
  await expect.poll(() => frameRate(frame)).toBeCloseTo(1.05, 2);
});

test("the child-frame launcher popup changes speed and saves the host site", async ({
  page,
  serviceWorker,
}) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  await frame.locator("body").press("KeyO");
  await frame.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  let popup: Frame | undefined;
  await expect
    .poll(() => {
      popup = page.frames().find((candidate) => candidate.url().includes("/popup/popup.html"));
      return !!popup;
    })
    .toBe(true);
  await popup!.locator("#speedUp").waitFor();
  await popup!.waitForTimeout(800); // wait for the fitted nested iframe to finish sizing

  await expect(popup!.locator("#viewerAutoToggle")).toBeDisabled();
  await expect(popup!.locator(".viewer-drm-note")).toContainText("Embedded player");

  // Use the actual top-level mouse coordinate: this popup is inside a scaled
  // extension iframe inside the site's iframe, the exact geometry users click.
  await clickNestedPopup(page, frame, popup!.locator('.btn-speed[data-percent="175"]'));
  await expect.poll(() => frameRate(frame)).toBeCloseTo(1.75, 2);
  await clickNestedPopup(page, frame, popup!.locator("#setDefaultBtn"));
  await clickNestedPopup(
    page,
    frame,
    popup!.locator('.scope-row-wrap[data-key="site"] .scope-row'),
  );
  await expect
    .poll(async () => (await readStored(serviceWorker, "domains")).domains)
    .toMatchObject({ localhost: 1.75 });
});

test("embedded players do not expose dead viewer actions", async ({ page }) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  await frame.locator("body").press("KeyV");
  await expect
    .poll(() => frame.evaluate(() => document.documentElement.getAttribute("data-vtp-viewer")))
    .toBeNull();
  await expect(frame.locator("[data-vtp-viewer-overlay]")).toHaveCount(0);

  const launcher = frame.getByRole("button", { name: "Open Video Tuner" });
  await frame.locator("#frame-video").hover();
  await launcher.hover();
  await expect(frame.getByRole("button", { name: "Pop out video" })).toBeHidden();
  await expect(frame.getByRole("button", { name: "Pop out in theater format" })).toBeHidden();
});
