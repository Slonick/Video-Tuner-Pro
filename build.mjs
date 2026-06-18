// Build the extension from src/ into dist/<target>/ for Chrome and Firefox.
// JS is bundled (content scripts can't use ES modules at runtime) and, for a
// production build, minified; CSS is bundled + lowered + minified by Lightning
// CSS (nesting → flat selectors, autoprefix); static assets are copied; and the
// manifest is emitted per-target (Chrome: service worker, Firefox: event-page
// scripts + gecko keys).
//
//   node build.mjs              production build → dist/chrome + dist/firefox
//   node build.mjs --target=X   production build of a single target (chrome|firefox)
//   node build.mjs --watch      dev build of dist/chrome only, rebuilt on change
import { build, context } from "esbuild";
import { bundle as bundleCss } from "lightningcss";
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, watch } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const DEV = process.argv.includes("--watch");
const ALL_TARGETS = ["chrome", "firefox"];
// --target=<name> builds a single target (used by the per-target release matrix).
const ONLY = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1];
if (ONLY && !ALL_TARGETS.includes(ONLY)) {
  console.error(`Unknown --target=${ONLY} (expected ${ALL_TARGETS.join(" or ")})`);
  process.exit(1);
}
const TARGETS = ONLY ? [ONLY] : DEV ? ["chrome"] : ALL_TARGETS;

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
  content: join(SRC, "content/index.ts"),
  background: join(SRC, "background/index.ts"),
  "popup/popup": join(SRC, "popup/index.tsx"),
  "options/options": join(SRC, "options/index.tsx"),
  inject: join(SRC, "content/inject.ts"),   // MAIN-world Twitch/YouTube latency probe
};

// HTML/CSS page bundles: each <dir>/<name>.html links a bundled <name>.js/.css.
const PAGES = ["popup/popup", "options/options"];

function copyStatics(out, target) {
  cpSync(join(SRC, "_locales"), join(out, "_locales"), { recursive: true });
  cpSync(join(SRC, "icons"), join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");
  // Each page's .html: drop comments and collapse indentation (it links .css/.js).
  for (const page of PAGES) {
    let html = readFileSync(join(SRC, page + ".html"), "utf8");
    if (!DEV) html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\n\s*/g, "\n").trim();
    mkdirSync(join(out, page, ".."), { recursive: true });
    writeFileSync(join(out, page + ".html"), html);
  }
}

// Lightning CSS bundles the ./styles/*.css partials @import-ed by popup.css,
// lowers nested CSS to flat selectors for the targets below, autoprefixes, and
// minifies for production. The chrome floor predates native nesting on purpose,
// so the authored nested CSS compiles to plain selectors that work everywhere.
const CSS_TARGETS = { chrome: 100 << 16, firefox: 140 << 16 };

function buildCssPage(out, page) {
  const { code, map } = bundleCss({
    filename: join(SRC, page + ".css"),
    minify: !DEV,
    sourceMap: DEV,
    targets: CSS_TARGETS,
  });
  let css = code;
  if (DEV && map) {
    const inline = Buffer.from(map).toString("base64");
    css = Buffer.concat([code, Buffer.from(`\n/*# sourceMappingURL=data:application/json;base64,${inline} */\n`)]);
  }
  writeFileSync(join(out, page + ".css"), css);
}

function buildCss(out) {
  for (const page of PAGES) buildCssPage(out, page);
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
    jsx: "automatic",      // React 17+ automatic runtime — no `import React` needed
    minify: !DEV,
    sourcemap: DEV ? "inline" : false,
    legalComments: "none",
    logLevel: "warning",
  };

  if (DEV) {
    const cJs = await context(js);
    await cJs.watch();
    buildCss(out);
    // Lightning CSS has no watcher of its own — rebuild on any .css change under
    // src (popup/options entry + their styles/* partials), debounced.
    let t = null;
    watch(SRC, { recursive: true }, (_ev, file) => {
      if (!file || !file.endsWith(".css")) return;
      clearTimeout(t);
      t = setTimeout(() => {
        try { buildCss(out); console.log("rebuilt CSS"); }
        catch (e) { console.error("CSS error:", e.message); }
      }, 60);
    });
    console.log(`watching → ${out} (rebuilds JS/CSS; re-run for html/asset changes)`);
  } else {
    await build(js);
    buildCss(out);
    console.log(`built → ${out}`);
  }
}

for (const t of TARGETS) await buildTarget(t);
