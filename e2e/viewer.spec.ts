import { test, expect, clearAll, setStorage, sendToContent } from "./fixtures/extension.js";

// The pop-out viewer against a Boosty-shaped page (viewer.html): sticky header,
// fixed modal, player guts in an open shadow root. The viewer must render the
// original media element; captureStream is allowed only for the optional blurred
// backdrop, never for the primary picture/audio surface.
const state = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const sr = document.getElementById("host")?.shadowRoot;
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const overlayVideo = overlay?.querySelector(
      "video:not([data-vtp-viewer-backdrop-video])",
    ) as HTMLVideoElement | null;
    const shadowVideo = sr?.querySelector("video") as HTMLVideoElement | null;
    const sourceVideo =
      shadowVideo ??
      (document.querySelector(
        "video:not([data-vtp-viewer-backdrop-video])",
      ) as HTMLVideoElement | null);
    const nativePlayer = (sr?.querySelector("[data-vtp-viewer-player]") ??
      document.querySelector("[data-vtp-viewer-player]")) as HTMLElement | null;
    const v = overlayVideo ?? sourceVideo;
    const r = (nativePlayer ?? v)?.getBoundingClientRect();
    const videoRect = sourceVideo?.getBoundingClientRect();
    const barHost = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
      el.shadowRoot?.querySelector(".bar"),
    );
    return {
      attr: document.documentElement.getAttribute("data-vtp-viewer"),
      overlay: !!overlay,
      videoInOverlay: !!overlayVideo,
      videoInShadow: !!shadowVideo,
      originalSurface:
        !!nativePlayer || !!overlayVideo?.hasAttribute("data-vtp-viewer-adopted-video"),
      nativePlayer: !!nativePlayer,
      videoWidth: videoRect?.width ?? 0,
      videoHeight: videoRect?.height ?? 0,
      bar: !!barHost?.shadowRoot?.querySelector(".bar"),
      objectFit: sourceVideo
        ? getComputedStyle(sourceVideo).objectFit
        : overlayVideo?.style.objectFit || "",
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

async function measureVideoCadence(
  page: import("@playwright/test").Page,
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

async function clickLauncherAction(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  const button = page.locator("#vtp-launcher-host").getByRole("button", { name });
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS("pointer-events", "auto");
  await expect
    .poll(() =>
      button.evaluate(
        (element) =>
          element.getAnimations().filter(({ playState }) => playState === "running").length,
      ),
    )
    .toBe(0);
  await button.click();
}

test("T renders the original shadow-DOM video over the whole window", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect
    .poll(() => state(page))
    .toMatchObject({
      attr: "theater",
      overlay: true,
      videoInOverlay: false,
      videoInShadow: true,
      originalSurface: true,
      nativePlayer: true,
      bar: false,
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
      videoInOverlay: false,
      videoInShadow: true,
      originalSurface: true,
      nativePlayer: true,
      normalFits: true,
    });
});

test("V keeps the painted video non-zero inside YouTube's zero-height media wrapper", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const player = document.getElementById("host")?.shadowRoot?.firstElementChild;
    const video = player?.querySelector("video");
    if (!(player instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
      throw new Error("viewer fixture player unavailable");
    }
    player.classList.add("html5-video-player");
    const mediaContainer = document.createElement("div");
    mediaContainer.className = "html5-video-container";
    mediaContainer.style.cssText = "position:relative;width:100%;height:0";
    video.replaceWith(mediaContainer);
    mediaContainer.appendChild(video);
  });

  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", nativePlayer: true });
  const visible = await state(page);
  expect(visible.videoWidth).toBeGreaterThan(100);
  expect(visible.videoHeight).toBeGreaterThan(100);
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

test("a stored auto-open mode opens the viewer when playback starts", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { viewerAutoGlobal: "theater" });
  await ready(page);
  await expect
    .poll(async () => sendToContent(serviceWorker, "getViewerAuto"))
    .toMatchObject({ mode: "theater", scope: "global" });
  await page.evaluate(() =>
    document
      .getElementById("host")
      ?.shadowRoot?.querySelector("video")
      ?.play()
      .catch(() => {}),
  );
  await expect
    .poll(() => state(page))
    .toMatchObject({ attr: "theater", overlay: true, originalSurface: true, theaterFits: true });
});

test("auto-open dismissal follows SPA media routes on a reused video element", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { viewerAutoGlobal: "theater" });
  await ready(page);

  const replay = () =>
    page.evaluate(async () => {
      const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
      video?.pause();
      await video?.play().catch(() => {});
    });

  await replay();
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", overlay: true });
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toMatchObject({ attr: null, overlay: false });

  // Closing wins for the current media route.
  await replay();
  await expect(page.locator("[data-vtp-viewer-overlay]")).toHaveCount(0);

  // A SPA navigation reusing the same <video> is a new auto-open opportunity.
  await page.evaluate(() => history.pushState({}, "", "/viewer.html?video=second"));
  await replay();
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", overlay: true });
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toMatchObject({ attr: null, overlay: false });

  // Returning to a route dismissed earlier in this page session stays dismissed.
  await page.evaluate(() => history.pushState({}, "", "/viewer.html"));
  await replay();
  await expect(page.locator("[data-vtp-viewer-overlay]")).toHaveCount(0);
});

test("a stored chat mode stays inert on a non-stream page", async ({ page, serviceWorker }) => {
  await setStorage(serviceWorker, { viewerChatMode: "side" });
  await ready(page);
  await page.keyboard.press("KeyT");
  // Chat is live-Twitch/YouTube/Kick only — on the fixture host the viewer must
  // stay full-width with no chat column or floating panel.
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", theaterFits: true });
  const chat = await page.evaluate(() => ({
    side: !!document.querySelector("[data-vtp-viewer-chat-side]"),
    panel: !!document.querySelector("[data-vtp-viewer-chat-panel]"),
  }));
  expect(chat).toEqual({ side: false, panel: false });
});

test("a stored viewer fit mode is applied to the original video", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { viewerFitGlobal: "fill" });
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect
    .poll(() => state(page))
    .toMatchObject({ attr: "normal", originalSurface: true, objectFit: "fill" });
});

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
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", nativePlayer: true });
  const glassViewer = await measureVideoCadence(page);
  await setStorage(serviceWorker, { viewerBackdropVideo: true });
  await page
    .locator("canvas[data-vtp-viewer-backdrop-video]")
    .waitFor({ state: "attached", timeout: 5000 });
  const videoBackdropViewer = await measureVideoCadence(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater" });
  const theater = await measureVideoCadence(page);

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

test("the launcher exposes a clickable native Picture-in-Picture action", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  await ready(page);

  const launcher = page.getByRole("button", { name: "Open Video Tuner" });
  // The launcher is intentionally non-interactive while hidden. Moving across
  // the video is the real user gesture that reveals it before the FAB can receive
  // hover/click events.
  await page.mouse.move(500, 250);
  await expect(launcher).toHaveCSS("pointer-events", "auto");
  await launcher.hover();
  const pip = page.getByRole("button", { name: "Picture in Picture" });
  await expect(pip).toBeVisible();
  await pip.click();
  await expect(pip).toBeHidden();
  await expect(page.locator("[data-vtp-viewer-overlay]")).toHaveCount(0);
});

test("launcher radial buttons switch viewer formats and close it", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  await ready(page);
  const launcherHost = page.locator("#vtp-launcher-host");
  const launcher = launcherHost.getByRole("button", { name: "Open Video Tuner" });

  await page.mouse.move(500, 250);
  await launcher.hover();
  await clickLauncherAction(page, "Pop out video");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", overlay: true });

  await page.mouse.move(500, 250);
  await launcher.hover();
  await clickLauncherAction(page, "Pop out in theater format");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", overlay: true });

  await page.mouse.move(500, 250);
  await launcher.hover();
  await clickLauncherAction(page, "Close the pop-out viewer");
  await expect.poll(() => state(page)).toMatchObject({ attr: null, overlay: false });
});

test("off launcher mode hides clicks while the keyboard popup still works", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "off" });
  await ready(page);
  await page.mouse.move(500, 250);
  await expect(page.getByRole("button", { name: "Open Video Tuner" })).toHaveCount(0);

  await page.keyboard.press("KeyO");
  await page.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const iframe = document
          .querySelector("[data-vtp-launcher]")
          ?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null;
        return iframe ? getComputedStyle(iframe).display : "missing";
      }),
    )
    .not.toBe("none");
});

test("a launcher click paints the popup above the lifted native Viewer surface", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { overlayButton: "always" });
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", nativePlayer: true });

  await page.mouse.move(500, 250);
  const launcher = page.locator("#vtp-launcher-host").locator("button").first();
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(launcher).toHaveAttribute("data-popup-open", "true");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.querySelector("#vtp-launcher-host");
        const iframe = host?.shadowRoot?.querySelector("iframe");
        if (!(iframe instanceof HTMLIFrameElement)) return null;
        const r = iframe.getBoundingClientRect();
        const style = getComputedStyle(iframe);
        return {
          hostInTopLayer: host?.matches(":popover-open") ?? false,
          width: r.width,
          height: r.height,
          display: style.display,
          visibility: style.visibility,
          opacity: Number(style.opacity),
        };
      }),
    )
    .toMatchObject({
      hostInTopLayer: true,
      display: "block",
      visibility: "visible",
      opacity: 1,
    });
  const box = await page.evaluate(() => {
    const iframe = document
      .querySelector("#vtp-launcher-host")
      ?.shadowRoot?.querySelector("iframe");
    const r = iframe?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  });
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeGreaterThan(200);
  const popupFrame = page.frames().find((frame) => frame.url().includes("/popup/popup.html"));
  expect(popupFrame).toBeTruthy();
  await expect(popupFrame!.locator("body")).toBeVisible();
});

test("the lifted player keeps the site's native controls interactive", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyT");
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", nativePlayer: true });
  await page.locator("#native-control").click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.nativeControl)).toBe("clicked");
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
    return (
      (shadow?.querySelector(".bar") as HTMLElement | null)?.getBoundingClientRect().width ?? 0
    );
  });
  expect(barWidth).toBeLessThanOrEqual(460);
});

test("an SPA transition from live to a near-end VOD restores time and seek", async ({
  page,
  serviceWorker,
}) => {
  await readyLiveWithQuality(page);

  // Keep the same media element and document, like VK's channel → /record SPA
  // transition. The former live page must not leave its six-second sticky verdict
  // behind when the route and media timeline become an ordinary finite VOD.
  await page.evaluate(async () => {
    history.pushState({}, "", "/have_contact/record/record-id");
    const video = document.querySelector("video");
    if (!video) throw new Error("fixture video missing");
    video.srcObject = null;
    video.src = "/sample.webm";
    video.load();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("VOD metadata timeout")), 10_000);
      video.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
    video.currentTime = Math.max(0, video.duration - 4);
  });

  const status = (await sendToContent(serviceWorker, "getSpeed")) as { live?: boolean };
  expect(status.live).toBe(false);
  await page.waitForTimeout(250);

  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", overlay: true, bar: true });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.querySelector("[data-vtp-viewer-overlay]");
        const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
          el.shadowRoot?.querySelector(".bar"),
        )?.shadowRoot;
        const seek = shadow?.querySelector<HTMLInputElement>('input[aria-label="Seek"]');
        return {
          time: shadow?.querySelector(".time")?.textContent?.trim() || "",
          seekDisplay: seek ? getComputedStyle(seek).display : "missing",
        };
      }),
    )
    .toMatchObject({
      time: expect.stringMatching(/^\d+:\d{2} \/ \d+:\d{2}$/),
      seekDisplay: "block",
    });
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

test("viewer arrow keys seek and adjust volume on the real media element", async ({ page }) => {
  await ready(page);
  await page.waitForFunction(() => {
    const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
    return !!video && Number.isFinite(video.duration) && video.duration > 1;
  });
  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal" });
  await page.evaluate(async () => {
    const video = (document.querySelector("[data-vtp-viewer-adopted-video]") ??
      document
        .getElementById("host")
        ?.shadowRoot?.querySelector("video")) as HTMLVideoElement | null;
    if (!video) throw new Error("fixture video missing");
    video.pause();
    video.volume = 0.5;
    const seeked = new Promise<void>((resolve) =>
      video.addEventListener("seeked", () => resolve(), { once: true }),
    );
    video.currentTime = video.duration / 2;
    await seeked;
  });

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const video = (document.querySelector("[data-vtp-viewer-adopted-video]") ??
          document
            .getElementById("host")
            ?.shadowRoot?.querySelector("video")) as HTMLVideoElement | null;
        return { currentTime: video?.currentTime ?? 0, volume: video?.volume ?? 0 };
      }),
    )
    .toMatchObject({ currentTime: expect.any(Number), volume: 0.55 });
  expect(
    await page.evaluate(
      () =>
        (
          (document.querySelector("[data-vtp-viewer-adopted-video]") ??
            document
              .getElementById("host")
              ?.shadowRoot?.querySelector("video")) as HTMLVideoElement | null
        )?.currentTime ?? 0,
    ),
  ).toBeLessThan(0.01);
});

test("buffering forces the hidden viewer bar and spinner back on", async ({ page }) => {
  // The shadow-player fixture takes the native-controls fast path. Use the
  // bare live fixture here to exercise the custom-bar fallback explicitly.
  await readyLiveWithQuality(page);
  await page.keyboard.press("KeyV");
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal" });

  await page.evaluate(async () => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const host = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
      el.shadowRoot?.querySelector(".bar"),
    );
    const bar = host?.shadowRoot?.querySelector<HTMLElement>(".bar");
    if (bar) {
      bar.style.visibility = "hidden";
      bar.style.opacity = "0";
    }
    const video = (document.querySelector("[data-vtp-viewer-adopted-video]") ??
      document
        .getElementById("host")
        ?.shadowRoot?.querySelector("video")) as HTMLVideoElement | null;
    if (!video) throw new Error("fixture video missing");
    await video.play();
    video.dispatchEvent(new Event("waiting"));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.querySelector("[data-vtp-viewer-overlay]");
        const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) =>
          el.shadowRoot?.querySelector(".bar"),
        )?.shadowRoot;
        const bar = shadow?.querySelector<HTMLElement>(".bar");
        const spinner = overlay?.querySelector<HTMLElement>("[data-vtp-viewer-loading]");
        return {
          visibility: bar?.style.visibility,
          barOpacity: bar?.style.opacity,
          spinnerOpacity: spinner?.style.opacity,
        };
      }),
    )
    .toEqual({ visibility: "visible", barOpacity: "1", spinnerOpacity: "1" });
});

test("live catch-up changes playbackRate through the built extension", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { liveSync: true, syncTargetGlobal: 1 });
  await ready(page);
  await page.evaluate(async () => {
    const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
    if (!video) throw new Error("fixture video missing");
    document.documentElement.setAttribute("data-vtp-live", "1");
    document.documentElement.setAttribute("data-vtp-latency", "12");
    video.currentTime = 0;
    await video.play();
    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.waitForFunction(() => {
    const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
    return !!video && !video.paused && video.buffered.length > 0 && video.buffered.end(0) > 2;
  });

  await expect
    .poll(async () => (await sendToContent(serviceWorker, "getSpeed")) as { live?: boolean })
    .toMatchObject({ live: true });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById("host")?.shadowRoot?.querySelector("video")?.playbackRate ?? 1,
      ),
    )
    .toBeGreaterThan(1);
});
