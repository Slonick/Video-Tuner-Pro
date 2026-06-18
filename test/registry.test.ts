// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  collectVideos,
  collectAudios,
  beginTracking,
  stopTracking,
  reconcile,
  ingestMutations,
} from "../src/content/videos.js";

// Build a minimal MutationRecord carrying just the addedNodes ingestMutations reads.
function added(...nodes: Node[]): MutationRecord[] {
  return [{ addedNodes: nodes }] as unknown as MutationRecord[];
}

beforeEach(() => {
  document.body.innerHTML = "";
  stopTracking(); // back to scan-on-read so each test starts from a clean contract
});

describe("media registry", () => {
  it("ingests videos from an added subtree without scanning the document", () => {
    beginTracking(); // trust the incremental set from here (seeded empty)
    const host = document.createElement("div");
    const v = document.createElement("video");
    host.appendChild(v);
    document.body.appendChild(host);
    // Tracking mode trusts the set — nothing ingested yet, so it's empty.
    expect(collectVideos()).toHaveLength(0);
    ingestMutations(added(host));
    expect(collectVideos()).toContain(v);
  });

  it("tracks <audio> the same way", () => {
    beginTracking();
    const a = document.createElement("audio");
    document.body.appendChild(a);
    ingestMutations(added(a));
    expect(collectAudios()).toContain(a);
  });

  it("drops media once it leaves the DOM (lazy isConnected prune)", () => {
    const v = document.createElement("video");
    document.body.appendChild(v);
    expect(collectVideos()).toContain(v);
    v.remove();
    expect(collectVideos()).not.toContain(v);
  });

  it("reconcile() catches videos inside shadow roots the observer can't see", () => {
    beginTracking();
    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    sr.appendChild(document.createElement("video"));
    document.body.appendChild(host);
    // querySelectorAll doesn't cross the shadow boundary, so ingest misses it...
    ingestMutations(added(host));
    expect(collectVideos()).toHaveLength(0);
    // ...the periodic shadow-piercing reconcile is the backstop.
    reconcile();
    expect(collectVideos()).toHaveLength(1);
  });

  it("falls back to a direct scan when the registry isn't running", () => {
    // Not tracking → collectVideos must still return a correct, synchronous answer.
    const v = document.createElement("video");
    document.body.appendChild(v);
    expect(collectVideos()).toContain(v);
  });
});
