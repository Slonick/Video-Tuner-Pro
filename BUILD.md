# Building Video Tuner Pro from source

The source in `src/` is written in **TypeScript**. The published packages are
built with two tools: [esbuild](https://esbuild.github.io/) transpiles the
TypeScript (stripping types — it does no type-checking) and bundles + minifies
each entry point, and [Lightning CSS](https://lightningcss.dev/) bundles the
popup stylesheet (inlining the `src/popup/styles/*.css` partials), lowers its
nested CSS to flat selectors, autoprefixes, and minifies it. Type-checking is a
separate step (`npm run check`, via `tsc`) that doesn't affect the output. This
document explains how to reproduce the exact extension package from source (e.g.
for add-on store review).

## Build environment

- **Operating system:** any OS that runs Node.js — Linux, macOS, or Windows.
  (Built and tested on macOS; the CI builds on Ubuntu Linux.)
- **Node.js:** version 18 or newer. Built and tested with **Node.js 22.22.2**;
  CI uses Node.js 24. Any 18+ release reproduces identical output, because both
  build tools (esbuild, Lightning CSS) are self-contained native binaries pinned
  to exact versions.
- **npm:** the version bundled with Node.js (e.g. 10.x with Node 22). Used only to
  install the build dependencies.
- **No other tools or global installs are required**, and no network access is
  needed during the build itself (only `npm ci` downloads the pinned tools).

Install Node.js + npm from <https://nodejs.org/> (the LTS installer includes npm),
or via a version manager such as [nvm](https://github.com/nvm-sh/nvm):
`nvm install 22 && nvm use 22`.

## Build dependencies

Declared in `package.json` and locked to exact versions in `package-lock.json`:

- **esbuild 0.24.2** — TypeScript transpiler + JavaScript bundler/minifier.
- **Lightning CSS 1.32.0** — CSS bundler: nesting → flat selectors, autoprefix,
  minify. (npm installs the matching prebuilt native binary for your platform,
  e.g. `lightningcss-linux-x64-gnu` on CI — all locked in `package-lock.json`.)
- **typescript 6.0.x** + **@types/chrome** — type-checking only (`npm run check`).
  Not used by the build itself; the output is identical with or without it.

## Steps to reproduce the exact add-on

From the root of the source tree (the folder containing `package.json`):

```sh
npm ci          # install the exact, locked build tools from package-lock.json
npm run build   # run the build script (build.mjs)
```

This produces two folders:

- `dist/firefox/` — the **Firefox** package (manifest with `browser_specific_settings`
  and an event-page `scripts` background).
- `dist/chrome/` — the **Chrome / Edge** package (gecko-only keys stripped, a
  `service_worker` background).

The submitted add-on is the **contents of `dist/firefox/`** (zipped). To verify,
build and diff `dist/firefox/` against the package under review.

## What the build script does

`build.mjs` (run by `npm run build`) performs every technical step:

1. Transpiles + bundles `src/content/index.ts`, `src/content/inject.ts`,
   `src/background/index.ts`, and `src/popup/index.ts` — each into a single
   classic IIFE file (content scripts can't use ES modules at runtime), and
   **minifies** them.
2. Bundles `src/popup/popup.css` (inlining the `src/popup/styles/*.css` partials
   it `@import`s), **lowers** its nested CSS to flat selectors, autoprefixes, and
   **minifies** it — via Lightning CSS.
3. Copies the static assets unchanged: `src/_locales/` and `src/icons/`.
4. Lightly minifies `src/popup/popup.html` and copies it.
5. Writes the per-browser `manifest.json` from `src/manifest.json`.

## npm scripts

- `npm run build` — minified production build of `dist/chrome/` and `dist/firefox/`.
- `npm run dev` — unminified watch build (with inline source maps) of
  `dist/chrome/` only; rebuilds JS/CSS on save. Load `dist/chrome/` as an unpacked
  extension for development.
- `npm run check` — type-check the whole project with `tsc --noEmit` (strict).
- `npm test` — unit tests (Vitest). Dev-only; not needed to build the add-on.
- `npm run screenshot [scenario]` — render the popup with mocked data to a PNG
  (`.screenshots/`) via headless Chrome. Dev-only. Scenarios: audio, live, vot, idle.

## Source layout

```
src/
  manifest.json
  background/index.ts
  content/   index.ts inject.ts state.ts videos.ts speed.ts bitrate.ts messaging.ts monitor.ts
             platform/{browser,storage,i18n,log}.ts   core/{constants,clamp,domain}.ts
             live/{detection,metrics,sync}.ts          badge/{icon,indicator,overlay}.ts
             audio/{types,translation,routing,compressor,metering,status}.ts
  popup/     index.ts i18n.ts dom.ts state.ts speed.ts live-sync.ts audio-settings.ts sections.ts
             platform/{browser,storage}.ts             core/{constants,clamp,domain,debounce}.ts
             graphs/{index,state,draw-util,audio-meter,latency-graph,poll,translation-warn}.ts
             popup.html  popup.css  styles/*.css   (CSS entry + partials)
  types/globals.d.ts      (ambient types: browser alias, webkit* APIs)
  _locales/               icons/
build.mjs                 package.json     package-lock.json     tsconfig.json
```

Modules follow single-responsibility (SRP): `platform/` wraps the browser API,
`core/` holds pure helpers, and each feature is split by concern (e.g. live →
detection / metrics / sync; audio → routing / compressor / metering).

Everything under `src/` is the original, unminified source. `node_modules/` and
`dist/` are generated by the steps above and are not part of the source.
