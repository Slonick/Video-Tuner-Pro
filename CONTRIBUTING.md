# Contributing to Video Tuner Pro

Thanks for taking the time to contribute! Video Tuner Pro is a cross-browser
Manifest V3 extension written in strict TypeScript, with the popup and options
UI built in React.

## Getting started

You need Node.js 18+ (CI builds on 24).

```sh
npm ci
npm run build      # production build → dist/chrome and dist/firefox
npm run dev        # dev build of dist/chrome only, rebuilt on change
```

Then load the unpacked extension in your browser:

- **Chrome / Edge / Brave:** `chrome://extensions` → enable Developer mode → *Load unpacked* → pick `dist/chrome`.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → pick any file in `dist/firefox`.

## Before you open a PR

CI runs these in order on every PR — `lint` → `unit` → `e2e` — and blocks the
merge if any fail, so please run them first (a Claude code review runs last):

```sh
npm run format:check   # Prettier formatting   (npm run format to fix)
npm run lint           # ESLint                (npm run lint:fix to fix)
npm run check          # TypeScript type-check (tsc --noEmit)
npm test               # unit tests (Vitest)
npm run test:e2e       # end-to-end (Playwright) — builds, then drives real Chromium
```

## Pull requests

- Branch off `main`, one focused change per PR.
- Keep the diff surgical — touch only what the change needs, and match the surrounding style.
- Add or update tests for any behavior change.
- Describe what changed and why in the PR body.

## License

By contributing you agree that your contributions are licensed under the
project's [GPL-3.0](LICENSE) license.
