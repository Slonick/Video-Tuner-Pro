// Render the options page headless with a mock chrome, for visual self-review.
//   node tools/screenshot-options.mjs [dark|light]
import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFile as ef } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(ef);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIST = join(ROOT, "dist/chrome/options");
const TMP = join(ROOT, ".screenshots/_work");
const theme = process.argv[2] || "dark";

await mkdir(TMP, { recursive: true });
await build({
  entryPoints: [join(ROOT, "tools/_mock-options.ts")],
  outfile: join(TMP, "mock-opt.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  logLevel: "silent",
});
await copyFile(join(DIST, "options.css"), join(TMP, "options.css"));
await copyFile(join(DIST, "options.js"), join(TMP, "options.js"));

const messages = JSON.parse(await readFile(join(ROOT, "src/_locales/en/messages.json"), "utf8"));
const { version } = JSON.parse(await readFile(join(ROOT, "src/manifest.json"), "utf8"));
const tcss = await readFile(join(ROOT, "src/popup/styles/tokens.css"), "utf8");
const blocks = [...tcss.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
const vars = theme === "dark" ? blocks[1] : blocks[0];
const themeStyle = vars ? `<style>:root{${vars}}</style>` : "";

let html = await readFile(join(DIST, "options.html"), "utf8");
const inject =
  `<script>window.__MESSAGES__=${JSON.stringify(messages)};window.__VERSION__=${JSON.stringify(version)};window.__THEME__=${JSON.stringify(theme)};window.__GLASS__=${JSON.stringify(process.env.GLASS || "1")};</script>\n` +
  `<script src="mock-opt.js"></script>\n`;
html = html.replace(/<link[^>]*options\.css[^>]*>/, (m) => m + themeStyle);
html = html.replace(
  '<script src="options.js"></script>',
  inject + '<script src="options.js"></script>',
);
const pageFile = join(TMP, "options-page.html");
await writeFile(pageFile, html);

const out = join(ROOT, ".screenshots", `options-${theme}.png`);
await execFile(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=2",
    "--window-size=680,1500",
    "--virtual-time-budget=3000",
    `--screenshot=${out}`,
    `file://${pageFile}`,
  ],
  { maxBuffer: 32 * 1024 * 1024, timeout: 40_000, killSignal: "SIGKILL" },
);
console.log("→", out);
