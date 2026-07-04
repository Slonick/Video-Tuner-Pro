// Opt-in smoke against real Google Chrome and real network video pages.
//
// Usage:
//   npm run test:real-chrome
//   REAL_CHROME_SITES=youtube,twitch,boosty,kick npm run test:real-chrome
//
// The test uses one browser page and navigates it between targets so it never
// opens multiple video tabs at once.
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensionPath = path.join(root, "dist/chrome");

interface Target {
  name: string;
  url: string;
  video: string;
  consent?: string;
}

const TARGETS: Record<string, Target> = {
  youtube: {
    name: "youtube",
    url: process.env.REAL_CHROME_YOUTUBE_URL || "https://www.youtube.com/watch?v=YgoTpwTJIOQ",
    video: "video.html5-main-video",
    consent:
      'button:has-text("Reject all"), button:has-text("Отклонить все"), button:has-text("Accept all")',
  },
  boosty: {
    name: "boosty",
    url:
      process.env.REAL_CHROME_BOOSTY_URL ||
      "https://boosty.to/?layer=video%3Asnailkick%3A43310146-d1d1-4a58-b5eb-3aa39b9f3409%3A7e32cfc1-cf04-4fbd-ba42-063302be44e7",
    video: "video",
  },
  twitch: {
    name: "twitch",
    url: process.env.REAL_CHROME_TWITCH_URL || "https://www.twitch.tv/recrent",
    video: "video",
  },
  kick: {
    name: "kick",
    url: process.env.REAL_CHROME_KICK_URL || "https://kick.com/fissure_cs_ru2",
    video: "video",
    consent: 'button:has-text("Accept all")',
  },
};

test.setTimeout(240_000);
test.skip(!process.env.REAL_CHROME, "real Google Chrome smoke is opt-in");

function findChromeForTesting(): string | undefined {
  if (process.env.REAL_CHROME_EXECUTABLE) return process.env.REAL_CHROME_EXECUTABLE;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  try {
    const versions = fs
      .readdirSync(cache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const version of versions) {
      const executable = path.join(
        cache,
        version,
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      );
      if (fs.existsSync(executable)) return executable;
    }
  } catch {
    /* fall back to the installed Chrome channel */
  }
  const app = "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  return fs.existsSync(app) ? app : undefined;
}

function selectedTargets(): Target[] {
  const names = (process.env.REAL_CHROME_SITES || "youtube,twitch,boosty,kick")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.map((name) => {
    const target = TARGETS[name];
    if (!target) throw new Error(`Unknown REAL_CHROME_SITES entry: ${name}`);
    return target;
  });
}

async function dismissConsent(page: Page, selector?: string): Promise<void> {
  if (!selector) return;
  try {
    await page.locator(selector).first().click({ timeout: 7000 });
  } catch {
    /* no consent wall */
  }
}

async function ensureRealChrome(page: Page): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent, "test must run in real Google Chrome").toContain("Chrome/");
  expect(userAgent, "test must not run in Chromium's headless shell").not.toContain("HeadlessChrome");
}

async function startPageVideo(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: 45_000 });
  try {
    await page.locator(selector).first().click({ timeout: 5000 });
  } catch {
    /* some players hide the real video under their own controls */
  }
  await page.evaluate((videoSelector) => {
    const video = document.querySelector(videoSelector) as HTMLVideoElement | null;
    if (!video) return;
    video.muted = true;
    void video.play().catch(() => {});
  }, selector);
  await expect
    .poll(
      () =>
        page.evaluate((videoSelector) => {
          const video = document.querySelector(videoSelector) as HTMLVideoElement | null;
          return !!video && !video.paused && video.readyState >= 2;
        }, selector),
      { timeout: 30_000 },
    )
    .toBe(true);
  const playerError = page.getByText("Something went wrong. Refresh or try again later").first();
  await expect(playerError, "YouTube player error").toHaveCount(0, { timeout: 2000 });
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", {
    predicate: (worker) => worker.url().startsWith("chrome-extension://"),
    timeout: 15_000,
  });
}

async function seedHarnessSettings(context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async () => {
    await Promise.all([
      chrome.storage.local.set({ overlayButton: "always" }),
      chrome.storage.sync.set({ overlayButton: "always" }),
    ]);
  });
}

async function forceInjectContentScripts(page: Page): Promise<void> {
  const worker = await extensionWorker(page.context());
  await worker.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === pageUrl) || tabs.find((item) => item.active);
    if (!tab?.id) throw new Error(`Cannot find Chrome tab for ${pageUrl}`);
    const target = { tabId: tab.id };
    await chrome.scripting.executeScript({ target, files: ["quality-inject.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target, files: ["audio-inject.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target, files: ["inject.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target, files: ["content.js"] });
  }, page.url());
}

async function enterTheaterViewer(page: Page): Promise<void> {
  await page.mouse.move(500, 350);
  const theater = page.locator('button[aria-label="Pop out in theater format"]').first();
  try {
    await expect(theater, "extension theater launcher").toBeVisible({ timeout: 8000 });
  } catch (error) {
    await forceInjectContentScripts(page);
    try {
      await expect(theater, "extension theater launcher after chrome.scripting injection").toBeVisible(
        { timeout: 30_000 },
      );
    } catch (injectionError) {
      const workers = page.context().serviceWorkers().map((worker) => worker.url());
      throw new Error(
        [
          "Video Tuner Pro did not inject into the real Chrome page.",
          `Extension path: ${extensionPath}`,
          `Chrome executable: ${findChromeForTesting() || "installed chrome channel"}`,
          `Extension service workers: ${workers.join(", ") || "none"}`,
          "If this used branded Chrome 137+, side-loading is blocked there; use Chrome for Testing or set REAL_CHROME_EXECUTABLE to one.",
        ].join("\n"),
        { cause: injectionError || error },
      );
    }
  }
  await theater.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("[data-vtp-viewer-overlay]"), "viewer overlay").toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const overlay = document.querySelector("[data-vtp-viewer-overlay]");
          const video = overlay?.querySelector("video") as HTMLVideoElement | null;
          return !!video && !video.paused && video.readyState >= 2;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

interface QualityState {
  visible: boolean;
  label: string;
  options: string[];
  time: number;
  paused: boolean;
  barWidth: number;
  timeText: string;
  sourceHeight: number;
  sourceWidth: number;
}

async function qualityState(page: Page): Promise<QualityState> {
  return page.evaluate(() => {
    const overlay = document.querySelector("[data-vtp-viewer-overlay]");
    const shadow = (Array.from(overlay?.children ?? []) as HTMLElement[]).find((el) => el.shadowRoot)
      ?.shadowRoot;
    const qwrap = shadow?.querySelector(".qwrap") as HTMLElement | null;
    const bar = shadow?.querySelector(".bar") as HTMLElement | null;
    const timeEl = shadow?.querySelector(".time") as HTMLElement | null;
    const label = qwrap?.querySelector(".qbtn-label")?.textContent?.trim() || "";
    const options = Array.from(qwrap?.querySelectorAll(".qitem") ?? []).map(
      (item) => item.textContent?.trim() || "",
    );
    const video = overlay?.querySelector("video") as HTMLVideoElement | null;
    const source = document.querySelector("video") as HTMLVideoElement | null;
    return {
      visible: qwrap?.style.display === "block",
      label,
      options,
      time: video?.currentTime ?? -1,
      paused: video?.paused ?? true,
      barWidth: bar?.getBoundingClientRect().width ?? 0,
      timeText: timeEl?.textContent?.trim() || "",
      sourceHeight: source?.videoHeight ?? 0,
      sourceWidth: source?.videoWidth ?? 0,
    };
  });
}

async function openQualityMenu(page: Page): Promise<QualityState> {
  await expect
    .poll(() => qualityState(page).then((state) => state.visible), { timeout: 30_000 })
    .toBe(true);
  const qwrap = page.locator("[data-vtp-viewer-overlay] .qwrap").first();
  await qwrap.locator("> button").click();
  await expect
    .poll(() => qualityState(page).then((state) => state.options.length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  return qualityState(page);
}

function pickQuality(state: QualityState): string {
  const fixed = state.options.filter((label) => /\d+p/i.test(label));
  const target =
    fixed.find((label) => label !== state.label) ||
    state.options.find((label) => label !== state.label);
  if (!target) throw new Error(`No different quality option in ${JSON.stringify(state)}`);
  return target;
}

function compactQualityLabel(label: string): string {
  const match = label.match(/(\d{3,4})p(?:\d+)?/i);
  return match ? `${match[1]}p` : label.trim();
}

function qualityHeight(label: string): number | null {
  const match = label.match(/(\d{3,4})p/i);
  return match ? Number(match[1]) : null;
}

async function switchQualityAndAssertPlayback(page: Page): Promise<{
  before: QualityState;
  target: string;
  after: QualityState;
}> {
  const before = await openQualityMenu(page);
  const target = pickQuality(before);
  const expectedLabel = compactQualityLabel(target);
  const qwrap = page.locator("[data-vtp-viewer-overlay] .qwrap").first();
  await qwrap.locator(".qitem", { hasText: target }).click();
  await expect
    .poll(() => qualityState(page).then((state) => state.label), { timeout: 10_000 })
    .toBe(expectedLabel);
  await expect
    .poll(() => qualityState(page).then((state) => state.time), { timeout: 15_000 })
    .toBeGreaterThan(before.time + 0.5);
  const after = await qualityState(page);
  expect(after.paused, "video keeps playing after quality switch").toBe(false);
  expect(after.label, "selected quality label stays visible").toBe(expectedLabel);
  const expectedHeight = qualityHeight(target);
  if (expectedHeight) {
    await expect
      .poll(() => qualityState(page).then((state) => state.sourceHeight), { timeout: 20_000 })
      .toBe(expectedHeight);
  }
  expect(after.barWidth, "viewer bar stays inside the viewport").toBeLessThanOrEqual(760);
  return { before, target, after };
}

test("viewer quality switches on real video pages in real Google Chrome", async ({}, testInfo) => {
  const chromeExecutable = findChromeForTesting();
  const launchOptions = {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "--autoplay-policy=no-user-gesture-required",
    ],
    ...(chromeExecutable ? { executablePath: chromeExecutable } : { channel: "chrome" as const }),
  };
  const context: BrowserContext = await chromium.launchPersistentContext(
    testInfo.outputPath("chrome-profile"),
    launchOptions,
  );
  const page = context.pages()[0] || (await context.newPage());
  const results: Record<string, unknown> = {};

  try {
    await ensureRealChrome(page);
    await seedHarnessSettings(context);

    for (const target of selectedTargets()) {
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await dismissConsent(page, target.consent);
      await startPageVideo(page, target.video);
      await enterTheaterViewer(page);
      results[target.name] = await switchQualityAndAssertPlayback(page);
      await page.screenshot({ path: testInfo.outputPath(`${target.name}-quality.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-vtp-viewer-overlay]")).toHaveCount(0, { timeout: 10_000 });
    }
  } finally {
    await context.close();
  }

  console.log("REAL_CHROME_QUALITY:", JSON.stringify(results, null, 2));
});
