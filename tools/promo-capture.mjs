// Capture the real popup states for the store assets, per locale, by driving the
// live popup in Playwright. The popup is a fixed 2-col grid that opens each card
// into a full-grid overlay — so the assets are 5 states: the collapsed overview
// plus each card opened. We element-screenshot the popup-grid (overview) and the
// opened card (.is-overlay) so every shot is the popup at its natural size; the
// opened card is freed to its content height so long locales aren't clipped.
//   node tools/promo-capture.mjs            # all locales (light) + en dark
//   node tools/promo-capture.mjs en         # one locale (quick)
// Output → .screenshots/explore/anim/<locale>/{overview,speed,sync,auto,audio}.png
//        → .screenshots/explore/anim/en/*-dark.png  (dark set, for README/dark store)
import { chromium } from "playwright";
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LOCALES } from "./promo-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist/chrome/popup");
const CAP = join(ROOT, ".screenshots/_cap");
const OUT = join(ROOT, ".screenshots/explore/anim");
const only = process.argv[2];
const locales = only ? [only] : LOCALES;
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await exists(join(DIST, "popup.html"))))
  execFileSync("node", [join(ROOT, "build.mjs")], { cwd: ROOT, stdio: "inherit" });
await rm(CAP, { recursive: true, force: true });
await mkdir(CAP, { recursive: true });

await build({
  entryPoints: [join(ROOT, "tools/_mock-entry.ts")],
  outfile: join(CAP, "mock.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  logLevel: "silent",
});
await copyFile(join(DIST, "popup.css"), join(CAP, "popup.css"));

// Build the popup bundle UNMINIFIED so the string patch below survives (the prod
// dist is minified → identifiers renamed → the canOpen replace would silently
// no-op and the locked promo cards would never open).
await build({
  entryPoints: [join(ROOT, "src/popup/index.tsx")],
  outfile: join(CAP, "popup.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  minify: false,
  logLevel: "silent",
});
let js = await readFile(join(CAP, "popup.js"), "utf8");
if (!js.includes("else if (canOpen) setOpen(true)"))
  throw new Error("promo-capture: canOpen open-gate not found — patch would silently fail");
// Drop the canOpen lock gate so every card click-opens (the lock is only cosmetic
// greying on the live promo stream, removed via UNGREY below).
js = js.replace("else if (canOpen) setOpen(true)", "else if (true) setOpen(true)");
await writeFile(join(CAP, "popup.js"), js);

const tokensCss = await readFile(join(ROOT, "src/popup/styles/tokens.css"), "utf8");
const themeVars = { light: 0, dark: 1 };
const blocks = [...tokensCss.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
const UNGREY =
  `.locked .speed-slider,.locked .buttons-grid,.locked .quick-actions,.locked .speed-quick .spin,` +
  `.locked .speed-body .extra-row,.locked #superTheaterRow,.locked .meter,.locked .sync-delay-row,` +
  `.locked .sync-body,.locked .switch,.audio-locked .meter,.audio-locked .sync-body,.audio-locked .switch` +
  `{opacity:1!important;filter:none!important;pointer-events:auto!important}.info.warn{display:none!important}` +
  `.locked,.audio-locked{opacity:1!important}`;
const freeze = `.switch-track,.switch-knob{transition:none!important}`;
// Drop the overlay's own lift shadow — the composer frames the popup with its own.
const NOSHADOW = `.sync-section.is-overlay{box-shadow:none!important}`;
// UNGREY forces .locked{opacity:1} to brighten the live-locked cards — but that
// also defeats the has-overlay fade, leaving a locked sibling visible behind an
// opened card, which the card glass blurs into a stray blue smear. Re-assert the
// fade (more specific, so it wins) so opened-card shots stay clean.
const FADE = `.popup-grid.has-overlay .sync-section:not(.is-overlay){opacity:0!important}`;

const { version } = JSON.parse(await readFile(join(ROOT, "src/manifest.json"), "utf8"));

async function pageHtml(theme, locale) {
  const messages = JSON.parse(await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"));
  const inject =
    `<script>window.__SCENARIO__="promo";window.__MESSAGES__=${JSON.stringify(messages)};window.__VERSION__=${JSON.stringify(version)};window.__THEME__=${JSON.stringify(theme)};window.__LOCALE__=${JSON.stringify(locale)};</script>\n` +
    `<script src="mock.js"></script>\n`;
  let html = await readFile(join(DIST, "popup.html"), "utf8");
  html = html.replace(
    '<link rel="stylesheet" href="popup.css" />',
    `<link rel="stylesheet" href="popup.css" /><style>:root{${blocks[themeVars[theme]]}}</style><style>${UNGREY}${freeze}${NOSHADOW}${FADE}</style>`,
  );
  html = html.replace('<script src="popup.js"></script>', inject + '<script src="popup.js"></script>');
  const f = join(CAP, `popup-${theme}-${locale}.html`);
  await writeFile(f, html);
  return f;
}

const CARDS = [
  { key: "speed", sel: ".speed-section" },
  { key: "sync", sel: ".live-sync-section" },
  { key: "auto", sel: ".autoslow-section" },
  { key: "audio", sel: ".audio-section" },
];

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" },
);

// Capture one locale/theme: the collapsed overview (the whole grid) + each card
// opened (the .is-overlay element at its natural height). suffix "" or "-dark".
async function captureSet(theme, locale, suffix) {
  const dir = join(OUT, locale);
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 700, height: 760 }, deviceScaleFactor: 2 });
  await page.goto("file://" + (await pageHtml(theme, locale)));
  await page.waitForSelector(".popup-grid");
  await sleep(450);
  // Screenshot the whole popup (body = the 684px window: header + padding + grid).
  // The grid box stays the collapsed size (slots preserve their height while a card
  // lifts into the inset:0 overlay, which sits BELOW the header), so every state —
  // overview and each opened card — keeps the header and comes out the SAME size.
  await page.locator("body").screenshot({ path: join(dir, `overview${suffix}.png`) });
  for (const c of CARDS) {
    await page.locator(`${c.sel} .sec-head`).first().click();
    await sleep(550);
    await page.locator("body").screenshot({ path: join(dir, `${c.key}${suffix}.png`) });
    await page.locator(`${c.sel} .sec-head`).first().click();
    await sleep(450);
  }
  await page.close();
}

if (!only) await rm(OUT, { recursive: true, force: true }); // full run starts clean
// Both schemes per locale: the store screens are a light/dark split of each state.
for (const locale of locales) {
  await captureSet("light", locale, "");
  await captureSet("dark", locale, "-dark");
  console.log("✓", locale);
}

await browser.close();
console.log(`✓ ${locales.length} locale(s) × 5 states × 2 themes → ${OUT}/<locale>/`);
