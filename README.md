# Video Tuner Pro

A cross-browser (Chrome + Firefox) toolkit for better video on any website:
playback-speed control, smart live-stream sync, and audio compression to even
out loud and quiet sounds. Speed is expressed as a percentage, set with a slider
or one-click presets, with smart handling for live streams.

## Install

- **Chrome / Edge / Brave:** [Chrome Web Store](https://chromewebstore.google.com/detail/video-speed-controller-pro/ichlipldofdemkhlhnoekfkpfejfanno)
- **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/video-speed-controller-pro/)

## Features

- Control playback speed on virtually any site with HTML5 `<video>`, including videos inside embedded frames.
- Percentage-based speed: presets (50%–250%) plus a fine slider.
- **Per-site memory** — set a speed and click *Remember site* to keep it for that domain. Sites you haven't remembered play at 100%.
- **Smart live-stream handling** — manual speed is never applied to a live stream; the buffer is protected.
- **Live-sync** — an optional mode that automatically catches a live stream back up to the live edge when you fall behind, then eases back to normal.
- **Audio compression** — optional Web-Audio dynamics compressor that evens out loud and quiet passages, with full controls (threshold, knee, ratio, attack, release, make-up gain) and a reset to defaults. Doesn't apply on sites that serve video cross-origin without CORS, where the browser mutes Web-Audio processing.
- Localized into 10 languages: English, Russian, Ukrainian, Spanish, Portuguese (BR), German, French, Chinese (Simplified), Japanese, and Hindi.
- No accounts, no analytics, no tracking — all settings are stored locally on your device.

## Usage

1. Open a page with a video and click the extension icon.
2. Drag the slider or pick a preset to change the speed — it applies to the current tab immediately.
3. Click **Remember site** to save the current speed for this domain. The header shows the current site and speed.

The next time you visit a remembered site, its saved speed is applied automatically. Sites without a saved speed default to 100%.

## Live streams

On a live stream (YouTube Live, Twitch, etc.) the **manual speed controls are
disabled** — presets and the slider don't affect the broadcast. The stream plays
at 100% until it needs to catch up, and only **Live-sync** governs its speed.

### Live-sync

Toggle it on in the popup; it then runs in the background for any live stream:

- It tracks how far playback has drifted behind the stream's live edge (measured from the buffered-ahead amount, which is reliable across players).
- If you fall behind by more than the allowed delay — for example after pausing, a stall, or a backgrounded tab — it **gently** raises the speed to catch back up.
- The further behind you are, the stronger the catch-up (up to the configured maximum); as you reach the live edge the speed returns to **100%**.
- The buffer is respected, so it won't speed up into an empty buffer and cause re-buffering.

Settings (in the popup):

- **Allowed delay** — `0–15s`, default **3s**.
- **Max catch-up speed** — `125%–300%`, default **150%**. The ceiling Live-sync may accelerate to.

## How it works

- A **content script** (`content.js`) applies the speed to every `<video>` on the page, re-applies it if the player resets it, and runs all live-stream logic.
- The **popup** (`popup/`) changes the speed and exposes the Live-sync settings.
- `storage.local` holds the per-domain speeds and the Live-sync settings. There is no background service worker, which keeps the extension simple and cross-browser.

## Project layout

```
manifest.json              Manifest V3 config (Chrome + Firefox)
content.js                 Speed control + live-stream logic
popup/
  ├── popup.html           Popup UI
  └── popup.js             Popup logic + i18n wiring
_locales/<lang>/messages.json   Translations (10 languages)
icons/                     PNG icons (16/32/48/96/128)
generate_icons.py          Helper that generates the PNG icons
PRIVACY.md                 Privacy policy
.github/workflows/release.yml   Builds the store packages on each GitHub Release
```

## Building / development

To try a local build, load the unpacked folder:

- **Chrome:** `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select this folder.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → select `manifest.json`.

Store-ready packages are produced automatically: publishing a GitHub Release runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds a
Chrome zip (with the Firefox-only manifest keys stripped) and a Firefox zip, and
attaches both to the release. No store credentials are stored in CI.

## Privacy

The extension collects no data. See [PRIVACY.md](PRIVACY.md).

## License

Free to use. © slonick.dev — all rights reserved.
