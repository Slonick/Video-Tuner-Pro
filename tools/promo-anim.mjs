// Behaviour GIF (README). Composite: solo copy on the left, the popup on the
// right over a dark stage. A light popup holds, a vertical line sweeps across the
// SCREEN ONLY and repaints it dark, then each card opens with the REAL browser
// FLIP overlay (captured live) while the side copy swaps to that card's blurb;
// finally the line sweeps back to light so the loop is seamless.
//   node tools/promo-capture.mjs && node tools/promo-anim.mjs
import { shoot, ROOT, esc } from "./promo-lib.mjs";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const ANIM = join(ROOT, ".screenshots/explore/anim");
const FR = join(ROOT, ".screenshots/explore/g2-frames");
const OUT = join(ROOT, ".screenshots/explore");
await rm(FR, { recursive: true, force: true });
await mkdir(FR, { recursive: true });
const f = (n) => `file://${join(ANIM, n)}`;

const HEAD = "Tune any video";
const LEAD = "Four tools in one popup — speed, live-stream catch-up, auto-slow for fast talkers, and audio that evens out loud and quiet. YouTube, Twitch, any HTML5 video.";
const CARDS = [
  { key: "speed", title: "Playback speed", desc: "Set any speed with the slider, the number box, or a one-click preset — saved per site, channel or globally.",
    bul: ["Presets with keyboard shortcuts", "Save per Site, Channel or Globally", "Force speed on players that reset it"] },
  { key: "sync", title: "Keep streams live", desc: "On live streams it speeds up just enough to reach the live edge, then backs off on its own.",
    bul: ["Real latency + download-buffer graph", "Allowed delay you choose", "Eases off when the buffer runs low"] },
  { key: "auto", title: "Auto-slow dense speech", desc: "When speech gets too fast to follow, it eases off the speed for a moment, then ramps back.",
    bul: ["Watches live speech rate vs your target", "Tune floor, hold and reaction", "Best on talking-head video"] },
  { key: "audio", title: "Audio compression", desc: "Evens out loud and quiet sounds so you're not chasing the volume.",
    bul: ["Voice / Night / Movie presets", "Or fine-tune threshold, ratio and gain", "Live input vs output meter"] },
];
const CARD_BY = Object.fromEntries(CARDS.map((c) => [c.key, c]));

// Geometry: all popup PNGs share the overview size (the overlay fills the grid).
const POPW = 684, POPH = 524;
const PW = 650, PH = Math.round((POPH / POPW) * PW);
const W = 1340, Hc = 752;
const ACC = "#3b9bff", SUB = "rgba(255,255,255,.62)";
const css = `
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body{width:${W}px;height:${Hc}px;color:#f5f7fa;overflow:hidden;position:relative;background:radial-gradient(125% 105% at 80% -10%,#1b1f27 0%,#0b0c10 70%)}
.glow{position:absolute;top:-170px;right:-130px;width:740px;height:740px;border-radius:50%;background:radial-gradient(circle,rgba(40,120,255,.16),transparent 65%)}
.wrap{position:relative;display:flex;height:${Hc}px;align-items:center;gap:50px;padding:0 70px}
.col{position:relative;width:430px;flex:0 0 430px;height:${PH}px}
.txt{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center}
.brand{display:inline-flex;align-self:flex-start;align-items:center;gap:9px;padding:8px 15px;border-radius:12px;background:${ACC};color:#fff;font-size:16px;font-weight:800;box-shadow:0 10px 26px rgba(40,120,255,.3)}
.brand .p{font-size:10px;font-weight:700;background:rgba(255,255,255,.28);padding:2px 6px;border-radius:5px}
h1{font-weight:830;letter-spacing:-.025em;line-height:1.04;margin-top:20px}
.lead{color:${SUB};margin-top:15px;line-height:1.5}
.feat{margin-top:24px;display:flex;flex-direction:column;gap:14px}
.feat .r{display:flex;gap:12px}
.feat .dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:${ACC};margin-top:8px;box-shadow:0 0 0 4px rgba(40,120,255,.16)}
.feat .n{font-size:17px;font-weight:700}.feat .d{font-size:13px;color:${SUB};margin-top:1px;line-height:1.3}
.bul{margin-top:20px;display:flex;flex-direction:column;gap:10px}
.bul li{list-style:none;display:flex;gap:11px;font-size:15px;color:${SUB};line-height:1.35}
.bul li::before{content:"";flex:0 0 7px;width:7px;height:7px;border-radius:2px;background:${ACC};margin-top:6px}
.stage{flex:1;display:flex;align-items:center;justify-content:center}
.pop{position:relative;width:${PW}px;height:${PH}px;border-radius:15px;overflow:hidden;box-shadow:0 34px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}
.pop img{position:absolute;top:0;left:0;width:${PW}px;height:auto}
.bar{position:absolute;top:-6%;height:112%;width:4px;border-radius:4px;background:linear-gradient(180deg,#7cc0ff,#3b9bff);box-shadow:0 0 22px 6px rgba(80,160,255,.6),0 0 60px 18px rgba(60,140,255,.32)}`;

const brand = `<div class="brand">Video Tuner<span class="p">PRO</span></div>`;
const ovTxt = (op) =>
  `<div class="txt" style="opacity:${op}"><div>${brand}<h1 style="font-size:46px">${esc(HEAD)}</h1><p class="lead" style="font-size:18px">${esc(LEAD)}</p>` +
  `<div class="feat">${CARDS.map((c) => `<div class="r"><span class="dot"></span><div><div class="n">${esc(c.title)}</div></div></div>`).join("")}</div></div></div>`;
const cardTxt = (c, op) =>
  `<div class="txt" style="opacity:${op}"><div>${brand}<h1 style="font-size:40px">${esc(c.title)}</h1><p class="lead" style="font-size:17px">${esc(c.desc)}</p>` +
  `<ul class="bul">${c.bul.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></div>`;

// descriptor → html. popup: {base, top?, clip?, bar?}; side: [{kind:'ov'|'card', key?, op}]
function html({ popup, light, side }) {
  const imgs =
    `<img src="${popup.base}">` +
    (popup.top != null ? `<img src="${popup.top}" style="clip-path:inset(0 ${((1 - popup.clip) * 100).toFixed(2)}% 0 0)">` : "");
  const bar = popup.bar != null ? `<div class="bar" style="left:${(popup.bar * PW - 2).toFixed(1)}px"></div>` : "";
  const popBg = light ? "#ececec" : "#1c1c1e";
  const sideHtml = side.map((l) => (l.kind === "ov" ? ovTxt(l.op) : cardTxt(CARD_BY[l.key], l.op))).join("");
  return `<style>${css}.pop{background:${popBg}}</style><div class="glow"></div>
  <div class="wrap"><div class="col">${sideHtml}</div><div class="stage"><div class="pop">${imgs}${bar}</div></div></div>`;
}

// Cache unique descriptors by JSON; queue their renders (run pooled later so we
// don't spawn ~80 headless Chromes at once).
const cache = new Map();
const tasks = [];
const want = (d) => {
  const k = JSON.stringify(d);
  if (!cache.has(k)) {
    const i = cache.size;
    cache.set(k, i);
    tasks.push({ html: html(d), out: join(FR, `u-${String(i).padStart(3, "0")}.png`) });
  }
  return cache.get(k);
};

const order = [];
const hold = (d, n) => { const i = want(d); for (let k = 0; k < n; k++) order.push(i); };
const play = (ds) => { for (const d of ds) order.push(want(d)); };

const ovL = f("overview-light.png"), ovD = f("overview-dark.png");
const N = 16, NF = 13, XF = 6; // wipe steps · flip frames · side-text crossfade frames
const OVD = { kind: "ov" };
const cd = (c) => ({ kind: "card", key: c.key });
const one = (d) => [{ ...d, op: 1 }];
// Crossfade two side-text descriptors (overview or card) at t∈0..1.
const xf = (from, to, t) => {
  const a = +(1 - t).toFixed(3), b = +t.toFixed(3), ls = [];
  if (a > 0.001) ls.push({ ...from, op: a });
  if (b > 0.001) ls.push({ ...to, op: b });
  return ls.length ? ls : one(to);
};

// 1) hold light overview
hold({ popup: { base: ovL }, light: true, side: one(OVD) }, 16);
// 2) wipe popup → dark
play(Array.from({ length: N - 1 }, (_, k) => ({ popup: { base: ovL, top: ovD, clip: (k + 1) / N, bar: (k + 1) / N }, light: true, side: one(OVD) })));
// 3) hold dark overview
hold({ popup: { base: ovD }, light: false, side: one(OVD) }, 12);
// 4) each card: open (FLIP, text swaps in from the previous section) → hold → close
// (text stays — the next section's text takes over on its open, not on this close).
let prev = OVD;
for (const c of CARDS) {
  const cur = cd(c);
  const fr = (i) => f(`${c.key}-${String(i).padStart(2, "0")}.png`);
  play(Array.from({ length: NF }, (_, i) => ({ popup: { base: fr(i) }, light: false, side: xf(prev, cur, Math.min(1, i / XF)) })));
  hold({ popup: { base: f(`${c.key}-open.png`) }, light: false, side: one(cur) }, 18);
  play(Array.from({ length: NF }, (_, i) => ({ popup: { base: fr(NF - 1 - i) }, light: false, side: one(cur) })));
  hold({ popup: { base: ovD }, light: false, side: one(cur) }, 6);
  prev = cur;
}
// 5) return to general text (only now), then wipe popup → light to loop
play(Array.from({ length: 8 }, (_, i) => ({ popup: { base: ovD }, light: false, side: xf(prev, OVD, (i + 1) / 8) })));
play(Array.from({ length: N - 1 }, (_, k) => { const kk = N - 1 - k; return { popup: { base: ovL, top: ovD, clip: kk / N, bar: kk / N }, light: true, side: one(OVD) }; }));

// Render the unique frames with a small concurrency pool.
const POOL = 6;
let next = 0;
await Promise.all(
  Array.from({ length: POOL }, async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      await shoot(t.html, W, Hc, t.out);
    }
  }),
);
console.log(`${cache.size} unique frames · ${order.length} total`);

let n = 0;
for (const i of order) await copyFile(join(FR, `u-${String(i).padStart(3, "0")}.png`), join(FR, `seq-${String(n++).padStart(4, "0")}.png`));
const FPS = 20;
const out = join(OUT, "promo-behaviour.gif");
await exec("ffmpeg", [
  "-y", "-framerate", String(FPS), "-i", join(FR, "seq-%04d.png"),
  "-vf", "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
  out,
]);
console.log("→", out, `(${order.length} frames @ ${FPS}fps)`);
