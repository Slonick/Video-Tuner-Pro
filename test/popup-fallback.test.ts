// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush } from "./mocks/mount-popup.js";

// When the popup can't resolve a content-script tab (no tab id, so no receiver), the
// speed/live-sync/auto-slow cards fall back to chrome.storage instead of messaging.
// These drive the fromStorage / fallback branches in useSpeed (and the shared no-tab
// guard the other two hooks take).
const NO_ID = { url: "https://example.com/" } as unknown as { id: number; url: string };

describe("popup · no-tab storage fallback", () => {
  it("shows the stored global speed when there's no content-script tab", async () => {
    await mountApp({ tab: NO_ID, settings: { globalSpeed: 1.5 } });
    await flush();
    expect(byId("currentSpeedPct").textContent).toBe("150%");
  });

  it("prefers a per-site speed over the global default", async () => {
    await mountApp({
      tab: NO_ID,
      settings: { globalSpeed: 1.5, domains: { "example.com": 1.75 } },
    });
    await flush();
    expect(byId("currentSpeedPct").textContent).toBe("175%");
  });

  it("the reset button falls back to storage without a tab", async () => {
    await mountApp({ tab: NO_ID, settings: { globalSpeed: 1.4 } });
    await flush();
    byId("speedReset").click(); // useSpeed.resetManual → no-tab fromStorage branch
    await flush();
    expect(byId("currentSpeedPct").textContent).toBe("140%");
  });
});
