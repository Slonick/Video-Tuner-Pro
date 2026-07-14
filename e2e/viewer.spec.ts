import { test, expect, clearAll, setStorage, sendToContent } from "./fixtures/extension.js";

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
      objectFit: overlayVideo?.style.objectFit || "",
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
    .toMatchObject({ attr: "theater", overlay: true, mirrored: true, theaterFits: true });
});

test("a stored viewer fit mode is applied to the mirrored video", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { viewerFitGlobal: "fill" });
  await ready(page);
  await page.keyboard.press("KeyV");
  await expect
    .poll(() => state(page))
    .toMatchObject({ attr: "normal", mirrored: true, objectFit: "fill" });
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
  await launcherHost.getByRole("button", { name: "Pop out video" }).click();
  await expect.poll(() => state(page)).toMatchObject({ attr: "normal", overlay: true });

  await page.mouse.move(500, 250);
  await launcher.hover();
  await launcherHost.getByRole("button", { name: "Pop out in theater format" }).click();
  await expect.poll(() => state(page)).toMatchObject({ attr: "theater", overlay: true });

  await page.mouse.move(500, 250);
  await launcher.hover();
  await launcherHost.getByRole("button", { name: "Close the pop-out viewer" }).click();
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
    const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
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
        const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
        return { currentTime: video?.currentTime ?? 0, volume: video?.volume ?? 0 };
      }),
    )
    .toMatchObject({ currentTime: expect.any(Number), volume: 0.55 });
  expect(
    await page.evaluate(
      () => document.getElementById("host")?.shadowRoot?.querySelector("video")?.currentTime ?? 0,
    ),
  ).toBeLessThan(0.01);
});

test("buffering forces the hidden viewer bar and spinner back on", async ({ page }) => {
  await ready(page);
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
    const video = document.getElementById("host")?.shadowRoot?.querySelector("video");
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
