// Shared rendering for the promo assets. The 1280×800 "frame" doubles as a GIF
// frame (progress p: 0 = overview, 1 = audio compressor) and, at other canvas
// sizes, as the marquee tile. Copy is localized from promo-strings.json plus the
// extension's own messages.json (audio param names/descriptions).
import { renderPopup, runChrome } from "./render-popup.mjs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const LOCALES = ["en", "ru", "uk", "de", "es", "fr", "pt_BR", "ja", "zh_CN", "hi"];
export const TMP = join(ROOT, ".screenshots/promo");

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, p) => { const t = clamp((p - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const POPW = 340;    // popup display width (native 680 → 0.5×, so display px == css px)
const WINH = 615;           // popup window — frames the audio panel with a little air on top

export async function loadCopy(locale) {
  const STR = JSON.parse(await readFile(join(ROOT, "tools/promo-strings.json"), "utf8"))[locale];
  const MSG = JSON.parse(await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"));
  const m = (k) => MSG[k]?.message ?? "";
  return {
    brand: "Video Tuner",
    video: [STR.video.title, STR.video.items],
    stream: [STR.stream.title, STR.stream.items],
    audioTitle: m("audioTitle"),
    audioLead: STR.audioLead,
    advanced: STR.advanced,
    tagline: m("extDescription"),
    audioParams: [
      [m("audioThreshold"), m("audioThresholdDesc")],
      [m("audioKnee"), m("audioKneeDesc")],
      [m("audioRatio"), m("audioRatioDesc")],
      [m("audioAttack"), m("audioAttackDesc")],
      [m("audioRelease"), m("audioReleaseDesc")],
      [m("audioGain"), m("audioGainDesc")],
    ],
  };
}

// The light (video) and dark (stream) popup halves, audio expanded, forced to a
// common height so the centre seam lines up.
export async function renderHalves(locale) {
  const video = join(TMP, `${locale}-video.png`);
  const stream = join(TMP, `${locale}-stream.png`);
  const opt = { expand: "audioBody", locale, dpr: 2 };
  const { height: hV } = await renderPopup({ ...opt, scenario: "audio", theme: "light", out: video });
  const { height: hS } = await renderPopup({ ...opt, scenario: "live", theme: "dark", out: stream });
  const popH = Math.max(hV, hS);
  if (hV !== popH) await renderPopup({ ...opt, scenario: "audio", theme: "light", out: video, height: popH });
  if (hS !== popH) await renderPopup({ ...opt, scenario: "live", theme: "dark", out: stream, height: popH });
  return { video, stream, popH };
}

const section = (title, items) => `<h3>${esc(title)}</h3>` +
  items.map(([n, d]) => `<div class="param"><div class="pn">${esc(n)}</div><div class="pd">${esc(d)}</div></div>`).join("");
const lead = (title, text) => `<h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>`;

// One canvas, two uses: a 1280×800 screenshot/GIF frame, and (at 1400×560) the
// marquee. p drives the popup scroll + the in-place copy swap (overview → audio).
export function frameHTML({ p = 0, video, stream, popH, copy, W = 1280, H = 800, winH = WINH, showBrand = true }) {
  const scroll = (p * Math.max(0, popH - winH)).toFixed(1);
  const oOut = smooth(0.30, 0.55, p), aIn = smooth(0.45, 0.72, p);
  const ov = `opacity:${(1 - oOut).toFixed(3)};transform:translateY(${(-34 * oOut).toFixed(1)}px)`;
  const au = `opacity:${aIn.toFixed(3)};transform:translateY(${(34 * (1 - aIn)).toFixed(1)}px)`;
  const [vT, vI] = copy.video, [sT, sI] = copy.stream;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans CJK SC',sans-serif;}
.promo{width:${W}px;height:${H}px;display:flex;align-items:stretch;overflow:hidden;background:linear-gradient(to right,#eef1f5 0,#eef1f5 50%,#16181d 50%,#16181d 100%);}
.col{width:392px;height:${H}px;position:relative;}
.layer{position:absolute;inset:0;padding:0 32px;display:flex;flex-direction:column;justify-content:center;}
.col h2{font-size:33px;font-weight:800;line-height:1.1;letter-spacing:-0.015em;}
.col .sub{margin-top:14px;font-size:18px;line-height:1.45;}
.col h3{font-size:15px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:18px;}
.param{margin-bottom:13px;}
.param .pn{font-size:17px;font-weight:600;line-height:1.2;}
.param .pd{font-size:13px;line-height:1.3;margin-top:2px;}
.left{color:#1d1d1f;}.left .sub{color:#5a5a5f;}.left h3{color:#0a84ff;}.left .pd{color:#86868b;}
.right .layer{text-align:right;align-items:flex-end;}.right{color:#f5f5f7;}
.right .sub{color:rgba(255,255,255,.82);}.right h3{color:#7fb8ff;}.right .pd{color:rgba(255,255,255,.5);}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding-top:14px;}
.brand{display:inline-flex;align-items:center;gap:9px;padding:9px 18px;border-radius:13px;background:#0a84ff;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.01em;box-shadow:0 12px 30px rgba(10,132,255,.4);}
.brand .pro{font-size:12px;font-weight:700;letter-spacing:.05em;background:rgba(255,255,255,.26);padding:3px 7px;border-radius:6px;}
.window{width:${POPW}px;height:${winH}px;overflow:hidden;border-radius:20px;box-shadow:0 30px 70px rgba(0,0,0,.34);position:relative;}
.scroller{position:absolute;top:0;left:0;transform:translateY(-${scroll}px);}
.scroller img{display:block;width:${POPW}px;height:${popH}px;}
.scroller .stream{position:absolute;top:0;left:0;clip-path:inset(0 0 0 50%);}
.scroller .seam{position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(150,150,160,.5);transform:translateX(-1px);}
</style></head><body>
<div class="promo">
  <div class="col left">
    <div class="layer" style="${ov}">${section(vT, vI)}</div>
    <div class="layer" style="${au}">${lead(copy.audioTitle, copy.audioLead)}</div>
  </div>
  <div class="stage">
    ${showBrand ? `<div class="brand">${esc(copy.brand)}<span class="pro">PRO</span></div>` : ""}
    <div class="window"><div class="scroller">
      <img class="video" src="file://${video}">
      <img class="stream" src="file://${stream}">
      <div class="seam"></div>
    </div></div>
  </div>
  <div class="col right">
    <div class="layer" style="${ov}">${section(sT, sI)}</div>
    <div class="layer" style="${au}">${section(copy.advanced, copy.audioParams)}</div>
  </div>
</div></body></html>`;
}

// Small promo tile (440×280): brand + tagline, with the popup peeking in from
// the right on the brand gradient.
export function smallTileHTML({ copy, popup }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans CJK SC',sans-serif;}
.t{width:440px;height:280px;display:flex;overflow:hidden;color:#fff;background:linear-gradient(145deg,#0a84ff,#0a5fc4 65%,#08398f);}
.l{flex:1;padding:0 0 0 34px;display:flex;flex-direction:column;justify-content:center;gap:14px;}
.b{display:inline-flex;align-items:center;gap:8px;font-size:27px;font-weight:800;letter-spacing:-0.015em;}
.b .pro{font-size:12px;font-weight:700;background:rgba(255,255,255,.24);padding:2px 7px;border-radius:6px;}
.tag{font-size:14px;line-height:1.4;color:rgba(255,255,255,.9);max-width:210px;}
.r{width:150px;position:relative;}
.r img{position:absolute;top:24px;left:10px;width:200px;border-radius:16px;box-shadow:0 18px 40px rgba(8,30,60,.4);transform:rotate(-4deg);}
</style></head><body>
<div class="t">
  <div class="l"><span class="b">${esc(copy.brand)}<span class="pro">PRO</span></span><div class="tag">${esc(copy.tagline)}</div></div>
  <div class="r"><img src="file://${popup}"></div>
</div></body></html>`;
}

// Take a screenshot of an HTML string at w×h (no alpha — Chrome outputs rgb24).
export async function shoot(html, w, h, out) {
  const htmlPath = `${out}.tmp.html`;
  await writeFile(htmlPath, html);
  await runChrome([
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=1", `--window-size=${w},${h}`,
    "--virtual-time-budget=2000", `--screenshot=${out}`, `file://${htmlPath}`,
  ]);
  await rm(htmlPath, { force: true });
}
