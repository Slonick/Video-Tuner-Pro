// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({ loads: 0 }));

vi.mock("../src/content/index.js", () => {
  boot.loads++;
  return {};
});

async function loadMainAgain(): Promise<void> {
  vi.resetModules();
  await import("../src/content/main.js");
  await Promise.resolve();
}

describe("content main boot guard", () => {
  beforeEach(() => {
    boot.loads = 0;
    delete (window as typeof window & { __vtpContentBooted?: boolean }).__vtpContentBooted;
  });

  it("imports the content runtime only once per isolated world", async () => {
    await loadMainAgain();
    await loadMainAgain();

    expect(boot.loads).toBe(1);
  });
});
