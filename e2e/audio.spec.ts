import { test, expect, sendToContent, setStorage, clearStorage } from "./fixtures/extension.js";

type Monitor = { audio: { active: boolean; enabled: boolean } };

test.beforeEach(async ({ serviceWorker }) => {
  await clearStorage(serviceWorker);
});

// The real proof the Web Audio compressor works (which jsdom can't give): with
// compression enabled, a graph actually routes the same-origin video's audio.
test("enabling compression engages a real Web Audio graph on the video", async ({
  page,
  serviceWorker,
}) => {
  await setStorage(serviceWorker, { audioComp: true });
  await page.goto("/");
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
