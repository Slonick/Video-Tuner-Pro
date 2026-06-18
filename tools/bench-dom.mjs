// Performance benchmark for the media-registry change, run in real Chromium (jsdom
// can't reflect the browser's O(N) querySelectorAll cost). Builds synthetic pages
// of increasing size — roughly a heavy Twitch/YouTube page with chat — and times
// three strategies per consumer call:
//
//   old · full DOM walk      what every consumer call used to cost (querySelectorAll
//                            ("*") piercing shadow roots) — ran ~6×/tick + once per
//                            mutation burst + in the samplers.
//   new · read tracked set   what hot consumers now cost (iterate the maintained Set).
//   new · ingest one burst   what the observer now pays per mutation burst.
//
// Run: npm run bench
import { chromium } from "@playwright/test";

const SIZES = [2_000, 10_000, 30_000, 60_000];
const ITERS = 2_000;

function bench(sizes, iters) {
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

    // NEW: a maintained Set seeded once, read cheaply, updated incrementally.
    const tracked = new Set();
    const reconcile = () => {
      const scan = (root) => {
        for (const v of root.querySelectorAll("video")) tracked.add(v);
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) scan(el.shadowRoot);
      };
      scan(document);
    };
    reconcile();
    const readSet = () => {
      const out = [];
      for (const v of tracked) {
        if (v.isConnected) out.push(v);
        else tracked.delete(v);
      }
      return out;
    };
    const burst = document.createElement("div");
    burst.appendChild(document.createElement("span"));
    burst.appendChild(document.createElement("a"));
    const ingest = (node) => {
      if (node instanceof HTMLVideoElement) tracked.add(node);
      for (const v of node.querySelectorAll("video")) tracked.add(v);
    };

    for (let i = 0; i < 50; i++) {
      oldCollect();
      readSet();
      ingest(burst);
    }
    const time = (fn) => {
      const s = performance.now();
      for (let i = 0; i < iters; i++) fn();
      return (performance.now() - s) / iters;
    };

    results.push({
      n,
      oldMs: time(oldCollect),
      readMs: time(readSet),
      ingestMs: time(() => ingest(burst)),
    });
  }
  return results;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(
  ([sizes, iters, src]) => {
    // eslint-disable-next-line no-eval
    const fn = eval("(" + src + ")");
    return fn(sizes, iters);
  },
  [SIZES, ITERS, bench.toString()],
);
await browser.close();

const f = (ms) => (ms * 1000).toFixed(2).padStart(9) + " µs";
const x = (a, b) => (a / b).toFixed(1).padStart(6) + "×";
console.log(`\nPer-call cost in Chromium (mean of ${ITERS.toLocaleString()} iterations)\n`);
console.log("  DOM nodes │  old full walk │  new set read │  new ingest │ walk vs ingest");
console.log("  ──────────┼────────────────┼───────────────┼─────────────┼───────────────");
for (const r of results) {
  console.log(
    `  ${r.n.toLocaleString().padStart(9)} │ ${f(r.oldMs)} │ ${f(r.readMs)} │ ${f(r.ingestMs)} │ ${x(r.oldMs, r.ingestMs)} faster`,
  );
}
console.log(
  "\n  old = cost paid per consumer call before the fix; it grows with the DOM.\n" +
    "  new set read / ingest stay ~flat — O(tracked media) / O(change), not O(DOM).\n",
);
