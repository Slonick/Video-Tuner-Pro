// Render the popup with mocked data to a PNG, headless — no live page. Shared by
// the screenshot and promo tools. Measures content height for a tight capture
// with uniform padding, and can force a colour theme.
import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIST = join(ROOT, "dist/chrome/popup");
const TMP = join(ROOT, ".screenshots/_work");

const exists = (p) => access(p).then(() => true, () => false);

async function ensureDist() {
  if (!(await exists(join(DIST, "popup.html")))) {
    execFileSync("node", [join(ROOT, "build.mjs")], { cwd: ROOT, stdio: "inherit" });
  }
}

// Force a theme by re-declaring the :root tokens (read straight from source, so
// they never drift) after popup.css — later source wins over the dark @media.
async function themeStyle(theme) {
  if (theme === "auto") return "";
  const css = await readFile(join(ROOT, "src/popup/styles/tokens.css"), "utf8");
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const vars = theme === "dark" ? blocks[1] : blocks[0];
  return vars ? `<style>:root{${vars}}</style>` : "";
}

async function buildMock() {
  await build({
    entryPoints: [join(ROOT, "tools/_mock-entry.ts")],
    outfile: join(TMP, "mock.js"),
    bundle: true, format: "iife", target: "es2022", logLevel: "silent",
  });
}

function measureHeight(file) {
  const dom = execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--virtual-time-budget=1200", "--dump-dom", `file://${file}`,
  ], { encoding: "utf8" });
  const m = dom.match(/VH(\d+)/);
  return m ? Number(m[1]) : 600;
}

export async function renderPopup({ scenario = "audio", locale = "en", out, theme = "light", dpr = 2, width = 340, expand = null, extraCss = "" }) {
  await ensureDist();
  await mkdir(TMP, { recursive: true });
  await buildMock();
  await copyFile(join(DIST, "popup.css"), join(TMP, "popup.css"));
  await copyFile(join(DIST, "popup.js"), join(TMP, "popup.js"));

  const messages = JSON.parse(await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"));
  const inject =
    `<script>window.__SCENARIO__=${JSON.stringify(scenario)};window.__MESSAGES__=${JSON.stringify(messages)};</script>\n` +
    `<script src="mock.js"></script>\n`;
  // Optionally open a collapsible section (e.g. the compressor) for the shot:
  // disable the transition + max-height none so it expands fully and instantly.
  const expandJs = expand
    ? `<script>addEventListener("load",()=>{const e=document.getElementById(${JSON.stringify(expand)});if(e){e.style.transition="none";e.classList.add("open");e.style.maxHeight="none";}const b=document.querySelector('[data-target="${expand}"]');if(b)b.setAttribute("aria-expanded","true");});</script>\n`
    : "";

  const extra = extraCss ? `<style>${extraCss}</style>` : "";
  let html = await readFile(join(DIST, "popup.html"), "utf8");
  html = html.replace('<link rel="stylesheet" href="popup.css">', '<link rel="stylesheet" href="popup.css">' + (await themeStyle(theme)) + extra);
  html = html.replace('<script src="popup.js"></script>', inject + '<script src="popup.js"></script>\n' + expandJs);
  await writeFile(join(TMP, "popup.html"), html);

  // Measure pass → tight capture (uniform padding, no empty tail). Wait past the
  // section open transition (0.28s) before measuring.
  const meas = html.replace("</body>",
    '<script>addEventListener("load",()=>setTimeout(()=>document.title="VH"+Math.ceil(document.body.getBoundingClientRect().height),450))</script></body>');
  await writeFile(join(TMP, "measure.html"), meas);
  const height = measureHeight(join(TMP, "measure.html"));

  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--force-device-scale-factor=${dpr}`, `--window-size=${width},${height}`,
    "--virtual-time-budget=2500", `--screenshot=${out}`,
    `file://${join(TMP, "popup.html")}`,
  ], { stdio: "ignore" });

  return { out, width, height };
}
