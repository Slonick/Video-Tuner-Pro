// Render the popup with mocked data to a PNG, headless — no live page. Shared by
// the screenshot and promo tools. Measures content height for a tight capture
// with uniform padding, and can force a colour theme.
import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

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

// One-time setup (dist build, mock bundle, shared static copies), memoized so
// concurrent renderPopup calls share it instead of redoing esbuild per call.
let prepared = null;
function prepare() {
  prepared ??= (async () => {
    await ensureDist();
    await mkdir(TMP, { recursive: true });
    await buildMock();
    await copyFile(join(DIST, "popup.css"), join(TMP, "popup.css"));
    await copyFile(join(DIST, "popup.js"), join(TMP, "popup.js"));
  })();
  return prepared;
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

// One-shot headless Chrome run with a hard timeout and a single retry:
// concurrent headless instances occasionally hang at exit instead of
// terminating, which would otherwise stall the whole render pool forever.
// stderr is captured and discarded (harmless dbus spam on CI).
export async function runChrome(args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await execFile(CHROME, args, {
        encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000, killSignal: "SIGKILL",
      });
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}

// Measure the body height and — when the compressor section is in the DOM — its
// top/bottom, so callers can frame that block tightly with uniform padding.
async function measureHeight(file) {
  const { stdout } = await runChrome([
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--virtual-time-budget=1200", "--dump-dom", `file://${file}`,
  ]);
  const h = stdout.match(/VH(\d+)/);
  const a = stdout.match(/AUD(\d+)_(\d+)/);
  return { height: h ? Number(h[1]) : 600, audioTop: a ? Number(a[1]) : null, audioBottom: a ? Number(a[2]) : null };
}

// `height`: skip the measure pass and capture at this height — themes don't
// change layout, so a re-render of the same scenario can reuse the first one.
export async function renderPopup({ scenario = "audio", locale = "en", out, theme = "light", dpr = 2, width = 340, expand = null, extraCss = "", height = null }) {
  await prepare();

  const messages = JSON.parse(await readFile(join(ROOT, `src/_locales/${locale}/messages.json`), "utf8"));
  // The popup header shows the manifest version; feed the real one to the mock.
  const { version } = JSON.parse(await readFile(join(ROOT, "src/manifest.json"), "utf8"));
  const inject =
    `<script>window.__SCENARIO__=${JSON.stringify(scenario)};window.__MESSAGES__=${JSON.stringify(messages)};window.__VERSION__=${JSON.stringify(version)};</script>\n` +
    `<script src="mock.js"></script>\n`;
  // Optionally open a collapsible section (e.g. the compressor) for the shot:
  // disable the transition + max-height none so it expands fully and instantly.
  const expandJs = expand
    ? `<script>addEventListener("load",()=>{const e=document.getElementById(${JSON.stringify(expand)});if(e){e.style.transition="none";e.classList.add("open");e.style.maxHeight="none";}const b=document.querySelector('[data-target="${expand}"]');if(b)b.setAttribute("aria-expanded","true");});</script>\n`
    : "";

  // The mock sets toggles checked at runtime, which fires the knob's slide
  // transition; a screenshot can land mid-slide and freeze the knob off-centre.
  // Kill the switch transition so the checked state renders at its final spot.
  const freeze = '<style>.switch-track,.switch-knob{transition:none!important}</style>';
  const extra = freeze + (extraCss ? `<style>${extraCss}</style>` : "");
  let html = await readFile(join(DIST, "popup.html"), "utf8");
  html = html.replace('<link rel="stylesheet" href="popup.css">', '<link rel="stylesheet" href="popup.css">' + (await themeStyle(theme)) + extra);
  html = html.replace('<script src="popup.js"></script>', inject + '<script src="popup.js"></script>\n' + expandJs);
  // Per-render file names so concurrent renders don't clobber each other; the
  // shared popup.css/js/mock.js copies are identical for every render.
  const tag = basename(out).replace(/\.png$/, "");
  const pageFile = join(TMP, `popup-${tag}.html`);
  await writeFile(pageFile, html);

  let audioTop = null, audioBottom = null;
  if (height == null) {
    // Measure pass → tight capture (uniform padding, no empty tail). Wait past
    // the section open transition (0.28s) before measuring. Also record the
    // compressor section's bounds so promo framing can box it tightly.
    const meas = html.replace("</body>",
      '<script>addEventListener("load",()=>setTimeout(()=>{const b=Math.ceil(document.body.getBoundingClientRect().height);const e=document.getElementById("audioBody");let a="";if(e){const r=e.closest(".sync-section").getBoundingClientRect();a="AUD"+Math.round(r.top)+"_"+Math.round(r.bottom);}document.title="VH"+b+" "+a;},450))</script></body>');
    const measFile = join(TMP, `measure-${tag}.html`);
    await writeFile(measFile, meas);
    ({ height, audioTop, audioBottom } = await measureHeight(measFile));
  }

  await runChrome([
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--force-device-scale-factor=${dpr}`, `--window-size=${width},${height}`,
    "--virtual-time-budget=2500", `--screenshot=${out}`,
    `file://${pageFile}`,
  ]);

  return { out, width, height, audioTop, audioBottom };
}
