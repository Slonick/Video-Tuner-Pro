// Performance benchmark for the media-registry change (#69), run in real Chromium
// (jsdom can't reflect the browser's O(N) querySelectorAll cost). Builds synthetic
// pages of increasing size — roughly a heavy Twitch/YouTube page with chat — and
// times each strategy.
//
//   old · full walk (per call)   what EVERY consumer call cost before the fix
//                                (~6×/tick + once per mutation burst + in the two
//                                samplers). querySelectorAll("*") piercing shadow.
//   new · reconcile (per tick)   the SAME full walk — it didn't disappear, it just
//                                runs at most once per background tick now, as the
//                                shadow-DOM backstop. Shown so the residual cost is
//                                honest, not hidden.
//   new · read set (per call)    what the hot consumers now cost (iterate the Set).
//   new · ingest (per burst)     what the observer now pays per mutation burst.
//
// Timing is adaptive: each function is run until its measured block exceeds
// MIN_MS, so totals stay well above performance.now()'s ~100µs coarsening (Chromium
// clamps it outside cross-origin isolation) — no dividing real time by timer noise.
//
// NOTE: a micro-benchmark of the collection strategy, not the shipped module; the
// absolute numbers are browser-/machine-specific. The point is how old scales with
// the DOM while the new per-call paths stay flat.
//
// Run: npm run bench
import { chromium } from "@playwright/test";

const SIZES = [2_000, 10_000, 30_000, 60_000];
const MIN_MS = 250; // each measured block must run at least this long

function bench(sizes, minMs) {
  // Run `fn` in growing batches until a batch takes >= minMs, then return the mean
  // per-call time in milliseconds. Guarantees the timed block is far above the
  // timer's resolution, so fast paths aren't measured as "0".
  const perCall = (fn) => {
    let iters = 64;
    for (;;) {
      const s = performance.now();
      for (let i = 0; i < iters; i++) fn();
      const elapsed = performance.now() - s;
      if (elapsed >= minMs || iters >= 1 << 26) return elapsed / iters;
      iters *= 4;
    }
  };

  const results = [];
  for (const n of sizes) {
    document.body.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.className = "msg c" + (i % 64);
      d.textContent = "x";
      frag.appendChild(d);
    }
    for (let i = 0; i < 3; i++) frag.appendChild(document.createElement("video"));
    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    for (let i = 0; i < 64; i++) sr.appendChild(document.createElement("span"));
    sr.appendChild(document.createElement("video"));
    frag.appendChild(host);
    document.body.appendChild(frag);

    // OLD: full shadow-piercing walk, rebuilt on every call.
    const oldCollect = () => {
      const acc = [];
      const seen = new Set();
      const scan = (root) => {
        for (const h of root.querySelectorAll("video"))
          if (!seen.has(h)) {
            seen.add(h);
            acc.push(h);
          }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) scan(el.shadowRoot);
      };
      scan(document);
      return acc;
    };

    // NEW: the same full walk, but it now merges into the persistent Set and runs
    // only on the tick (reconcile) — measured to show the residual cost honestly.
    const tracked = new Set();
    const reconcile = () => {
      const scan = (root) => {
        for (const v of root.querySelectorAll("video")) tracked.add(v);
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) scan(el.shadowRoot);
      };
      scan(document);
    };
    reconcile(); // seed
    const readSet = () => {
      const out = [];
      for (const v of tracked) {
        if (v.isConnected) out.push(v);
        else tracked.delete(v);
      }
      return out;
    };
    // A "chat message"-sized added subtree — what one mutation burst delivers.
    const burst = document.createElement("div");
    burst.appendChild(document.createElement("span"));
    burst.appendChild(document.createElement("a"));
    const ingest = (node) => {
      if (node instanceof HTMLVideoElement) tracked.add(node);
      for (const v of node.querySelectorAll("video")) tracked.add(v);
      for (const a of node.querySelectorAll("audio")) void a; // parity with the real ingest
    };

    // Warm up the JITs.
    for (let i = 0; i < 200; i++) {
      oldCollect();
      reconcile();
      readSet();
      ingest(burst);
    }

    results.push({
      n,
      oldMs: perCall(oldCollect),
      reconcileMs: perCall(reconcile),
      readMs: perCall(readSet),
      ingestMs: perCall(() => ingest(burst)),
    });
  }
  return results;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(
  ([sizes, minMs, src]) => {
    // eslint-disable-next-line no-eval
    const fn = eval("(" + src + ")");
    return fn(sizes, minMs);
  },
  [SIZES, MIN_MS, bench.toString()],
);
await browser.close();

// Adaptive unit: ms → µs → ns so a 4ms walk and a 20ns read both read cleanly.
const dur = (ms) => {
  if (ms >= 1) return ms.toFixed(2) + " ms";
  if (ms >= 1e-3) return (ms * 1e3).toFixed(1) + " µs";
  return (ms * 1e6).toFixed(0) + " ns";
};
const pad = (s, w) => String(s).padStart(w);

console.log(`\nPer-call cost in Chromium (each path run >= ${MIN_MS} ms, mean per call)\n`);
console.log("  DOM nodes │ old full walk │ new reconcile │ new read set │ new ingest");
console.log("            │  (per call)   │   (per tick)  │  (per call)  │ (per burst)");
console.log("  ──────────┼───────────────┼───────────────┼──────────────┼────────────");
for (const r of results) {
  console.log(
    `  ${pad(r.n.toLocaleString(), 9)} │ ${pad(dur(r.oldMs), 13)} │ ${pad(dur(r.reconcileMs), 13)} │ ${pad(dur(r.readMs), 12)} │ ${pad(dur(r.ingestMs), 11)}`,
  );
}
console.log(
  "\n  Before: the full walk (col 1) was paid on every consumer call — ~6×/tick,\n" +
    "  once per mutation burst, and in the audio/buffer samplers (~9×/s total).\n" +
    "  After: the full walk survives only as reconcile (col 2), at most once per\n" +
    "  tick; all other calls are a Set read (col 3) or an incremental ingest (col 4),\n" +
    "  which stay flat as the DOM grows.\n",
);
