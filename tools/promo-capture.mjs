// Capture the real browser overlay-open animation as frames by driving the live
// popup in Playwright (shared by the README GIF and the store screens). The FLIP
// is slowed so screenshots land on intermediate states, and the canOpen lock gate
// is patched out so every card can be click-opened from one consistent (live/
// promo) overview — the lock is only cosmetic greying, removed by UNGREY. Captures
// the collapsed overview (light+dark) and each card's open frames (dark + a light
// fully-open still). → .screenshots/explore/anim/
//   node tools/promo-capture.mjs   (uses $CHROME if set, else the 'chrome' channel)
import { chromium } from "playwright";
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist/chrome/popup");
const CAP = join(ROOT, ".screenshots/_cap");
const OUT = join(ROOT, ".screenshots/explore/anim");
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await exists(join(DIST, "popup.html")))) execFileSync("node", [join(ROOT, "build.mjs")], { cwd: ROOT, stdio: "inherit" });
await rm(CAP, { recursive: true, force: true });
await mkdir(CAP, { recursive: true });
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build({ entryPoints: [join(ROOT, "tools/_mock-entry.ts")], outfile: join(CAP, "mock.js"), bundle: true, format: "iife", target: "es2022", logLevel: "silent" });
await copyFile(join(DIST, "popup.css"), join(CAP, "popup.css"));

// Patch the built bundle: slow the FLIP for capture; drop the canOpen gate so
// locked cards can still be opened (greying is removed cosmetically below).
const DUR = 1400;
let js = await readFile(join(DIST, "popup.js"), "utf8");
js = js.replace(/var DUR3 = 300\b/, `var DUR3 = ${DUR}`).replace("else if (canOpen) setOpen(true)", "else if (true) setOpen(true)");
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

const messages = JSON.parse(await readFile(join(ROOT, "src/_locales/en/messages.json"), "utf8"));
const { version } = JSON.parse(await readFile(join(ROOT, "src/manifest.json"), "utf8"));

async function pageHtml(theme) {
  const inject =
    `<script>window.__SCENARIO__="promo";window.__MESSAGES__=${JSON.stringify(messages)};window.__VERSION__=${JSON.stringify(version)};window.__THEME__=${JSON.stringify(theme)};</script>\n` +
    `<script src="mock.js"></script>\n`;
  let html = await readFile(join(DIST, "popup.html"), "utf8");
  html = html.replace('<link rel="stylesheet" href="popup.css" />', `<link rel="stylesheet" href="popup.css" /><style>:root{${blocks[themeVars[theme]]}}</style><style>${UNGREY}${freeze}</style>`);
  html = html.replace('<script src="popup.js"></script>', inject + '<script src="popup.js"></script>');
  const f = join(CAP, `popup-${theme}.html`);
  await writeFile(f, html);
  return f;
}

const CARDS = [
  { key: "speed", sel: ".speed-section" },
  { key: "sync", sel: ".live-sync-section" },
  { key: "auto", sel: ".autoslow-section" },
  { key: "audio", sel: ".audio-section" },
];

// Use the CI-provided Chrome when CHROME is set (self-hosted runner), else the
// locally installed Chrome via Playwright's channel.
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" });
let H = 700;

// Collapsed overview, both themes (the start frame + the wipe endpoints).
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 684, height: 700 }, deviceScaleFactor: 2 });
  await page.goto("file://" + (await pageHtml(theme)));
  await page.waitForSelector(".speed-section");
  await sleep(500);
  H = Math.ceil(await page.evaluate(() => document.querySelector(".popup-grid").getBoundingClientRect().bottom + 12));
  await page.setViewportSize({ width: 684, height: H });
  await sleep(200);
  await page.screenshot({ path: join(OUT, `overview-${theme}.png`) });
  await page.close();
}

// Real FLIP open frames per card (dark).
const page = await browser.newPage({ viewport: { width: 684, height: H }, deviceScaleFactor: 2 });
await page.goto("file://" + (await pageHtml("dark")));
await page.waitForSelector(".speed-section");
await sleep(500);
const NF = 13;
for (const c of CARDS) {
  const head = page.locator(`${c.sel} .sec-head`).first();
  await head.click();
  for (let i = 0; i < NF; i++) {
    await page.screenshot({ path: join(OUT, `${c.key}-${String(i).padStart(2, "0")}.png`) });
    await sleep(DUR / NF - 45);
  }
  await sleep(350);
  await page.screenshot({ path: join(OUT, `${c.key}-open.png`) });
  await head.click(); // close back to overview for the next card
  await sleep(DUR + 350);
}

// Light fully-open states (store screens use these, no animation needed).
const lp = await browser.newPage({ viewport: { width: 684, height: H }, deviceScaleFactor: 2 });
await lp.goto("file://" + (await pageHtml("light")));
await lp.waitForSelector(".speed-section");
await sleep(500);
for (const c of CARDS) {
  const head = lp.locator(`${c.sel} .sec-head`).first();
  await head.click();
  await sleep(DUR + 350);
  await lp.screenshot({ path: join(OUT, `${c.key}-open-light.png`) });
  await head.click();
  await sleep(DUR + 350);
}
await lp.close();
await browser.close();
console.log(`✓ overview(light/dark) + ${CARDS.length} card opens (dark @ ${NF}f + light) → ${OUT}  H=${H}`);
