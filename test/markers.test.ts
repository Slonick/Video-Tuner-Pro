// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isYouTube,
  hasNativeSponsorBlock,
  youTubeVideoId,
  parseTimestampList,
  chapterStartsFromWidths,
  readYouTubeChapters,
  fetchSponsorSegments,
  SPONSOR_COLORS,
} from "../src/content/markers.js";

describe("isYouTube / youTubeVideoId", () => {
  it("recognises YouTube hosts", () => {
    expect(isYouTube("www.youtube.com")).toBe(true);
    expect(isYouTube("youtube-nocookie.com")).toBe(true);
    expect(isYouTube("youtu.be")).toBe(true);
    expect(isYouTube("boosty.to")).toBe(false);
  });

  it("extracts the video id from the URL shapes YouTube uses", () => {
    expect(youTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://www.youtube.com/shorts/abc123def45")).toBe("abc123def45");
    expect(youTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://www.youtube.com/feed/history")).toBeNull();
    expect(youTubeVideoId("not a url")).toBeNull();
  });
});

describe("hasNativeSponsorBlock", () => {
  it("detects SponsorBlock DOM markers", () => {
    document.body.innerHTML = '<div id="sponsorblock-document-script"></div>';
    expect(hasNativeSponsorBlock()).toBe(true);
    document.body.innerHTML = '<ul id="previewbar" class="sbNotInvidious"></ul>';
    expect(hasNativeSponsorBlock()).toBe(true);
    document.body.innerHTML = '<span id="sponsorBlockDurationAfterSkips">(27:46)</span>';
    expect(hasNativeSponsorBlock()).toBe(true);
  });

  it("ignores unrelated sponsor-looking page content", () => {
    document.body.innerHTML = '<div id="sponsor-button"></div>';
    expect(hasNativeSponsorBlock()).toBe(false);
  });
});

describe("parseTimestampList", () => {
  it("parses a real chapter list from description text", () => {
    const text =
      "Intro text\n0:00 Начало\n2:31 — Тема\n1:02:33 Финал\nspam 4:55 mid-line is ignored";
    expect(parseTimestampList(text)).toEqual([
      { start: 0, title: "Начало" },
      { start: 151, title: "Тема" },
      { start: 3753, title: "Финал" },
    ]);
  });

  it("parses timestamp lists with bullets and numbered prefixes", () => {
    expect(parseTimestampList("• 0:00 Старт\n1) 0:30 Середина\n- 1:00 Финал")).toEqual([
      { start: 0, title: "Старт" },
      { start: 30, title: "Середина" },
      { start: 60, title: "Финал" },
    ]);
  });

  it("rejects lists that don't start at 0:00 or aren't increasing", () => {
    expect(parseTimestampList("2:00 a\n3:00 b")).toEqual([]);
    expect(parseTimestampList("0:00 a\n5:00 b\n4:00 c")).toEqual([]);
    expect(parseTimestampList("0:00 only one")).toEqual([]);
  });
});

describe("chapterStartsFromWidths", () => {
  it("maps proportional widths onto start times", () => {
    expect(chapterStartsFromWidths([25, 25, 50], 100)).toEqual([0, 25, 50]);
  });

  it("bails on a single chapter or bad duration", () => {
    expect(chapterStartsFromWidths([100], 100)).toEqual([]);
    expect(chapterStartsFromWidths([1, 1], Infinity)).toEqual([]);
    expect(chapterStartsFromWidths([0, 0], 100)).toEqual([]);
  });
});

describe("readYouTubeChapters", () => {
  function buildBar(widths: number[], desc = "") {
    document.body.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "ytp-chapters-container";
    for (const w of widths) {
      const c = document.createElement("div");
      c.getBoundingClientRect = () => ({ width: w }) as DOMRect;
      bar.appendChild(c);
    }
    document.body.appendChild(bar);
    if (desc) {
      const d = document.createElement("div");
      d.id = "description";
      d.textContent = desc;
      document.body.appendChild(d);
    }
  }

  it("takes boundaries from the player bar and titles from the description", () => {
    buildBar([50, 50], "0:00 Один\n0:50 Два");
    expect(readYouTubeChapters(100)).toEqual([
      { start: 0, title: "Один" },
      { start: 50, title: "Два" },
    ]);
  });

  it("matches titles by start time instead of exact list length", () => {
    buildBar([50, 50], "0:00 Один\n0:10 Х\n0:50 Два");
    expect(readYouTubeChapters(100).map((c) => c.title)).toEqual(["Один", "Два"]);
  });

  it("takes titles from chapter DOM when YouTube exposes them there", () => {
    buildBar([50, 50]);
    const [first, second] = Array.from(document.querySelectorAll(".ytp-chapters-container > *"));
    first.setAttribute("aria-label", "Один");
    const title = document.createElement("span");
    title.className = "ytp-chapter-title-content";
    title.textContent = "Два";
    second.appendChild(title);
    expect(readYouTubeChapters(100).map((c) => c.title)).toEqual(["Один", "Два"]);
  });

  it("keeps boundaries untitled when no source has matching titles", () => {
    buildBar([50, 50], "0:10 Х");
    expect(readYouTubeChapters(100).map((c) => c.title)).toEqual(["", ""]);
  });

  it("returns [] without a chapters container", () => {
    document.body.innerHTML = "";
    expect(readYouTubeChapters(100)).toEqual([]);
  });
});

describe("fetchSponsorSegments", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps the API response and filters malformed entries", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { segment: [10, 20], category: "sponsor" },
        { segment: [30], category: "intro" },
        { category: "outro" },
      ],
    });
    const segs = await fetchSponsorSegments("abc", fetchFn as unknown as typeof fetch);
    expect(segs).toEqual([{ start: 10, end: 20, category: "sponsor" }]);
    expect(String(fetchFn.mock.calls[0][0])).toContain("videoID=abc");
    expect(SPONSOR_COLORS.sponsor).toBeTruthy();
  });

  it("caches SponsorBlock responses by video id", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ segment: [10, 20], category: "sponsor" }],
    });

    const first = fetchSponsorSegments("cached-video", fetchFn as unknown as typeof fetch);
    const second = fetchSponsorSegments("cached-video", fetchFn as unknown as typeof fetch);

    expect(await first).toEqual([{ start: 10, end: 20, category: "sponsor" }]);
    expect(await second).toEqual([{ start: 10, end: 20, category: "sponsor" }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await fetchSponsorSegments("another-video", fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns [] on 404s and network failures", async () => {
    const notFound = vi.fn().mockResolvedValue({ ok: false });
    expect(await fetchSponsorSegments("abc", notFound as unknown as typeof fetch)).toEqual([]);
    const boom = vi.fn().mockRejectedValue(new Error("net"));
    expect(await fetchSponsorSegments("abc", boom as unknown as typeof fetch)).toEqual([]);
  });

  it("does not cache a transient SponsorBlock network failure", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ segment: [10, 20], category: "sponsor" }],
      });

    expect(await fetchSponsorSegments("retry-video", fetchFn as unknown as typeof fetch)).toEqual(
      [],
    );
    expect(await fetchSponsorSegments("retry-video", fetchFn as unknown as typeof fetch)).toEqual([
      { start: 10, end: 20, category: "sponsor" },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("times out a stuck request", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const promise = fetchSponsorSegments("abc", fetchFn as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toEqual([]);
  });
});
