// Playwright fixture that loads the BUILT Chrome extension (dist/chrome) into a
// persistent context and exposes its id + service worker. Headless extension
// loading needs the new headless mode, so we pass --headless=new manually and
// leave Playwright's own headless flag off.
import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const pathToExtension = path.join(root, "dist/chrome");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        "--headless=new",
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        // Let media autoplay and the AudioContext start without a gesture so the
        // compressor graph can engage in headless.
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    // Wait for the first-install seed before a test clears or overrides storage.
    // Without this barrier, the async onInstalled callback can write the shipped
    // globalSpeed=1 after a test has already seeded 1.75/2, producing a genuine
    // race that only appears on a loaded CI runner.
    await sw.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [sync, local] = await Promise.all([
          chrome.storage.sync.get(["globalSpeed", "syncTargetGlobal", "liveSyncTarget"]),
          chrome.storage.local.get(["globalSpeed", "syncTargetGlobal", "liveSyncTarget"]),
        ]);
        const stored = { ...sync, ...local };
        if (
          stored.globalSpeed !== undefined &&
          (stored.syncTargetGlobal !== undefined || stored.liveSyncTarget !== undefined)
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("extension first-install storage seed timed out");
    });
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split("/")[2]);
  },
});

export const expect = test.expect;

// Drive the content script through the service worker — the same message contract
// the popup uses. Returns the content script's reply.
export async function sendToContent(
  sw: Worker,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return sw.evaluate(
    async ({ action, extra }) => {
      const [tab] = await chrome.tabs.query({ url: "*://localhost/*" });
      return await chrome.tabs.sendMessage(tab.id!, { action, ...extra });
    },
    { action, extra },
  );
}

// Read/seed the extension's sync storage from the service worker.
export async function setStorage(sw: Worker, obj: Record<string, unknown>): Promise<void> {
  await sw.evaluate((obj) => chrome.storage.sync.set(obj), obj);
}
export async function clearStorage(sw: Worker): Promise<void> {
  await sw.evaluate(() => chrome.storage.sync.clear());
}

// The routed store (shared/store.ts) splits keys between sync and local; the
// options/popup UIs write through it. For tests we read the union of both areas
// (sync wins on the rare overlap) and clear both for a clean slate.
export async function readStored(
  sw: Worker,
  keys: string | string[] | null,
): Promise<Record<string, unknown>> {
  return (await sw.evaluate(async (keys) => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(keys ?? null),
      chrome.storage.sync.get(keys ?? null),
    ]);
    return { ...local, ...sync };
  }, keys)) as Record<string, unknown>;
}
export async function clearAll(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
}

// Open one of the extension's own pages (popup / options) as a real tab the test
// can click — Playwright drives it directly (no cross-extension sandbox).
export async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
): Promise<import("@playwright/test").Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}
