// @vitest-environment jsdom
// The hook is small glue, but it owns two important contracts: it must expose
// the latest tab id and guide-line values to the polling loop after the popup
// resolves them, and it must route poll status to the latest React callbacks
// without restarting the loop on every render.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useGraphs", () => {
  it("keeps the poller stable while exposing current tab, guides and callbacks", async () => {
    const cleanup = vi.fn();
    const setupGraphs = vi.fn(() => cleanup);
    vi.doMock("../src/popup/graphs/index.js", () => ({ setupGraphs }));
    const { useGraphs } = await import("../src/popup/hooks/useGraphs.js");

    const firstTranslating = vi.fn();
    const firstBlocked = vi.fn();
    const secondTranslating = vi.fn();
    const secondBlocked = vi.fn();
    let root: Root | null = createRoot(document.createElement("div"));

    function Harness({
      tab,
      translating,
      blocked,
      threshold,
      target,
    }: {
      tab: number | null;
      translating: (on: boolean) => void;
      blocked: (reason: string | null) => void;
      threshold: number;
      target: number;
    }) {
      useGraphs(tab, translating, blocked, { threshold, target });
      return null;
    }

    act(() => {
      root!.render(
        createElement(Harness, {
          tab: 5,
          translating: firstTranslating,
          blocked: firstBlocked,
          threshold: -60,
          target: 5,
        }),
      );
    });

    expect(setupGraphs).toHaveBeenCalledOnce();
    const [getTab, onTranslating, onBlocked, getGuides] = setupGraphs.mock.calls[0] as [
      () => number | null,
      (on: boolean) => void,
      (reason: string | null) => void,
      () => { threshold: number; target: number },
    ];
    expect(getTab()).toBe(5);
    expect(getGuides()).toEqual({ threshold: -60, target: 5 });
    onTranslating(true);
    onBlocked("capture-denied");
    expect(firstTranslating).toHaveBeenCalledWith(true);
    expect(firstBlocked).toHaveBeenCalledWith("capture-denied");

    act(() => {
      root!.render(
        createElement(Harness, {
          tab: 9,
          translating: secondTranslating,
          blocked: secondBlocked,
          threshold: -24,
          target: 12,
        }),
      );
    });
    expect(setupGraphs).toHaveBeenCalledOnce();
    expect(getTab()).toBe(9);
    expect(getGuides()).toEqual({ threshold: -24, target: 12 });
    onTranslating(false);
    onBlocked(null);
    expect(secondTranslating).toHaveBeenCalledWith(false);
    expect(secondBlocked).toHaveBeenCalledWith(null);
    expect(firstTranslating).toHaveBeenCalledOnce();

    act(() => root!.unmount());
    root = null;
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
