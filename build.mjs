// Build the extension from src/ into dist/<target>/ for Chrome and Firefox.
// JS is bundled (content scripts can't use ES modules at runtime) and, for a
// production build, minified; CSS is minified; static assets are copied; and the
// manifest is emitted per-target (Chrome: service worker, Firefox: event-page
// scripts + gecko keys).
//
//   node build.mjs            production build → dist/chrome + dist/firefox
//   node build.mjs --watch    dev build of dist/chrome only, rebuilt on change
import { build, context } from "esbuild";
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const DEV = process.argv.includes("--watch");
const TARGETS = DEV ? ["chrome"] : ["chrome", "firefox"];

const baseManifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

function manifestFor(target) {
  const m = JSON.parse(JSON.stringify(baseManifest));
  if (target === "chrome") {
    delete m.browser_specific_settings;       // gecko-only keys Chrome rejects
    m.background = { service_worker: "background.js" };
  } else {
    m.background = { scripts: ["background.js"] };  // Firefox event page
  }
  return m;
}

// Entry name → output path (relative to the target dir). content scripts and the
// popup script become single bundled IIFE files; the manifest references these.
const jsEntries = {
  content: join(SRC, "content/index.js"),
  background: join(SRC, "background/index.js"),
  "popup/popup": join(SRC, "popup/index.js"),
};

function copyStatics(out, target) {
  cpSync(join(SRC, "_locales"), join(out, "_locales"), { recursive: true });
  cpSync(join(SRC, "icons"), join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");
  // popup.html: drop comments and collapse indentation (it links popup.css/.js).
  let html = readFileSync(join(SRC, "popup/popup.html"), "utf8");
  if (!DEV) html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\n\s*/g, "\n").trim();
  mkdirSync(join(out, "popup"), { recursive: true });
  writeFileSync(join(out, "popup/popup.html"), html);
}

async function buildTarget(target) {
  const out = join("dist", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "popup"), { recursive: true });
  copyStatics(out, target);

  const js = {
    entryPoints: jsEntries,
    outdir: out,
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: !DEV,
    sourcemap: DEV ? "inline" : false,
    legalComments: "none",
    logLevel: "warning",
  };
  const css = {
    entryPoints: [join(SRC, "popup/popup.css")],
    outfile: join(out, "popup/popup.css"),
    minify: !DEV,
    sourcemap: DEV ? "inline" : false,
    logLevel: "warning",
  };

  if (DEV) {
    const [cJs, cCss] = await Promise.all([context(js), context(css)]);
    await Promise.all([cJs.watch(), cCss.watch()]);
    console.log(`watching → ${out} (rebuilds JS/CSS; re-run for html/asset changes)`);
  } else {
    await Promise.all([build(js), build(css)]);
    console.log(`built → ${out}`);
  }
}

for (const t of TARGETS) await buildTarget(t);
