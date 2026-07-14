// Release guard for generated promo artifacts. It verifies that every locale has
// every current popup state, catches stale/missing PNGs, and checks the exact
// Chrome Web Store / AMO dimensions without relying on ImageMagick or sips.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { LOCALES, PROMO_SCREENS, ROOT } from "./promo-lib.mjs";

const CAPTURE = join(ROOT, ".screenshots/explore/anim");
const STORE = join(ROOT, ".promo/store");
const errors = [];
let darkest = { file: "", ratio: 0 };

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((name, i) => name === expected[i]);
}

async function imageSize(file) {
  try {
    const data = await readFile(file);
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { format: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (
      data
        .subarray(0, 6)
        .toString("ascii")
        .match(/^GIF8[79]a$/)
    ) {
      return { format: "gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    }
    throw new Error("unsupported image signature");
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
    return null;
  }
}

// Decode enough of an 8-bit RGB/RGBA PNG to detect compositor corruption. Store
// art legitimately uses very dark greys, but never large areas of exact #000;
// black raster tiles therefore stand out reliably without image dependencies.
function blackPixelRatio(data) {
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24];
  const colorType = data[25];
  const interlace = data[28];
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (bitDepth !== 8 || !bpp || interlace !== 0) return null;
  const chunks = [];
  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  let pos = 0;
  let previous = Buffer.alloc(stride);
  let black = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x++) {
      const value = raw[pos++];
      const left = x >= bpp ? row[x - bpp] : 0;
      const above = previous[x];
      const upperLeft = x >= bpp ? previous[x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      row[x] = (value + predictor) & 255;
    }
    for (let x = 0; x < stride; x += bpp) {
      if (row[x] <= 1 && row[x + 1] <= 1 && row[x + 2] <= 1) black++;
    }
    previous = row;
  }
  return black / (width * height);
}

async function expectImage(file, format, width, height) {
  const actual = await imageSize(file);
  if (!actual) return;
  if (actual.format !== format || actual.width !== width || actual.height !== height) {
    errors.push(
      `${file}: expected ${format} ${width}×${height}, got ${actual.format} ${actual.width}×${actual.height}`,
    );
  }
  if (format === "png") {
    try {
      const ratio = blackPixelRatio(await readFile(file));
      if (ratio != null && ratio > darkest.ratio) darkest = { file, ratio };
      if (ratio != null && ratio > 0.0025) {
        errors.push(
          `${file}: ${(ratio * 100).toFixed(2)}% pure-black pixels (likely raster tiles)`,
        );
      }
    } catch (error) {
      errors.push(`${file}: pixel verification failed: ${error.message}`);
    }
  }
}

async function expectFileSet(dir, expected) {
  try {
    const actual = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
    const wanted = [...expected].sort();
    if (!sameList(actual, wanted)) {
      errors.push(`${dir}: expected [${wanted.join(", ")}], got [${actual.join(", ")}]`);
    }
  } catch (error) {
    errors.push(`${dir}: ${error.message}`);
    return;
  }
}

const screenshots = PROMO_SCREENS.map((kind) => `screenshot-${kind}.png`);
const chromeFiles = [...screenshots, "tile-small.png", "tile-marquee.png"];

for (const locale of LOCALES) {
  const captureDir = join(CAPTURE, locale);
  const captureFiles = PROMO_SCREENS.flatMap((kind) => [`${kind}.png`, `${kind}-dark.png`]);
  let overview = null;
  try {
    overview = await imageSize(join(captureDir, "overview.png"));
    const actual = (await readdir(captureDir)).filter((name) => name.endsWith(".png")).sort();
    const wanted = [...captureFiles].sort();
    if (!sameList(actual, wanted)) {
      errors.push(`${captureDir}: expected [${wanted.join(", ")}], got [${actual.join(", ")}]`);
    }
  } catch (error) {
    errors.push(`${captureDir}: ${error.message}`);
  }
  if (overview?.format === "png") {
    for (const name of captureFiles) {
      await expectImage(join(captureDir, name), "png", overview.width, overview.height);
    }
  }

  const dir = join(STORE, "chrome", locale);
  await expectFileSet(dir, chromeFiles);
  for (const name of screenshots) await expectImage(join(dir, name), "png", 1280, 800);
  await expectImage(join(dir, "tile-small.png"), "png", 440, 280);
  await expectImage(join(dir, "tile-marquee.png"), "png", 1400, 560);
}

const firefoxDir = join(STORE, "firefox");
await expectFileSet(firefoxDir, screenshots);
for (const name of screenshots) await expectImage(join(firefoxDir, name), "png", 1280, 800);
await expectImage(join(ROOT, ".promo/github/promo.gif"), "gif", 900, 563);

if (errors.length) {
  console.error(`Promo verification failed (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `✓ promo: ${LOCALES.length} locales × ${PROMO_SCREENS.length} states, Chrome/Firefox sets, tiles, and GIF`,
  );
  if (process.env.PROMO_VERIFY_VERBOSE === "1") {
    console.log(
      `  max pure-black coverage: ${(darkest.ratio * 100).toFixed(4)}% (${darkest.file})`,
    );
  }
}
