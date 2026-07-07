// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";

// Drive the whole options page through jsdom: seed chrome storage, mount the
// markup, import the entry (which renders every section), then exercise the
// interactive bits. The page modules are DOM glue (excluded from coverage); this
// is a wiring smoke test that the real page actually builds and acts.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const messages = JSON.parse(read("../src/_locales/en/messages.json"));

// The page renders with React, which flushes its work asynchronously; let pending
// renders settle before reading the DOM. (Storage writes are synchronous, so a
// value assertion right after an interaction still holds — this is for the markup.)
export const flush = () => new Promise<void>((r) => setTimeout(r));

async function mount(settings: Record<string, unknown>) {
  document.body.innerHTML = read("../src/options/options.html")
    .replace(/[\s\S]*<body>/, "")
    .replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = createMockChrome(
    { messages, settings },
  );
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.resetModules();
  await import("../src/options/index.js");
  await flush();
  // Read storage back through the same mock the page wrote to.
  return (keys: string[]) => {
    let out: Record<string, unknown> = {};
    (globalThis.chrome.storage.local as chrome.storage.StorageArea).get(keys, (r) => {
      out = r;
    });
    return out;
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("sync category controls", () => {
  it("renders a switch per category, reflecting the saved config", async () => {
    await mount({ syncCategories: { speeds: false } });
    const rows = document.querySelectorAll("#syncRows .sync-cat-row");
    expect(rows).toHaveLength(5);
    const speeds = document.querySelector<HTMLElement>("#syncRows .sync-cat-row .switch");
    expect(speeds!.getAttribute("aria-checked")).toBe("false"); // speeds opted out
  });

  it("toggling a category persists the choice", async () => {
    const get = await mount({});
    const inputs = document.querySelectorAll<HTMLElement>("#syncRows .switch");
    inputs[0].click(); // speeds is the first row, toggles it off
    await flush();
    expect((get(["syncCategories"]).syncCategories as Record<string, boolean>).speeds).toBe(false);
  });
});

describe("keyboard remap", () => {
  it("captures a new key for an action", async () => {
    const get = await mount({});
    byId("keySlower").click(); // enter capture
    await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
    await flush();
    expect((get(["keymap"]).keymap as Record<string, string>).slower).toBe("KeyJ");
    expect(byId("keySlower").textContent).toBe("J");
  });

  it("rejects a duplicate binding", async () => {
    const get = await mount({});
    byId("keyFaster").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" })); // KeyA is slower's default
    expect((get(["keymap"]).keymap as Record<string, string> | undefined)?.faster).toBeUndefined();
  });
});

describe("saved values manager", () => {
  it("lists saved speeds and delays and deletes one", async () => {
    const get = await mount({
      globalSpeed: 1.5,
      domains: { "example.com": 2 },
      syncTargets: { "example.com": 8 },
      channels: { "twitch:foo": 1.25 },
    });
    // The data-driven sections (Saved among them) render null until their stored
    // values load across a couple of async hops, so let those renders settle.
    await flush();
    await flush();
    await flush();
    const rows = document.querySelectorAll("#savedLists .saved-row");
    expect(rows.length).toBeGreaterThanOrEqual(3); // global + site + channel
    const speedsCat = document.querySelectorAll(".saved-cat")[0];
    const siteRow = Array.from(speedsCat.querySelectorAll(".saved-row")).find((r) =>
      r.textContent?.includes("example.com"),
    )!;
    const firstDel = siteRow.querySelector<HTMLButtonElement>(".saved-del")!;
    firstDel.click();
    expect(get(["domains"]).domains).toBeUndefined();
  });

  it("deletes a saved viewer fill mode", async () => {
    const get = await mount({
      viewerFitSites: { "example.com": "cover" },
    });
    await flush();
    await flush();
    await flush();
    const fitCat = Array.from(document.querySelectorAll(".saved-cat")).find((cat) =>
      cat.textContent?.includes("Fill mode"),
    )!;
    const siteRow = Array.from(fitCat.querySelectorAll(".saved-row")).find((r) =>
      r.textContent?.includes("example.com"),
    )!;
    siteRow.querySelector<HTMLButtonElement>(".saved-del")!.click();
    expect(get(["viewerFitSites"]).viewerFitSites).toBeUndefined();
  });
});

describe("backup", () => {
  it("export gathers settings without the device-only sync meta", async () => {
    const calls: Blob[] = [];
    (globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (
      b: Blob,
    ) => {
      calls.push(b);
      return "blob:x";
    };
    (globalThis.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
      () => {};
    await mount({ globalSpeed: 1.5, syncCategories: { speeds: false } });
    byId("exportBtn").click();
    expect(calls).toHaveLength(1);
    const text = await calls[0].text();
    expect(text).toContain("globalSpeed");
    expect(text).not.toContain("syncCategories");
  });
});
