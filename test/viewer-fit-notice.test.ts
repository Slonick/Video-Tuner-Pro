// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  keys: [] as string[],
  setViewerFitMode: vi.fn((mode: unknown) => mode),
}));

vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));
vi.mock("../src/content/viewer.js", () => ({ setViewerFitMode: h.setViewerFitMode }));

import { STORE } from "../src/content/platform/storage.js";
import { applyResolvedViewerFitFromStore } from "../src/content/viewer-fit.js";

beforeEach(() => {
  h.keys = [];
  h.setViewerFitMode.mockClear();
  STORE.set({ viewerFitSites: {}, viewerFitChannels: {} });
  STORE.remove(["viewerFitGlobal"]);
});

describe("viewer fit notices", () => {
  it("applies resolved fit changes without interactive notification", () => {
    STORE.set({ viewerFitSites: { localhost: "cover" } });

    applyResolvedViewerFitFromStore();

    expect(h.setViewerFitMode).toHaveBeenCalledWith("cover");
    expect(h.setViewerFitMode.mock.calls[0]).toEqual(["cover"]);
  });
});
