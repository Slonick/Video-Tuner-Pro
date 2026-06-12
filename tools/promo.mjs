// Generate localized store promo images (1280×800) for every locale × state.
// Each promo: a gradient panel with localized copy (pulled from the extension's
// own messages.json) and the real popup rendered as a single image split down
// the middle — light theme on the left, dark on the right.
//
//   node tools/promo.mjs [locale|all] [state|all]
//   states: video (overview) | stream (live-sync) | audio (compressor, expanded)
import { renderPopup } from "./render-popup.mjs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = join(ROOT, ".screenshots/_work");
const OUT = join(ROOT, ".promo/store");

// Per-state: scenario + which section to expand + the message keys for the copy
// (so everything localizes from the extension's own strings).
const STATES = {
  video:  { scenario: "audio",  expand: null,        headline: "appHeader",  sub: "extDescription",
            bullets: ["onVideoLabel", "syncSubtitle", "audioSubtitle"] },
  stream: { scenario: "live",   expand: null,        headline: "syncTitle",  sub: "syncSubtitle",
            bullets: ["allowedDelay", "maxCatchupSpeed", "meterLatency"] },
  audio:  { scenario: "audio",  expand: "audioBody", headline: "audioTitle", sub: "audioSubtitle",
            // Scroll-to-compressor: hide the speed + stream cards so the shot is
            // just the (expanded) compressor — the rest is noise in this context.
            extraCss: ".speed-section,.sync-section:not(:last-of-type){display:none!important}",
            bullets: ["audioThreshold", "audioKnee", "audioRatio", "audioAttack", "audioRelease", "audioGain"] },
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function promoHTML({ brand, headline, sub, bullets, light, dark }) {
  const lis = bullets.map((b) => `<li>${esc(b)}</li>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans CJK SC',sans-serif;}
.promo{width:1280px;height:800px;display:flex;overflow:hidden;background:#eef1f5;}
.left{width:600px;padding:0 60px;background:linear-gradient(150deg,#0a84ff,#0a5fc4 55%,#08398f);color:#fff;display:flex;flex-direction:column;justify-content:center;}
.eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:17px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.82);}
.eyebrow .pro{font-size:12px;letter-spacing:.06em;background:rgba(255,255,255,.22);padding:3px 8px;border-radius:6px;}
.left h1{margin-top:20px;font-size:48px;font-weight:800;line-height:1.1;letter-spacing:-0.015em;}
.left .sub{margin-top:18px;font-size:21px;line-height:1.4;color:rgba(255,255,255,.9);font-weight:400;}
.left ul{margin-top:34px;list-style:none;display:flex;flex-direction:column;gap:15px;}
.left li{font-size:19px;line-height:1.3;padding-left:24px;position:relative;color:rgba(255,255,255,.96);}
.left li::before{content:"";position:absolute;left:0;top:9px;width:8px;height:8px;border-radius:50%;background:#fff;}
.right{flex:1;display:flex;align-items:center;justify-content:center;}
.popup{position:relative;display:inline-block;border-radius:20px;overflow:hidden;box-shadow:0 34px 80px rgba(8,30,60,.28);}
.popup img{display:block;height:660px;width:auto;}
.popup .dark{position:absolute;top:0;left:0;clip-path:inset(0 0 0 50%);}
.popup .seam{position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(255,255,255,.55);transform:translateX(-1px);}
</style></head><body>
<div class="promo">
  <div class="left">
    <span class="eyebrow">${esc(brand)}<span class="pro">PRO</span></span>
    <h1>${esc(headline)}</h1>
    <p class="sub">${esc(sub)}</p>
    <ul>${lis}</ul>
  </div>
  <div class="right"><div class="popup">
    <img class="light" src="file://${light}">
    <img class="dark" src="file://${dark}">
    <div class="seam"></div>
  </div></div>
</div>
</body></html>`;
}

const allLocales = (await readdir(join(ROOT, "src/_locales"))).filter((d) => !d.startsWith("."));
const [localeArg = "all", stateArg = "all"] = process.argv.slice(2);
const locales = localeArg === "all" ? allLocales : [localeArg];
const states = stateArg === "all" ? Object.keys(STATES) : [stateArg];
await mkdir(OUT, { recursive: true });

for (const locale of locales) {
  const msg = JSON.parse(await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"));
  const m = (k, fb = "") => msg[k]?.message ?? fb;

  for (const stateName of states) {
    const st = STATES[stateName];
    const light = join(TMP, `p-${locale}-${stateName}-light.png`);
    const dark = join(TMP, `p-${locale}-${stateName}-dark.png`);
    const opts = { scenario: st.scenario, expand: st.expand, extraCss: st.extraCss || "", locale, dpr: 2 };
    await renderPopup({ ...opts, theme: "light", out: light });
    await renderPopup({ ...opts, theme: "dark", out: dark });

    const html = promoHTML({
      brand: m("appHeader", "Video Tuner"),
      headline: m(st.headline),
      sub: m(st.sub),
      bullets: st.bullets.map((k) => m(k)).filter(Boolean),
      light, dark,
    });
    const htmlPath = join(TMP, `promo-${locale}-${stateName}.html`);
    await writeFile(htmlPath, html);
    const out = join(OUT, `${locale}-${stateName}.png`);
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--force-device-scale-factor=1", "--window-size=1280,800",
      "--virtual-time-budget=2000", `--screenshot=${out}`, `file://${htmlPath}`,
    ], { stdio: "ignore" });
    console.log("→", out);
  }
}
