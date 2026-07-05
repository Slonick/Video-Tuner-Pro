// @vitest-environment jsdom
// Extra popup-card branches the existing popup-*.test.ts don't reach: the live-
// stream lock, and the SaveScope "remember" popover (open → save to a scope →
// the content-script `remember` message goes out).
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush } from "./mocks/mount-popup.js";

const YT = { id: 7, url: "https://www.youtube.com/watch?v=x" };

describe("popup · live stream", () => {
  it("locks the speed card and surfaces the live warning on a stream", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: true },
      },
    });
    await flush();
    // The live warning chip is shown (display flips from none → inline-flex)…
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    // …and the speed section carries the locked class.
    expect(document.querySelector(".speed-section")!.className).toMatch(/locked/);
  });
});

describe("popup · protected video", () => {
  it("disables the viewer card when the active video is DRM-protected", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", drm: true },
      },
    });
    await flush();
    expect(byId("viewerAutoToggle")).toHaveProperty("disabled", true);
    expect(document.querySelector(".viewer-auto-section")!.className).toMatch(/locked/);
    expect(document.querySelector(".viewer-drm-note")?.textContent).toContain("Protected video");
  });
});

describe("popup · SaveScope remember", () => {
  it("opens the save menu and remembers the speed for a scope", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click();
    await flush();
    byId("setDefaultBtn").click(); // open the "Save for…" popover
    await flush();
    const primary = document.querySelector<HTMLElement>(".scope-menu .scope-primary");
    expect(primary).toBeTruthy();
    primary!.click(); // save the current speed for the active scope
    await flush();
    expect(lastCall("remember")).toMatchObject({ action: "remember" });
  });
});
