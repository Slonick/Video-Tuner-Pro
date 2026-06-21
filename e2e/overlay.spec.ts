import { test, expect, setStorage, clearStorage } from "./fixtures/extension.js";
import type { Page, Frame } from "@playwright/test";

// The on-video overlay must be TRANSPARENT (the video shows through the glass) AND
// themed to the OS — on every site, including ones that force their own scheme
// (Facebook forces it via <meta>). Chrome's rule: the iframe is transparent only
// when its color-scheme matches the HOST's used scheme (a mismatch paints an opaque
// backdrop). The launcher resolves the host scheme + the OS and passes both; the
// popup sets color-scheme to match the host (transparency) and themes the glass to
// the OS (decoupled). Two fixtures: a normal host and a Facebook-like <meta> host.
//
// Caveat: emulateMedia (the only headless dark-OS knob) also feeds the launcher's
// matchMedia, so the OS passed to the popup is what we emulate — which is the point.

async function openOverlay(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector("#v");
  await page.mouse.move(400, 300);
  await page.keyboard.press("KeyO");
  await page.waitForFunction(
    () => !!document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe"),
  );
  await expect.poll(() => !!overlayFrame(page)).toBe(true);
}

function overlayFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().includes("/popup/popup.html"));
}

async function showsPageThrough(page: Page): Promise<boolean> {
  const box = await page.evaluate(() => {
    const f = document.querySelector("[data-vtp-launcher]")?.shadowRoot?.querySelector("iframe") as
      | HTMLIFrameElement
      | null
      | undefined;
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  expect(box).not.toBeNull();
  const clip = {
    x: Math.round(box!.x + box!.width / 2 - 80),
    y: Math.round(box!.y + 6),
    width: 160,
    height: 36,
  };
  await page.waitForTimeout(600);
  const a = await page.screenshot({ clip });
  await page.evaluate(() => {
    (document.getElementById("bg") as HTMLElement).style.background = "#cc0000";
  });
  await page.waitForTimeout(300);
  const b = await page.screenshot({ clip });
  return Buffer.compare(a, b) !== 0; // recolouring the page changed the glass → transparent
}

async function bodyIsDark(page: Page): Promise<boolean> {
  const color = await overlayFrame(page)!.evaluate(() => getComputedStyle(document.body).color);
  const [r, g, b] = color.match(/\d+/g)!.map(Number);
  return Math.min(r, g, b) > 180; // near-white text → dark theme
}

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

const HOSTS = [
  { name: "normal", path: "/overlay.html" },
  { name: "meta-color-scheme (Facebook-like)", path: "/overlay-meta.html" },
];

for (const host of HOSTS) {
  for (const os of ["dark", "light"] as const) {
    test(`${host.name} host: transparent + ${os} theme under a ${os} OS`, async ({
      page,
      serviceWorker,
    }) => {
      await setStorage(serviceWorker, { theme: "system", overlayButton: "always" });
      await page.emulateMedia({ colorScheme: os });
      await openOverlay(page, host.path);
      // The glass shows the page through it...
      expect(await showsPageThrough(page)).toBe(true);
      // ...and the theme follows the OS (not the host's forced scheme).
      await expect.poll(() => bodyIsDark(page)).toBe(os === "dark");
    });
  }
}
