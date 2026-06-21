// Shared rendering for the store assets. The popup states are captured per locale
// by promo-capture.mjs (collapsed overview + each card opened, all the same size);
// this composes them into the localized store screens (Apple-style hero: bold copy
// left, the popup floating right as a light/dark duo) on a clean near-white stage,
// plus the marquee + small promo tile. Copy is localized from promo-strings.json +
// the extension's own messages.json.
import { runChrome } from "./render-popup.mjs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const LOCALES = ["en", "ru", "uk", "de", "es", "fr", "pt_BR", "ja", "zh_CN", "hi"];
export const TMP = join(ROOT, ".screenshots/promo");

export const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// Apple-style stage: a clean, near-white background with a soft radial lift on the
// right so the floating popups have something to sit over while the copy column
// stays calm. Colour comes from the product itself, not the backdrop.
const SCENE = "radial-gradient(75% 95% at 80% 25%,#ffffff,#eef0f4 72%,#e6e9ef)";
const FG = "#1d1d1f"; // Apple near-black for headlines
const SUB = "#6e6e73"; // Apple secondary grey for subtext

// Localized store copy: the hero headline + lead, plus each card's title/desc. Card
// titles/descs come from the extension's own messages (already translated,
// authoritative); the hero headline comes from promo-strings.json. The four card
// screens mirror the four popup cards.
export async function storeCopy(locale) {
  const STR = JSON.parse(await readFile(join(ROOT, "tools/promo-strings.json"), "utf8"))[locale];
  const MSG = JSON.parse(
    await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"),
  );
  const m = (k) => MSG[k]?.message ?? "";
  return {
    head: STR.head,
    lead: m("extDescription"),
    cards: {
      speed: { title: STR.video.title, desc: m("guideSpeedDesc") },
      sync: { title: m("syncTitle"), desc: m("syncSubtitle") },
      auto: { title: m("autoSlowLabel"), desc: m("autoSlowSubtitle") },
      audio: { title: m("audioTitle"), desc: STR.audioLead },
    },
  };
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,'Segoe UI',Roboto,'Noto Sans CJK SC',Arial,sans-serif";

function css(W, H) {
  return `*{margin:0;padding:0;box-sizing:border-box;font-family:${FONT}}
body{width:${W}px;height:${H}px;color:${FG};overflow:hidden;position:relative;background:${SCENE}}
.col{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.col h1{font-weight:700;letter-spacing:-.03em;line-height:1.05;color:${FG};overflow-wrap:break-word}
.col .lead{color:${SUB};font-weight:400;line-height:1.45;overflow-wrap:break-word}
.stage{position:absolute;inset:0}
.pop{position:absolute;overflow:hidden;background:#ececec}
.pop img{width:100%;display:block}
/* Two floating popups, Apple "device duo": the dark scheme sits behind and the
   light scheme in front, each with its own soft lift so both schemes read at once. */
.pop.d{box-shadow:0 40px 80px rgba(10,15,40,.28),0 0 0 1px rgba(255,255,255,.05)}
.pop.l{box-shadow:0 40px 80px rgba(20,30,60,.16),0 12px 26px rgba(20,30,60,.08)}`;
}

// One store screen (Apple hero): a short bold headline + subtext on the left, the
// popup floating on the right as a light/dark duo. kind "overview" → the product
// headline + lead; a card key → that card's title + description. The popup brand
// header carries identity, so no separate brand chip or bullet list (Apple-minimal).
export function screenHTML({ kind, popImg, popImgDark, copy, W = 1280, H = 800 }) {
  const title = kind === "overview" ? copy.head : copy.cards[kind].title;
  const sub = kind === "overview" ? copy.lead : copy.cards[kind].desc;
  // The short marquee (1400×560) needs a tighter, smaller layout than the 1280×800
  // store screen; everything else shares the full-size geometry.
  const short = H < 700;
  const g = short
    ? {
        colL: 84,
        colW: 540,
        h1: 40,
        lead: 18,
        popW: 372,
        popR: 13,
        dT: 60,
        dR: 70,
        lT: 150,
        lR: 300,
        anchor: 142,
      }
    : {
        colL: 92,
        colW: 370,
        h1: kind === "overview" ? 50 : 44,
        lead: kind === "overview" ? 21 : 20,
        popW: 432,
        popR: 18,
        dT: 78,
        dR: 40,
        lT: 218,
        lR: 318,
        anchor: 198,
      };
  // The headline is anchored to a fixed top (≈ the front popup's top edge) rather
  // than vertically centred, so it starts at the same height whether it's one line
  // or three — consistent across locales.
  const col =
    `<div class="col" style="left:${g.colL}px;width:${g.colW}px;top:${g.anchor}px;bottom:auto">` +
    `<h1 style="font-size:${g.h1}px">${esc(title)}</h1>` +
    `<p class="lead" style="font-size:${g.lead}px;margin-top:${Math.round(g.lead * 0.95)}px">${esc(sub)}</p></div>`;
  const stage = popImgDark
    ? `<div class="stage">` +
      `<div class="pop d" style="top:${g.dT}px;right:${g.dR}px;width:${g.popW}px;border-radius:${g.popR}px"><img src="${popImgDark}"></div>` +
      `<div class="pop l" style="top:${g.lT}px;right:${g.lR}px;width:${g.popW}px;border-radius:${g.popR}px"><img src="${popImg}"></div></div>`
    : `<div class="stage"><div class="pop l" style="top:${g.lT}px;right:${g.dR}px;width:${g.popW}px;border-radius:${g.popR}px"><img src="${popImg}"></div></div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css(W, H)}</style></head><body>${col}${stage}</body></html>`;
}

// Small promo tile (440×280): headline + a single floating popup, no duo (too
// cramped at this size).
export function tileHTML({ copy, popImg }) {
  const col = `<div class="col" style="left:26px;width:164px"><h1 style="font-size:21px">${esc(copy.head)}</h1></div>`;
  const stage = `<div class="stage"><div class="pop l" style="top:50%;transform:translateY(-50%);right:22px;width:200px;border-radius:9px"><img src="${popImg}"></div></div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css(440, 280)}</style></head><body>${col}${stage}</body></html>`;
}

// Take a screenshot of an HTML string at w×h (no alpha — Chrome outputs rgb24).
export async function shoot(html, w, h, out) {
  const htmlPath = `${out}.tmp.html`;
  await writeFile(htmlPath, html);
  await runChrome([
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${w},${h}`,
    "--virtual-time-budget=2000",
    `--screenshot=${out}`,
    `file://${htmlPath}`,
  ]);
  await rm(htmlPath, { force: true });
}
