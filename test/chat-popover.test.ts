// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { popoverElevation } from "../src/content/chat/popover.js";

// jsdom has no Popover API — stub the three members the helper touches.
type PopoverHost = HTMLElement & {
  showPopover: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn>;
};

function makeHost(open = () => true): PopoverHost {
  const host = document.createElement("div") as unknown as PopoverHost;
  host.showPopover = vi.fn();
  host.hidePopover = vi.fn();
  host.matches = vi.fn((sel: string) => (sel === ":popover-open" ? open() : false));
  return host;
}

describe("chat popover elevation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays inert when the Popover API is missing", () => {
    const host = document.createElement("div");
    const pop = popoverElevation(host);
    pop.elevate();
    expect(host.hasAttribute("popover")).toBe(false);
    pop.reelevate();
    pop.raise();
    pop.dispose();
  });

  it("elevates once and re-shows a force-closed popover", () => {
    let openNow = true;
    const host = makeHost(() => openNow);
    const pop = popoverElevation(host);
    pop.elevate();
    expect(host.getAttribute("popover")).toBe("manual");
    expect(host.showPopover).toHaveBeenCalledTimes(1);
    pop.elevate(); // idempotent
    expect(host.showPopover).toHaveBeenCalledTimes(1);

    pop.reelevate(); // still open — nothing to do
    expect(host.showPopover).toHaveBeenCalledTimes(1);
    openNow = false;
    pop.reelevate();
    expect(host.showPopover).toHaveBeenCalledTimes(2);
  });

  it("rolls the popover attribute back when showing fails", () => {
    const host = makeHost();
    host.showPopover.mockImplementation(() => {
      throw new Error("nope");
    });
    const pop = popoverElevation(host);
    pop.elevate();
    expect(host.hasAttribute("popover")).toBe(false);
    pop.raise(); // never elevated — no-op
    expect(host.hidePopover).not.toHaveBeenCalled();
  });

  it("raise() re-appends via hide+show, only while elevated", () => {
    const host = makeHost();
    const pop = popoverElevation(host);
    pop.raise(); // not elevated yet
    expect(host.hidePopover).not.toHaveBeenCalled();
    pop.elevate();
    pop.raise();
    expect(host.hidePopover).toHaveBeenCalledTimes(1);
    expect(host.showPopover).toHaveBeenCalledTimes(2); // elevate + raise
  });

  it("dispose() hides and blocks every later call", () => {
    const host = makeHost();
    const pop = popoverElevation(host);
    pop.elevate();
    pop.dispose();
    expect(host.hidePopover).toHaveBeenCalledTimes(1);
    pop.elevate();
    pop.reelevate();
    pop.raise();
    expect(host.showPopover).toHaveBeenCalledTimes(1); // only the first elevate
  });
});
