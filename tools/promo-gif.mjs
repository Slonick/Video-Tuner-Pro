// Animated README promo (GIF), English only. The "Video Tuner Pro" lockup sits
// above a full-height popup that scrolls from the overview down to the audio
// compressor and back, while the side copy swaps in place (video/stream → audio).
// Stores take static images, so this is README-only.
//   node tools/promo-gif.mjs
import { ROOT, TMP, loadCopy, renderHalves, frameHTML, shoot } from "./promo-lib.mjs";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const FPS = 20, NDOWN = 26, HOLD_TOP = 20, HOLD_BOT = 32;   // hold top · scroll down · hold bottom · scroll up
const OUT = join(ROOT, ".promo/github");
const FR = join(TMP, "frames");

await rm(FR, { recursive: true, force: true });
await mkdir(FR, { recursive: true });
await mkdir(OUT, { recursive: true });

const copy = await loadCopy("en");
const { video, stream, popH } = await renderHalves("en");

// Render the unique scroll-down frames.
const frame = (i) => join(FR, `d-${String(i).padStart(3, "0")}.png`);
for (let i = 0; i < NDOWN; i++) {
  await shoot(frameHTML({ p: i / (NDOWN - 1), video, stream, popH, copy }), 1280, 800, frame(i));
  process.stdout.write(`\rframe ${i + 1}/${NDOWN}`);
}
console.log();

// Playback order (hold · down · hold · up) as a numbered sequence — copy the
// unique frames, no re-rendering of holds or the reverse.
const order = [
  ...Array(HOLD_TOP).fill(0),
  ...Array.from({ length: NDOWN }, (_, i) => i),
  ...Array(HOLD_BOT).fill(NDOWN - 1),
  ...Array.from({ length: NDOWN - 2 }, (_, i) => NDOWN - 2 - i),
];
let n = 0;
for (const i of order) await copyFile(frame(i), join(FR, `seq-${String(n++).padStart(4, "0")}.png`));

const out = join(OUT, "promo.gif");
await exec("ffmpeg", [
  "-y", "-framerate", String(FPS), "-i", join(FR, "seq-%04d.png"),
  "-vf", "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
  out,
]);
console.log("→", out, `(${order.length} frames @ ${FPS}fps)`);
