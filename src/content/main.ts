// Boot guard for the content bundle. The manifest injection and the background's
// programmatic reinjection (onInstalled/onStartup, see background/index.ts) can
// race on a tab that is still loading, and both copies land in the SAME isolated
// world. Two live copies each re-assert their own effective speed from the
// other's ratechange — a self-sustaining event storm (hundreds of thousands of
// ratechange/s) that pins the renderer and balloons memory until the tab dies.
// The world's window is shared between the copies, so a plain flag is enough;
// after an extension update the new copy gets a fresh isolated world, so the
// stale flag of an orphaned instance can't block it.
const w = window as typeof window & { __vtpContentBooted?: boolean };
if (!w.__vtpContentBooted) {
  w.__vtpContentBooted = true;
  void import("./index.js");
}
