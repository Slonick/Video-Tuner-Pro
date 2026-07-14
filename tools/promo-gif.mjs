// Animated README promo (GIF), English only. A slideshow of all store
// screens — the collapsed overview, then each card opened — on the liquid-glass
// scene. Stores take static images, so this is README-only.
//   node tools/promo-capture.mjs && node tools/promo-gif.mjs
import { PROMO_SCREENS, ROOT, TMP, storeCopy, screenHTML, shoot } from "./promo-lib.mjs";
import { mkdir, rm, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const FPS = 20;
const HOLD = 26; // frames each screen is held (~1.3s)
const FADE = 6; // hard-cut feels abrupt; a few duplicated frames ease the eye
const ANIM = join(ROOT, ".screenshots/explore/anim");
const OUT = join(ROOT, ".promo/github");
const FR = join(TMP, "frames");
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

if (!(await exists(join(ANIM, "en", "overview.png"))))
  throw new Error("No en captures — run: node tools/promo-capture.mjs en");

await rm(FR, { recursive: true, force: true });
await mkdir(FR, { recursive: true });
await mkdir(OUT, { recursive: true });

const copy = await storeCopy("en");
// One rendered still per screen.
const still = (k) => join(FR, `still-${k}.png`);
for (const kind of PROMO_SCREENS) {
  await shoot(
    screenHTML({
      kind,
      popImg: `file://${join(ANIM, "en", kind + ".png")}`,
      popImgDark: `file://${join(ANIM, "en", kind + "-dark.png")}`,
      copy,
    }),
    1280,
    800,
    still(kind),
  );
  process.stdout.write(`\rrender ${kind}        `);
}
console.log();

// Hold each still in sequence (a few lead-in frames are just the same still, so
// the loop reads as a calm slideshow rather than a hard flicker).
let n = 0;
for (const kind of PROMO_SCREENS)
  for (let i = 0; i < HOLD + FADE; i++)
    await copyFile(still(kind), join(FR, `seq-${String(n++).padStart(4, "0")}.png`));

const out = join(OUT, "promo.gif");
await exec("ffmpeg", [
  "-y",
  "-framerate",
  String(FPS),
  "-i",
  join(FR, "seq-%04d.png"),
  "-vf",
  "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
  out,
]);
console.log("→", out, `(${n} frames @ ${FPS}fps)`);
