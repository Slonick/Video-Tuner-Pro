# Privacy Policy — Video Tuner Pro

_Last updated: 2026-07-15_

Video Tuner Pro ("the extension") is designed with privacy as a
priority. This policy explains what the extension does and does not do with
your information.

## Summary

**The extension does not collect, sell, or send personal data to the developer.**
It has no developer-operated servers, analytics, or third-party tracking. The
optional SponsorBlock marker feature makes the limited request described below.

## What the extension stores

The extension saves settings using the browser's `storage.local` and
`storage.sync` APIs. Sync is enabled by default and can be disabled globally or
per category in the extension settings.

- Your chosen playback speed for individual websites you choose to remember.
- Your Live-sync preferences (enabled/disabled, allowed delay, and buffer reserve).
- Audio, viewer, appearance, and keyboard preferences.

Synced categories are handled by your browser vendor through your signed-in
browser profile. The developer does not receive this data. You can keep any
category on-device, clear saved settings, or uninstall the extension at any time.

## Permissions and why they are used

- **storage** — to save your speed and Live-sync settings locally, as described
  above.
- **scripting** — to restore the extension in already-open tabs after an extension
  update and to locate the frame that owns the active video.
- **alarms** — to periodically check whether a newer extension release is available.
- **Host access to all sites (`<all_urls>`)** — the extension must detect and
  control HTML5 `<video>` playback on whatever website you are watching. Page
  and video data are otherwise processed locally; the only optional external
  transmission is the SponsorBlock request described below.

## Data sharing

**SponsorBlock markers are disabled by default.** When the user explicitly
enables them on YouTube, the extension requests public segment data from
`sponsor.ajay.app`. On Firefox, the extension first requests the optional
`browsingActivity` data permission; if the user declines, no request is made.

The HTTPS request includes the current YouTube video ID and a fixed list of
requested segment categories. Credentials and referrer data are explicitly
omitted. The request does not include cookies, saved settings, audio, video
content, analytics identifiers, or account credentials. Like any network
service, SponsorBlock receives ordinary connection metadata such as the user's
IP address. Responses are cached only in memory and are not stored permanently.
Disabling SponsorBlock markers stops these requests.

The developer does not otherwise share, sell, or transfer user data. Browser
settings sync is provided by the browser vendor under the user's browser account.

## Changes to this policy

If this policy changes, the updated version will be published at this URL with a
new "Last updated" date.

## Contact

Questions about this policy: **contact@slonick.dev**
