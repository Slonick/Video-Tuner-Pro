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
