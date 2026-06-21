// Preview the popup as the on-video overlay (vtp-embedded) over a realistic
// "video" frame, so the glass refracts something that actually looks like content
// (the old neon stripes hid how milky the panel reads). Self-review only.
//   node tools/screenshot-overlay.mjs [dark|light] [opacity]
import { renderPopup } from "./render-popup.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const theme = process.argv[2] || "dark";
// A mid-toned multi-hue scene (darker than the page, a few bright blobs) — closer
// to a real video than neon stripes, so milkiness and text contrast read true.
const bg = [
  "radial-gradient(58% 50% at 24% 30%, rgba(96,156,74,0.6), transparent 60%)",
  "radial-gradient(50% 46% at 76% 66%, rgba(72,116,188,0.55), transparent 60%)",
  "radial-gradient(42% 40% at 62% 18%, rgba(224,184,96,0.4), transparent 55%)",
  "linear-gradient(135deg, #0e1512 0%, #1f2e20 34%, #2c2719 60%, #15212c 100%)",
].join(",");
// Default the preview to 50% glass opacity — the common real-world setting, and
// where the milkiness/contrast trade-offs actually bite.
const opacity = process.argv[3] || "0.5";
const extraCss = `:root{--glass-opacity:${opacity}}`;
const tag = `overlay-${theme}-o${opacity}`;
const out = join(ROOT, ".screenshots", `${tag}.png`);
await renderPopup({ scenario: "audio", theme, embedded: true, bg, width: 700, out, extraCss });
console.log("→", out);
