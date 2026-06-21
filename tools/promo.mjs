// Compose the localized store assets from the per-locale popup captures.
//
//   node tools/promo-capture.mjs        # first: capture popup states per locale
//   node tools/promo.mjs [locale]       # then: compose (one locale = quick preview)
//
// Layout (per locale → .promo/store/chrome/<locale>/):
//   screenshot-overview.png  1280×800   collapsed 2×2 grid
//   screenshot-{speed,sync,auto,audio}.png  1280×800   each card opened
//   tile-small.png           440×280    CWS promo tile
//   tile-marquee.png         1400×560   CWS marquee
// Firefox (AMO, no localization / tiles): one en set of the 5 screenshots.
import { LOCALES, ROOT, storeCopy, screenHTML, tileHTML, shoot } from "./promo-lib.mjs";
import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";

const ANIM = join(ROOT, ".screenshots/explore/anim");
const STORE = join(ROOT, ".promo/store");
const only = process.argv[2];
const locales = only ? [only] : LOCALES;
const SCREENS = ["overview", "speed", "sync", "auto", "audio"];
const pop = (locale, kind) => `file://${join(ANIM, locale, kind + ".png")}`;
const popDark = (locale, kind) => `file://${join(ANIM, locale, kind + "-dark.png")}`;
const exists = (p) => access(p).then(() => true, () => false);

if (!only) await rm(STORE, { recursive: true, force: true });

async function composeScreens(copy, locale, dir) {
  for (const kind of SCREENS) {
    await shoot(
      screenHTML({ kind, popImg: pop(locale, kind), popImgDark: popDark(locale, kind), copy }),
      1280,
      800,
      join(dir, `screenshot-${kind}.png`),
    );
  }
}

for (const locale of locales) {
  if (!(await exists(join(ANIM, locale, "overview.png"))))
    throw new Error(`No captures for "${locale}" — run: node tools/promo-capture.mjs`);
  const copy = await storeCopy(locale);
  const dir = join(STORE, "chrome", locale);
  await mkdir(dir, { recursive: true });
  await composeScreens(copy, locale, dir);
  // Chrome-only promo tiles.
  await shoot(
    tileHTML({ copy, popImg: pop(locale, "overview"), popImgDark: popDark(locale, "overview") }),
    440,
    280,
    join(dir, "tile-small.png"),
  );
  await shoot(
    screenHTML({
      kind: "overview",
      popImg: pop(locale, "overview"),
      popImgDark: popDark(locale, "overview"),
      copy,
      W: 1400,
      H: 560,
      padX: 84,
      colW: 620,
      gap: 50,
      popW: 520,
    }),
    1400,
    560,
    join(dir, "tile-marquee.png"),
  );
  console.log("✓ chrome/" + locale);
}

// Firefox (AMO): en only, the five screenshots, no tiles.
if (!only || only === "en") {
  const copy = await storeCopy("en");
  const dir = join(STORE, "firefox");
  await mkdir(dir, { recursive: true });
  await composeScreens(copy, "en", dir);
  console.log("✓ firefox (en)");
}
