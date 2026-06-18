# Building Video Tuner Pro from source

The source in `src/` is written in **TypeScript** and **React** (the popup,
options page, and the in-page badge are React components; everything else is
plain TypeScript). The published packages are built with two tools:
[esbuild](https://esbuild.github.io/) transpiles the TypeScript/JSX (stripping
types — it does no type-checking — and compiling JSX with React's automatic
runtime) and bundles + minifies each entry point, and
[Lightning CSS](https://lightningcss.dev/) bundles the popup/options stylesheets
(inlining the `src/popup/styles/*.css` partials), lowers their nested CSS to flat
selectors, autoprefixes, and minifies them. Type-checking is a separate step
(`npm run check`, via `tsc`) that doesn't affect the output. This document
explains how to reproduce the exact extension package from source (e.g. for
add-on store review).

## Build environment

- **Operating system:** any OS that runs Node.js — Linux, macOS, or Windows.
  (Built and tested on macOS; the CI builds on Ubuntu Linux.)
- **Node.js:** version 18 or newer. CI uses Node.js 24. Any 18+ release reproduces
  identical output, because the build tools (esbuild, Lightning CSS) are
  self-contained native binaries pinned to exact versions in `package-lock.json`.
- **npm:** the version bundled with Node.js. Used only to install the dependencies.
- **No other tools or global installs are required**, and no network access is
  needed during the build itself (only `npm ci` downloads the pinned tools).

Install Node.js + npm from <https://nodejs.org/> (the LTS installer includes npm),
or via a version manager such as [nvm](https://github.com/nvm-sh/nvm):
`nvm install 22 && nvm use 22`.

## Build dependencies

Declared in `package.json` and locked to exact versions in `package-lock.json`:

- **react / react-dom 18.x** — the UI runtime for the popup, options page, and the
  in-page badge. Bundled into the output by esbuild, so they affect the package.
- **esbuild 0.28.x** — TypeScript/JSX transpiler + JavaScript bundler/minifier.
- **Lightning CSS 1.32.x** — CSS bundler: nesting → flat selectors, autoprefix,
  minify. (npm installs the matching prebuilt native binary for your platform,
  e.g. `lightningcss-linux-x64-gnu` on CI — all locked in `package-lock.json`.)
- **typescript 6.0.x** + **@types/chrome** + **@types/react** + **@types/react-dom**
  — type-checking only (`npm run check`). Not used by the build itself; the output
  is identical with or without them.

ESLint, Prettier, Vitest and Playwright are also dev dependencies, but they are
only used for linting/formatting/testing — they have no effect on the built
package.

## Steps to reproduce the exact add-on

From the root of the source tree (the folder containing `package.json`):

```sh
npm ci          # install the exact, locked tools from package-lock.json
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

1. Transpiles + bundles each entry point into a single classic IIFE file (content
   scripts can't use ES modules at runtime) and **minifies** it — compiling JSX
   with React's automatic runtime along the way:
   `src/content/index.ts`, `src/content/inject.ts`, `src/background/index.ts`,
   `src/popup/index.tsx`, and `src/options/index.tsx`.
2. Bundles `src/popup/popup.css` and `src/options/options.css` (inlining the
   `src/popup/styles/*.css` partials they `@import`), **lowers** the nested CSS to
   flat selectors, autoprefixes, and **minifies** it — via Lightning CSS.
3. Copies the static assets unchanged: `src/_locales/` and `src/icons/`.
4. Lightly minifies `src/popup/popup.html` + `src/options/options.html` and copies
   them.
5. Writes the per-browser `manifest.json` from `src/manifest.json`.

## npm scripts

- `npm run build` — minified production build of `dist/chrome/` and `dist/firefox/`.
- `npm run dev` — unminified watch build (with inline source maps) of
  `dist/chrome/` only; rebuilds JS/CSS on save. Load `dist/chrome/` as an unpacked
  extension for development.
- `npm run check` — type-check the whole project with `tsc --noEmit` (strict).
- `npm run lint` / `npm run lint:fix` — ESLint (TypeScript + React Hooks rules).
- `npm run format` / `npm run format:check` — Prettier (write / verify).
- `npm test` — unit tests (Vitest). `npm run test:coverage` enforces the coverage
  thresholds; `npm run test:e2e` builds and runs the Playwright end-to-end suite.
- `npm run screenshot [scenario]` — render the popup with mocked data to a PNG
  (`.screenshots/`) via headless Chrome. Scenarios: audio, live, vot, idle.
- `npm run promo` / `npm run promo:gif` — generate the localized store assets and
  the README animation. All test/lint/screenshot/promo scripts are dev-only and
  not needed to build the add-on.

## Source layout

```
src/
  manifest.json
  background/index.ts
  content/   index.ts inject.ts state.ts videos.ts speed.ts bitrate.ts channel.ts
             keyboard.ts theater.ts messaging.ts monitor.ts
             platform/{browser,storage,i18n,log}.ts
             core/{constants,clamp,domain,badge-pos,resolve}.ts
             live/{detection,metrics,sync,catchup,target}.ts
             badge/{icon.ts, overlay.ts, BadgeView.tsx}      (React shadow-root badge)
             audio/{types,translation,routing,compressor,metering,levels,status}.ts
  popup/     index.tsx i18n.ts dom.ts icons.tsx
             components/   App, Header, SpeedCard, LiveSyncCard, AudioCard,
                           ScopeSegment, PresetGrid, ParamSlider, StoredToggle, InfoTip  (.tsx)
             hooks/        useSpeed, useLiveSync, useAudioCompressor, useScopeSelection,
                           useExpand, useGraphs, tab, storage  (.ts)
             lib/{scope,messaging,section-anim}.ts
             platform/{browser,storage}.ts
             core/{constants,clamp,domain,debounce,seg-pill,tween-number,tween-slider}.ts
             graphs/{index,state,draw-util,audio-meter,latency-graph,poll}.ts
             popup.html  popup.css  styles/*.css   (CSS entry + partials)
  options/   index.tsx  options.html  options.css   sections/{General,Keys,Presets,Saved,Sync}.tsx
  ui/        Switch.tsx               (React components shared by popup + options)
  types/globals.d.ts                  (ambient types: browser alias, webkit* APIs)
  _locales/  icons/
build.mjs  package.json  package-lock.json  tsconfig.json
eslint.config.js  .prettierrc.json  vitest.config.ts  playwright.config.ts
```

The React UI follows a components / hooks / lib split: components render markup,
hooks own state + behaviour (messaging, storage, polling), and the imperative
bits React can't express declaratively (tweens, FLIP, canvas meters) live behind
refs + effects. The non-UI code keeps single-responsibility modules: `platform/`
wraps the browser API, `core/` holds pure helpers, and each feature is split by
concern (live → detection / metrics / sync; audio → routing / compressor /
metering).

Everything under `src/` is the original, unminified source. `node_modules/` and
`dist/` are generated by the steps above and are not part of the source.
