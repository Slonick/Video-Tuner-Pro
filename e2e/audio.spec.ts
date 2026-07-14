import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";

type Monitor = {
  audio: { active: boolean; enabled: boolean };
  autoSlow: { active: boolean; enabled: boolean; rate: number; speed: number };
};

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

// The real proof the Web Audio compressor works (which jsdom can't give): with
// compression enabled, a graph actually routes a safe blob video's audio.
test("enabling compression engages a real Web Audio graph on the video", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { audioComp: true });
  await page.goto("/");
  await page.evaluate(async () => {
    const video = document.getElementById("v") as HTMLVideoElement;
    const blob = await fetch("sample.webm").then((r) => r.blob());
    video.src = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  });
  await page.locator("#v").click(); // user gesture → AudioContext resumes
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );

  await expect
    .poll(
      async () => {
        const m = (await sendToContent(serviceWorker, "getMonitor")) as Monitor | null;
        return !!m && m.audio.active && m.audio.enabled;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

// The pace estimator/controller is covered with synthetic envelopes in unit
// tests. This browser test proves the remaining production wiring: enabling the
// feature alone creates the real media-element audio graph, starts the sampler,
// and publishes live monitor data without requiring the compressor.
test("auto-slow samples a real media audio graph when enabled", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, {
    audioComp: false,
    autoSlowEnabled: true,
    autoSlowGlobal: { target: 6 },
    globalSpeed: 2,
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const video = document.getElementById("v") as HTMLVideoElement;
    const blob = await fetch("sample.webm").then((r) => r.blob());
    video.src = URL.createObjectURL(blob);
    video.loop = true;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  });
  await page.locator("#v").click();
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );

  await expect
    .poll(
      async () => {
        const monitor = (await sendToContent(serviceWorker, "getMonitor")) as Monitor | null;
        return monitor
          ? {
              audioActive: monitor.audio.active,
              compressorEnabled: monitor.audio.enabled,
              autoSlowActive: monitor.autoSlow.active,
              autoSlowEnabled: monitor.autoSlow.enabled,
              rateIsFinite: Number.isFinite(monitor.autoSlow.rate),
              speed: monitor.autoSlow.speed,
            }
          : null;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({
      audioActive: true,
      compressorEnabled: false,
      autoSlowActive: true,
      autoSlowEnabled: true,
      rateIsFinite: true,
      speed: 2,
    });
});

test("compression and auto-slow stay active together while playback keeps advancing", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, {
    audioComp: true,
    autoSlowEnabled: true,
    autoSlowGlobal: { target: 6 },
    globalSpeed: 1.75,
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const video = document.getElementById("v") as HTMLVideoElement;
    const blob = await fetch("sample.webm").then((response) => response.blob());
    video.src = URL.createObjectURL(blob);
    video.loop = true;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  });
  await page.locator("#v").click();
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );

  await expect
    .poll(
      async () => {
        const monitor = (await sendToContent(serviceWorker, "getMonitor")) as Monitor | null;
        return monitor
          ? {
              audioActive: monitor.audio.active,
              compressorEnabled: monitor.audio.enabled,
              autoSlowActive: monitor.autoSlow.active,
              autoSlowEnabled: monitor.autoSlow.enabled,
              speed: monitor.autoSlow.speed,
            }
          : null;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({
      audioActive: true,
      compressorEnabled: true,
      autoSlowActive: true,
      autoSlowEnabled: true,
      speed: 1.75,
    });

  const before = await page
    .locator("#v")
    .evaluate((video) => (video as HTMLVideoElement).currentTime);
  await page.waitForTimeout(750);
  const playback = await page.locator("#v").evaluate((element) => {
    const video = element as HTMLVideoElement;
    return {
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
      paused: video.paused,
      error: video.error?.code ?? null,
    };
  });
  expect(playback.currentTime).toBeGreaterThan(before);
  expect(playback.playbackRate).toBeGreaterThan(0);
  expect(playback.paused).toBe(false);
  expect(playback.error).toBeNull();
});

test("a live stream keeps compression but releases auto-slow", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, {
    audioComp: true,
    autoSlowEnabled: true,
    autoSlowGlobal: { target: 6 },
    liveSync: false,
  });
  await page.goto("/");
  await page.evaluate(async () => {
    document.documentElement.setAttribute("data-vtp-live", "1");
    const video = document.getElementById("v") as HTMLVideoElement;
    const blob = await fetch("sample.webm").then((response) => response.blob());
    video.src = URL.createObjectURL(blob);
    video.loop = true;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  });
  await page.locator("#v").click();
  await page.evaluate(() =>
    (document.getElementById("v") as HTMLVideoElement).play().catch(() => {}),
  );

  await expect
    .poll(
      async () => {
        const monitor = (await sendToContent(serviceWorker, "getMonitor")) as
          | (Monitor & { live: boolean })
          | null;
        return monitor
          ? {
              live: monitor.live,
              audioActive: monitor.audio.active,
              compressorEnabled: monitor.audio.enabled,
              autoSlowActive: monitor.autoSlow.active,
              autoSlowEnabled: monitor.autoSlow.enabled,
            }
          : null;
      },
      { timeout: 15_000 },
    )
    .toEqual({
      live: true,
      audioActive: true,
      compressorEnabled: true,
      autoSlowActive: false,
      autoSlowEnabled: true,
    });
});
