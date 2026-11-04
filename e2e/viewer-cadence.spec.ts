import { test, expect, clearAll, setStorage } from "./fixtures/extension.js";
import type { Page } from "@playwright/test";

// Frame-rate measurements must not run under the tracer: its DOM snapshots alone
// cost a single-core CI runner enough frames to dip under the 0.7x floor. Trace
// options can only be set per file, hence this spec of its own.
test.use({ trace: "off" });

test.beforeEach(async ({ serviceWorker }) => {
  await clearAll(serviceWorker);
});

const viewerState = (page: Page) =>
  page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-vtp-viewer"),
    nativePlayer: !!(
      document.getElementById("host")?.shadowRoot?.querySelector("[data-vtp-viewer-player]") ??
      document.querySelector("[data-vtp-viewer-player]")
    ),
  }));

async function measureVideoCadence(
  page: Page,
  durationMs = 1400,
): Promise<{ frames: number; fps: number }> {
  return page.evaluate(async (ms) => {
    const video = document.querySelector("video") as HTMLVideoElement | null;
    if (!video || typeof video.requestVideoFrameCallback !== "function") {
      throw new Error("requestVideoFrameCallback unavailable");
    }
    await video.play();
    return new Promise<{ frames: number; fps: number }>((resolve) => {
      let frames = 0;
      let done = false;
      const started = performance.now();
      const finish = () => {
        if (done) return;
        done = true;
        const elapsed = Math.max(1, performance.now() - started);
        resolve({ frames, fps: (frames * 1000) / elapsed });
      };
      const frame = (now: number) => {
        if (done) return;
        frames += 1;
        if (now - started >= ms) finish();
        else video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      setTimeout(finish, ms + 300);
    });
  }, durationMs);
}

test("Viewer and Theater retain the original 30fps cadence without a capture mirror", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { viewerBackdropVideo: false });
  await page.goto("/viewer-performance.html");
  await page.waitForSelector("[data-vtp-badge]", { state: "attached" });
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return !!video && !video.paused && video.readyState >= 2;
  });

  const baseline = await measureVideoCadence(page);
  await page.keyboard.press("KeyV");
  await expect.poll(() => viewerState(page)).toMatchObject({ attr: "normal", nativePlayer: true });
  const glassViewer = await measureVideoCadence(page);
  await setStorage(serviceWorker, { viewerBackdropVideo: true });
  await page
    .locator("canvas[data-vtp-viewer-backdrop-video]")
    .waitFor({ state: "attached", timeout: 5000 });
  const videoBackdropViewer = await measureVideoCadence(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => viewerState(page)).toMatchObject({ attr: "theater" });
  const theater = await measureVideoCadence(page);

  console.log(
    "FPS " +
      JSON.stringify({
        label: process.env.AB_LABEL,
        base: baseline.fps,
        glass: glassViewer.fps,
        backdrop: videoBackdropViewer.fps,
        theater: theater.fps,
      }),
  );
  expect(baseline.frames).toBeGreaterThanOrEqual(25);
  expect(glassViewer.fps).toBeGreaterThanOrEqual(baseline.fps * 0.7);
  expect(videoBackdropViewer.fps).toBeGreaterThanOrEqual(baseline.fps * 0.7);
  expect(theater.fps).toBeGreaterThanOrEqual(baseline.fps * 0.7);
  const resourceState = await page.evaluate(() => {
    const backdrop = document.querySelector(
      "canvas[data-vtp-viewer-backdrop-video]",
    ) as HTMLCanvasElement | null;
    return {
      captureCalls: Number(document.body.dataset.captureCalls || 0),
      backdropWidth: backdrop?.width ?? 0,
      viewportWidth: window.innerWidth,
    };
  });
  expect(resourceState.captureCalls).toBe(0);
  expect(resourceState.backdropWidth).toBeLessThan(resourceState.viewportWidth / 4);
});
