// Generate the localized store assets.
//
//   node tools/promo.mjs [locale]      # one locale = quick preview (no wipe)
//   node tools/promo.mjs               # all locales (wipes .promo/store first)
//
// Layout:
//   .promo/store/chrome/<locale>/screenshot-overview.png   1280×800  (localized)
//   .promo/store/chrome/<locale>/screenshot-audio.png      1280×800
//   .promo/store/chrome/<locale>/tile-small.png            440×280   (CWS promo tile)
//   .promo/store/chrome/<locale>/tile-marquee.png          1400×560  (CWS marquee)
//   .promo/store/firefox/screenshot-{overview,audio}.png   1280×800  (en — AMO doesn't localize)
import { LOCALES, TMP, ROOT, loadCopy, renderHalves, frameHTML, smallTileHTML, shoot } from "./promo-lib.mjs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const STORE = join(ROOT, ".promo/store");
const only = process.argv[2];
const locales = only ? [only] : LOCALES;

await mkdir(TMP, { recursive: true });
if (!only) await rm(STORE, { recursive: true, force: true });   // fresh full run drops stale assets

async function screenshots(locale, dir) {
  const copy = await loadCopy(locale);
  const { video, stream, popH } = await renderHalves(locale);
  await mkdir(dir, { recursive: true });
  await shoot(frameHTML({ p: 0, video, stream, popH, copy }), 1280, 800, join(dir, "screenshot-overview.png"));
  await shoot(frameHTML({ p: 1, video, stream, popH, copy }), 1280, 800, join(dir, "screenshot-audio.png"));
  return { copy, video, stream, popH };
}

for (const locale of locales) {
  const dir = join(STORE, "chrome", locale);
  const { copy, video, stream, popH } = await screenshots(locale, dir);
  // Chrome-only promo tiles.
  await shoot(smallTileHTML({ copy, popup: video }), 440, 280, join(dir, "tile-small.png"));
  await shoot(frameHTML({ p: 0, video, stream, popH, copy, W: 1400, H: 560, winH: 500, showBrand: false }), 1400, 560, join(dir, "tile-marquee.png"));
  console.log("✓ chrome/" + locale);
}

// Firefox (AMO) doesn't localize screenshots and has no promo tiles — one en set.
if (!only || only === "en") {
  await screenshots("en", join(STORE, "firefox"));
  console.log("✓ firefox (en)");
}
