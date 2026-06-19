// Light store assets in the behaviour layout — 5 screenshots (overview + one per
// opened card), the small promo tile (440×280) and the marquee (1400×560). Uses
// the live-captured light popup images. English copy for now; locale wiring TBD.
//   node tools/promo-capture.mjs && node tools/promo-screens.mjs
import { shoot, ROOT, esc } from "./promo-lib.mjs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ANIM = join(ROOT, ".screenshots/explore/anim");
const OUT = join(ROOT, ".screenshots/explore/store");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const f = (n) => `file://${join(ANIM, n)}`;

const HEAD = "Tune any video";
const LEAD = "Four tools in one popup — playback speed, live-stream catch-up, auto-slow for dense speech, and audio that evens out loud and quiet. Works on YouTube, Twitch and any HTML5 video.";
const CARDS = [
  { key: "speed", title: "Playback speed", blurb: "Any speed via slider, number box or preset.",
    desc: "Set any speed with the slider, the number box, or a one-click preset — saved per site, channel or globally.",
    bul: ["Presets with keyboard shortcuts", "Save per Site, Channel or Globally", "Force speed on players that reset it"] },
  { key: "sync", title: "Keep streams live", blurb: "Auto-catch up to the live edge.",
    desc: "On live streams it speeds up just enough to reach the live edge, then backs off on its own.",
    bul: ["Real latency + download-buffer graph", "Allowed delay you choose", "Eases off when the buffer runs low"] },
  { key: "auto", title: "Auto-slow dense speech", blurb: "Eases off when talking gets too fast.",
    desc: "When speech gets too fast to follow, it eases off the speed for a moment, then ramps back.",
    bul: ["Watches live speech rate vs your target", "Tune the floor, hold and reaction", "Best on talking-head video"] },
  { key: "audio", title: "Audio compression", blurb: "Evens out loud and quiet sounds.",
    desc: "Evens out loud and quiet sounds so you're not chasing the volume.",
    bul: ["Voice / Night / Movie presets", "Or fine-tune threshold, ratio and gain", "Live input vs output meter"] },
];

const POPW = 684, POPH = 524;
const P = { bg0: "#f3f6fb", bg1: "#dde5f1", text: "#0f1115", sub: "#5b616c", accent: "#0a84ff", glow: "rgba(10,132,255,.16)" };
const brand = (s = 1) => `<div class="brand">Video Tuner<span class="p">PRO</span></div>`;

// One composer for every asset: left copy column + a popup on the right.
function comp({ W, H, padX, colW, gap, popPW, side, pop, s = 1 }) {
  const popPH = Math.round((POPH / POPW) * popPW);
  const css = `
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans CJK SC',sans-serif}
body{width:${W}px;height:${H}px;color:${P.text};overflow:hidden;position:relative;background:radial-gradient(125% 105% at 80% -10%,${P.bg0} 0%,${P.bg1} 72%)}
.glow{position:absolute;top:${-0.3 * H}px;right:${-0.16 * W}px;width:${H * 1.4}px;height:${H * 1.4}px;border-radius:50%;background:radial-gradient(circle,${P.glow},transparent 65%)}
.wrap{position:relative;display:flex;height:${H}px;align-items:center;gap:${gap}px;padding:0 ${padX}px}
.col{width:${colW}px;flex:0 0 ${colW}px}
.brand{display:inline-flex;align-items:center;gap:${9 * s}px;padding:${8 * s}px ${16 * s}px;border-radius:${12 * s}px;background:${P.accent};color:#fff;font-size:${17 * s}px;font-weight:800;box-shadow:0 ${10 * s}px ${26 * s}px ${P.glow}}
.brand .p{font-size:${10 * s}px;font-weight:700;background:rgba(255,255,255,.3);padding:${3 * s}px ${7 * s}px;border-radius:${6 * s}px}
h1{font-weight:830;letter-spacing:-.025em;line-height:1.03;margin-top:${22 * s}px}
.lead{color:${P.sub};margin-top:${15 * s}px;line-height:1.5}
.feat{margin-top:${27 * s}px;display:flex;flex-direction:column;gap:${17 * s}px}
.feat .r{display:flex;gap:${13 * s}px}
.feat .dot{flex:0 0 ${9 * s}px;width:${9 * s}px;height:${9 * s}px;border-radius:50%;background:${P.accent};margin-top:${7 * s}px;box-shadow:0 0 0 ${4 * s}px ${P.glow}}
.feat .n{font-size:${18 * s}px;font-weight:700}.feat .d{font-size:${14 * s}px;color:${P.sub};margin-top:1px;line-height:1.3}
.bul{margin-top:${24 * s}px;display:flex;flex-direction:column;gap:${13 * s}px}
.bul li{list-style:none;display:flex;gap:${12 * s}px;font-size:${16 * s}px;color:${P.sub};line-height:1.35}
.bul li::before{content:"";flex:0 0 ${7 * s}px;width:${7 * s}px;height:${7 * s}px;border-radius:2px;background:${P.accent};margin-top:${7 * s}px}
.stage{flex:1;display:flex;align-items:center;justify-content:center}
.pop{width:${popPW}px;height:${popPH}px;border-radius:${15 * s}px;overflow:hidden;background:#ececec;box-shadow:0 ${34 * s}px ${80 * s}px rgba(20,40,90,.22),0 0 0 1px rgba(20,40,90,.08)}
.pop img{width:${popPW}px;height:auto;display:block}`;
  return `<style>${css}</style><div class="glow"></div><div class="wrap"><div class="col">${side}</div><div class="stage"><div class="pop"><img src="${pop}"></div></div></div>`;
}

// 1) Five 1280×800 screenshots.
const feat = CARDS.map((c) => `<div class="r"><span class="dot"></span><div><div class="n">${esc(c.title)}</div><div class="d">${esc(c.blurb)}</div></div></div>`).join("");
const ovSide = `${brand()}<h1 style="font-size:50px">${esc(HEAD)}</h1><p class="lead" style="font-size:19px">${esc(LEAD)}</p><div class="feat">${feat}</div>`;
await shoot(comp({ W: 1280, H: 800, padX: 76, colW: 470, gap: 54, popPW: 600, side: ovSide, pop: f("overview-light.png") }), 1280, 800, join(OUT, "store-overview.png"));
for (const c of CARDS) {
  const bul = `<ul class="bul">${c.bul.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  const side = `${brand()}<h1 style="font-size:42px">${esc(c.title)}</h1><p class="lead" style="font-size:18px">${esc(c.desc)}</p>${bul}`;
  await shoot(comp({ W: 1280, H: 800, padX: 76, colW: 470, gap: 54, popPW: 600, side, pop: f(`${c.key}-open-light.png`) }), 1280, 800, join(OUT, `store-${c.key}.png`));
}

// 2) Marquee 1400×560 — same copy as the overview screenshot.
await shoot(comp({ W: 1400, H: 560, padX: 84, colW: 620, gap: 50, popPW: 560, side: ovSide, pop: f("overview-light.png") }), 1400, 560, join(OUT, "tile-marquee.png"));

// 3) Small tile 440×280 — popup fully inside with margin (nothing touches edges).
const tlSide = `${brand(0.8)}<h1 style="font-size:23px">${esc(HEAD)}</h1>`;
await shoot(comp({ W: 440, H: 280, padX: 26, colW: 168, gap: 14, popPW: 186, side: tlSide, pop: f("overview-light.png"), s: 0.8 }), 440, 280, join(OUT, "tile-small.png"));

console.log("✓ store assets (5 screenshots + marquee + small tile) → " + OUT);
