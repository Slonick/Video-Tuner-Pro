// Dev hot-reload: an UNPACKED install (installType "development") watches its
// own build-stamp.txt and calls runtime.reload() when a new build lands in the
// source directory, so testing doesn't require a manual ⟳ on chrome://extensions.
// Store installs never see a different stamp (the file is packaged), and the
// alarm is only ever created for development installs anyway.
//
// The stamp the extension was LOADED with is kept in storage.session: it
// survives service-worker restarts but is cleared when the extension reloads,
// so a worker waking up long after a build still detects the change without
// ever looping.
import { getExtensionApi } from "../shared/extension-api.js";

const api = getExtensionApi();
const STAMP_KEY = "vtpDevBuildStamp";
const ALARM = "vtp-dev-reload";

function readStamp(): Promise<string> {
  return fetch(api.runtime.getURL("build-stamp.txt"), { cache: "no-store" }).then((r) => r.text());
}

async function check(): Promise<void> {
  try {
    const current = await readStamp();
    const stored = await new Promise<Record<string, unknown>>((resolve) =>
      api.storage.session.get([STAMP_KEY], (items) => resolve(items as Record<string, unknown>)),
    );
    const loaded = stored?.[STAMP_KEY];
    if (typeof loaded !== "string") {
      await new Promise<void>((resolve) =>
        api.storage.session.set({ [STAMP_KEY]: current }, resolve),
      );
      return;
    }
    if (current !== loaded) api.runtime.reload();
  } catch {
    /* mid-build: the file may briefly be missing */
  }
}

// MV3 requires event listeners to be registered synchronously at worker start —
// an alarm that wakes a sleeping worker after an await would find no handler
// and the check would never run.
try {
  api.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void check();
  });
} catch {
  /* alarms unavailable (tests) — initDevReload below is a no-op there too */
}

export async function initDevReload(): Promise<void> {
  try {
    const self = await api.management.getSelf();
    if (self.installType !== "development") return;
    api.alarms.create(ALARM, { periodInMinutes: 0.5 });
    void check();
  } catch {
    /* management/session storage unavailable — skip hot reload */
  }
}
