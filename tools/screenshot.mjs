// Capture a single popup screenshot with mocked data.
//
//   node tools/screenshot.mjs [scenario] [locale] [theme]
//   scenario: audio (default) | live | vot | idle
//   theme:    light (default) | dark | auto
import { renderPopup } from "./render-popup.mjs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [scenario = "audio", locale = "en", theme = "light"] = process.argv.slice(2);

await mkdir(join(ROOT, ".screenshots"), { recursive: true });
const out = join(ROOT, ".screenshots", `popup-${scenario}-${locale}.png`);
const { height } = await renderPopup({ scenario, locale, theme, out });
console.log(`→ ${out}  (${scenario}, ${locale}, ${theme}, ${height}px tall)`);
