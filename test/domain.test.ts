// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// The popup keys site settings and the blacklist by the tab's host, so every frame —
// an embedded player included — has to land on that same host.
type Reply = { tab?: { id?: number; url?: string } } | undefined;
type Send = (message: { action?: string }, callback: (reply?: Reply) => void) => unknown;

const realTop = Object.getOwnPropertyDescriptor(window, "top");

// Load core/domain fresh in a frame at `url`, with `send` as runtime.sendMessage. A
// subframe sees its embedders in ancestorOrigins (Chromium, Firefox 148+, top last);
// older Firefox has none.
async function frameAt(
  url: string,
  frame: { subframe?: boolean; ancestorOrigins?: string[] },
  send: Send,
) {
  const u = new URL(url);
  vi.stubGlobal("location", {
    hostname: u.hostname,
    pathname: u.pathname,
    href: u.href,
    ancestorOrigins: frame.ancestorOrigins,
  });
  if (frame.subframe) Object.defineProperty(window, "top", { value: {}, configurable: true });
  vi.stubGlobal("chrome", { runtime: { lastError: null, sendMessage: send } });
  vi.resetModules();
  return import("../src/content/core/domain.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (realTop) Object.defineProperty(window, "top", realTop);
});

describe("getDomain: the tab's host, in every frame", () => {
  it("top frame: its own host, ready at once without asking the background", async () => {
    const send = vi.fn<Send>();
    const { getDomain, whenDomainReady } = await frameAt("https://www.news.example/a", {}, send);
    const ready = vi.fn();

    whenDomainReady(ready);

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
    expect(send).not.toHaveBeenCalled();
  });

  it("subframe with ancestorOrigins: the top page's host, ready at once", async () => {
    const send = vi.fn<Send>();
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true, ancestorOrigins: ["https://ads.example", "https://www.news.example"] },
      send,
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
    expect(send).not.toHaveBeenCalled();
  });

  it("subframe without ancestorOrigins: asks the background once, then takes the tab's host", async () => {
    const answers: Array<(reply?: Reply) => void> = [];
    const send = vi.fn<Send>((_message, callback) => {
      answers.push(callback);
    });
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      send,
    );
    const first = vi.fn();
    const second = vi.fn();

    whenDomainReady(first);
    whenDomainReady(second);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toEqual({ action: "whoami" });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    answers[0]({ tab: { id: 3, url: "https://m.news.example/live?id=1" } });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
    const later = vi.fn();
    whenDomainReady(later);
    expect(later).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("asks the background when the embedder's referrer policy masks the top origin", async () => {
    const send = vi.fn<Send>((_message, callback) => {
      callback({ tab: { url: "https://news.example/" } });
    });
    const { getDomain, whenDomainReady } = await frameAt(
      "https://player.example/v/1",
      { subframe: true, ancestorOrigins: ["null"] },
      send,
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    expect(send).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
  });

  it("takes the answer from a returned promise (Firefox's browser.runtime)", async () => {
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      () => Promise.resolve({ tab: { url: "https://news.example/watch" } }),
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(getDomain()).toBe("news.example");
  });

  it.each([
    ["no reply", undefined],
    ["a tab without a URL", { tab: { id: 3 } }],
    ["a reply without a tab", {}],
  ])("falls back to the frame's own host on %s", async (_case, reply) => {
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      (_message, callback) => callback(reply),
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("youtube.com");
  });

  it("falls back to the frame's own host when the background rejects", async () => {
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      () => Promise.reject(new Error("Receiving end does not exist")),
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(getDomain()).toBe("youtube.com");
  });

  it("falls back to the frame's own host when sendMessage throws (orphaned script)", async () => {
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      () => {
        throw new Error("Extension context invalidated.");
      },
    );
    const ready = vi.fn();

    whenDomainReady(ready);

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("youtube.com");
  });

  it("keeps the first answer when both the callback and a returned promise answer", async () => {
    const lateReply = Promise.resolve({ tab: { url: "https://other.example/" } });
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      (_message, callback) => {
        callback({ tab: { url: "https://news.example/" } });
        return lateReply;
      },
    );
    const ready = vi.fn();

    whenDomainReady(ready);
    // whenDomainReady subscribed to lateReply first, so its handler has run by now.
    await lateReply;

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
  });

  it("waits for the callback when sendMessage returns a non-promise value", async () => {
    const answers: Array<(reply?: Reply) => void> = [];
    const { getDomain, whenDomainReady } = await frameAt(
      "https://www.youtube.com/embed/abc",
      { subframe: true },
      (_message, callback) => {
        answers.push(callback);
        return true;
      },
    );
    const ready = vi.fn();

    whenDomainReady(ready);
    expect(ready).not.toHaveBeenCalled();

    answers[0]({ tab: { url: "https://news.example/" } });

    expect(ready).toHaveBeenCalledOnce();
    expect(getDomain()).toBe("news.example");
  });
});

describe("normalizeHost", () => {
  it("strips only a leading www./m. label", async () => {
    const { normalizeHost } = await import("../src/content/core/domain.js");
    expect(normalizeHost("WWW.twitch.tv")).toBe("twitch.tv");
    expect(normalizeHost("m.youtube.com")).toBe("youtube.com");
    expect(normalizeHost("stream.example.com")).toBe("stream.example.com");
    expect(normalizeHost("shop.www.example.com")).toBe("shop.www.example.com");
    expect(normalizeHost(null)).toBe("");
  });
});
