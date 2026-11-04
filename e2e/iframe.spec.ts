import { test, expect, setStorage, clearAll, readStored, uiMessage } from "./fixtures/extension.js";
import type { Frame, Page } from "@playwright/test";

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

test("keyboard shortcuts control a video inside a child frame", async ({ page }) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  await frame.locator("body").press("KeyD");
  await expect.poll(() => frameRate(frame)).toBeCloseTo(1.05, 2);
});

test("the embedded player's launcher opens the popup in the top frame", async ({
  page,
  serviceWorker,
}) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  // Inside the embed the overlay key stays the page's; the button asks the top frame.
  await frame.locator("body").press("KeyO");
  await frame.locator("#frame-video").hover();
  const openLabel = await uiMessage(serviceWorker, "overlayBtnAria");
  await frame.getByRole("button", { name: openLabel }).click();
  await page.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  let popup: Frame | undefined;
  await expect
    .poll(() => {
      popup = page.frames().find((candidate) => candidate.url().includes("/popup/popup.html"));
      return !!popup;
    })
    .toBe(true);
  expect(popup!.parentFrame()).toBe(page.mainFrame());
  expect(
    await frame.evaluate(
      () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
    ),
  ).toBe(false);
  await popup!.locator("#speedUp").waitFor();

  await expect(popup!.locator("#viewerAutoToggle")).toBeDisabled();
  // Popup strings follow navigator.language (honours --lang), not chrome.i18n.
  await expect(popup!.locator(".viewer-drm-note")).toContainText("Embedded player");

  await popup!.locator('.btn-speed[data-percent="175"]').click();
  await expect.poll(() => frameRate(frame)).toBeCloseTo(1.75, 2);
  await popup!.locator("#setDefaultBtn").click();
  await popup!.locator('.scope-row-wrap[data-key="site"] .scope-row').click();
  await expect
    .poll(async () => (await readStored(serviceWorker, "domains")).domains)
    .toMatchObject({ localhost: 1.75 });
});

test("embedded players do not expose dead viewer actions", async ({ page, serviceWorker }) => {
  const frame = await playerFrame(page);
  await frame.locator("#frame-video").click();
  await frame.locator("body").press("KeyV");
  await expect
    .poll(() => frame.evaluate(() => document.documentElement.getAttribute("data-vtp-viewer")))
    .toBeNull();
  await expect(frame.locator("[data-vtp-viewer-overlay]")).toHaveCount(0);

  const launcher = frame.getByRole("button", {
    name: await uiMessage(serviceWorker, "overlayBtnAria"),
  });
  await frame.locator("#frame-video").hover();
  await launcher.hover();
  await expect(
    frame.getByRole("button", { name: await uiMessage(serviceWorker, "viewerBtnAria") }),
  ).toBeHidden();
  await expect(
    frame.getByRole("button", { name: await uiMessage(serviceWorker, "viewerTheaterAria") }),
  ).toBeHidden();
});
