// Popup ⇄ content messaging. The popup messages the whole tab (all frames); only
// the frame holding the video replies, with the top frame as a deferred fallback.
import { api } from "./platform/browser.js";
import { getDomain } from "./core/domain.js";
import { channelKeys, currentChannel, currentChannelName } from "./channel.js";
import { clamp, clampTarget } from "./core/clamp.js";
import { S } from "./state.js";
import { hasVideos, isDrmVideo, primaryVideo } from "./videos.js";
import { onStreamPage } from "./live/detection.js";
import {
  setSpeed,
  persistDomainSpeed,
  persistChannelSpeed,
  persistGlobalSpeed,
  resetScope,
  resetToSaved,
} from "./speed.js";
import {
  setTarget,
  persistSiteTarget,
  persistChannelTarget,
  persistGlobalTarget,
  resetTargetScope,
  applyResolvedTargetFromStore,
} from "./live/target.js";
import {
  persistSiteAutoSlow,
  persistChannelAutoSlow,
  persistGlobalAutoSlow,
  resetAutoSlowScope,
  setAutoSlowPreview,
  applyResolvedAutoSlowFromStore,
} from "./audio/autoslow-config.js";
import {
  persistSiteViewerAuto,
  persistChannelViewerAuto,
  persistGlobalViewerAuto,
  resetViewerAutoScope,
  applyResolvedViewerAutoFromStore,
} from "./viewer-auto.js";
import {
  persistSiteViewerFit,
  persistChannelViewerFit,
  persistGlobalViewerFit,
  resetViewerFitScope,
  applyResolvedViewerFitFromStore,
} from "./viewer-fit.js";
import { setViewerFitMode, setViewerState, viewerFormat } from "./viewer.js";
import { AUTO_SLOW_DEFAULTS, type AutoSlowSettings } from "./core/resolve.js";
import { monitorData } from "./monitor.js";
import { audioLevelHist, A_HIST_MS } from "./audio/metering.js";
import { autoSlowHist, AUTO_SLOW_HIST_MS } from "./audio/autoslow-state.js";
import { bufferLevelHist } from "./bitrate.js";

// Build the scoped target from a popup message, clamped to valid ranges.
function autoSlowFromRequest(req: { target?: unknown }): AutoSlowSettings {
  const target = Number(req.target);
  return {
    target: Number.isNaN(target) ? AUTO_SLOW_DEFAULTS.target : Math.min(12, Math.max(3, target)),
  };
}

function viewerAutoFromRequest(req: { mode?: unknown }): "off" | "normal" | "theater" {
  return req.mode === "normal" || req.mode === "theater" ? req.mode : "off";
}

function viewerFitFromRequest(req: { mode?: unknown }): "contain" | "cover" | "fill" {
  return req.mode === "cover" || req.mode === "fill" ? req.mode : "contain";
}

function replyFromVideoFrame(
  sendResponse: (response?: unknown) => void,
  build: () => unknown,
): boolean {
  const hasVid = hasVideos();
  const reply = () => {
    try {
      sendResponse(build());
    } catch (e) {}
  };
  if (hasVid) {
    reply();
    return true;
  }
  if (window.top === window) {
    setTimeout(reply, 60);
    return true;
  }
  return false; // subframe without a video stays silent
}

function actInVideoFrame(
  sendResponse: (response?: unknown) => void,
  act: () => unknown,
  build: (result: unknown) => unknown,
): boolean {
  if (!hasVideos()) return false;
  let result: unknown;
  try {
    result = act();
    sendResponse(build(result));
  } catch (e) {
    sendResponse({ success: false });
  }
  return true;
}

function currentDrmProtected(): boolean {
  try {
    return isDrmVideo(primaryVideo());
  } catch (e) {
    return false;
  }
}

function channelInfo(): { channel: string | null; channelKeys: string[]; channelName: string } {
  const keys = channelKeys();
  return {
    channel: keys[0] ?? currentChannel(),
    channelKeys: keys,
    channelName: currentChannelName(),
  };
}

function topFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function replySaved(sendResponse: (response?: unknown) => void, extra?: Record<string, unknown>) {
  return (ok?: boolean) => sendResponse({ success: ok !== false, ...extra });
}

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setSpeed") {
    if (typeof request.speed !== "number" || !Number.isFinite(request.speed)) {
      return replyFromVideoFrame(sendResponse, () => ({
        success: false,
        speed: S.currentSpeed,
        live: onStreamPage(),
      }));
    }
    // Every frame applies it; only the video frame answers.
    setSpeed(request.speed, false, true);
    return replyFromVideoFrame(sendResponse, () => ({
      success: true,
      speed: S.currentSpeed,
      live: onStreamPage(),
    }));
  }
  if (request.action === "remember") {
    if (!topFrame()) return false;
    const speed =
      typeof request.speed === "number" && Number.isFinite(request.speed)
        ? clamp(request.speed)
        : S.currentSpeed;
    const done = replySaved(sendResponse, { speed });
    if (request.scope === "channel") persistChannelSpeed(speed, done);
    else if (request.scope === "global") persistGlobalSpeed(speed, done);
    else persistDomainSpeed(speed, done);
    return true;
  }
  if (request.action === "reset") {
    if (!topFrame()) return false;
    resetScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
      replySaved(sendResponse),
    );
    return true;
  }
  if (request.action === "resetToSaved") {
    resetToSaved(replySaved(sendResponse));
    return true;
  }
  if (request.action === "getSpeed") {
    return replyFromVideoFrame(sendResponse, () => ({
      speed: S.currentSpeed,
      domain: getDomain(),
      ...channelInfo(),
      scope: S.speedScope,
      live: onStreamPage(),
      viewerSupported: topFrame(),
      ...(currentDrmProtected() ? { drm: true } : {}),
    }));
  }
  // --- Live-sync allowed delay (buffer target), per scope — mirrors speed above.
  if (request.action === "setTarget") {
    setTarget(request.target); // live preview, no persist
    return replyFromVideoFrame(sendResponse, () => ({ success: true, target: S.liveSyncTarget }));
  }
  if (request.action === "rememberTarget") {
    if (!topFrame()) return false;
    const target = clampTarget(request.target);
    const done = replySaved(sendResponse, { target });
    if (request.scope === "channel") persistChannelTarget(target, done);
    else if (request.scope === "global") persistGlobalTarget(target, done);
    else persistSiteTarget(target, done);
    return true;
  }
  if (request.action === "resetTarget") {
    if (!topFrame()) return false;
    resetTargetScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
      replySaved(sendResponse),
    );
    return true;
  }
  if (request.action === "resetTargetToSaved") {
    applyResolvedTargetFromStore(replySaved(sendResponse));
    return true;
  }
  if (request.action === "getTarget") {
    return replyFromVideoFrame(sendResponse, () => ({
      target: S.liveSyncTarget,
      scope: S.targetScope,
      ...channelInfo(),
      live: onStreamPage(),
    }));
  }
  // --- Auto-slow target, per scope — mirrors the live-sync target above.
  if (request.action === "setAutoSlow") {
    setAutoSlowPreview(autoSlowFromRequest(request)); // live preview, no persist
    return replyFromVideoFrame(sendResponse, () => ({ success: true }));
  }
  if (request.action === "rememberAutoSlow") {
    if (!topFrame()) return false;
    const s = autoSlowFromRequest(request);
    const done = replySaved(sendResponse);
    if (request.scope === "channel") persistChannelAutoSlow(s, done);
    else if (request.scope === "global") persistGlobalAutoSlow(s, done);
    else persistSiteAutoSlow(s, done);
    return true;
  }
  if (request.action === "resetAutoSlow") {
    if (!topFrame()) return false;
    resetAutoSlowScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
      replySaved(sendResponse),
    );
    return true;
  }
  if (request.action === "resetAutoSlowToSaved") {
    applyResolvedAutoSlowFromStore(replySaved(sendResponse));
    return true;
  }
  if (request.action === "getAutoSlow") {
    return replyFromVideoFrame(sendResponse, () => ({
      enabled: S.autoSlowEnabled,
      target: S.autoSlowTarget,
      scope: S.autoSlowScope,
      ...channelInfo(),
    }));
  }
  if (request.action === "rememberViewerAuto") {
    if (!topFrame()) return false;
    const mode = viewerAutoFromRequest(request);
    const done = replySaved(sendResponse, { mode });
    if (request.scope === "channel") persistChannelViewerAuto(mode, done);
    else if (request.scope === "global") persistGlobalViewerAuto(mode, done);
    else persistSiteViewerAuto(mode, done);
    return true;
  }
  if (request.action === "resetViewerAuto") {
    if (!topFrame()) return false;
    resetViewerAutoScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
      replySaved(sendResponse),
    );
    return true;
  }
  if (request.action === "resetViewerAutoToSaved") {
    applyResolvedViewerAutoFromStore(replySaved(sendResponse));
    return true;
  }
  if (request.action === "getViewerAuto") {
    return replyFromVideoFrame(sendResponse, () => ({
      mode: S.viewerAuto,
      scope: S.viewerAutoScope,
      ...channelInfo(),
    }));
  }
  if (request.action === "setViewerState") {
    const mode = viewerAutoFromRequest(request);
    return actInVideoFrame(
      sendResponse,
      () => setViewerState(mode, request.live === true),
      () => ({
        success: true,
        mode: viewerFormat() ?? "off",
      }),
    );
  }
  if (request.action === "getViewerState") {
    return replyFromVideoFrame(sendResponse, () => ({ mode: viewerFormat() ?? "off" }));
  }
  if (request.action === "setViewerFit") {
    return actInVideoFrame(
      sendResponse,
      () => setViewerFitMode(request.mode, true),
      (mode) => ({
        success: true,
        mode,
      }),
    );
  }
  if (request.action === "rememberViewerFit") {
    if (!topFrame()) return false;
    const mode = viewerFitFromRequest(request);
    const done = replySaved(sendResponse, { mode });
    if (request.scope === "channel") persistChannelViewerFit(mode, done);
    else if (request.scope === "global") persistGlobalViewerFit(mode, done);
    else persistSiteViewerFit(mode, done);
    return true;
  }
  if (request.action === "resetViewerFit") {
    if (!topFrame()) return false;
    resetViewerFitScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
      replySaved(sendResponse),
    );
    return true;
  }
  if (request.action === "resetViewerFitToSaved") {
    applyResolvedViewerFitFromStore(replySaved(sendResponse));
    return true;
  }
  if (request.action === "getViewerFit") {
    return replyFromVideoFrame(sendResponse, () => ({
      mode: S.viewerFit,
      scope: S.viewerFitScope,
      ...channelInfo(),
    }));
  }
  if (request.action === "getMonitor") {
    return replyFromVideoFrame(sendResponse, () => monitorData());
  }
  if (request.action === "getHistory") {
    const nowT = Date.now();
    return replyFromVideoFrame(sendResponse, () => ({
      audio: audioLevelHist.map((p) => [Math.round(p.in * 10) / 10, Math.round(p.out * 10) / 10]),
      audioStep: A_HIST_MS,
      buffer: bufferLevelHist.map((p) => [
        nowT - p.at,
        Math.round(p.v * 100) / 100,
        p.a == null ? null : Math.round(p.a * 100) / 100,
      ]),
      autoSlow: autoSlowHist.map((p) => [
        Math.round(p.rate * 10) / 10,
        Math.round(p.speed * 100) / 100,
      ]),
      autoSlowStep: AUTO_SLOW_HIST_MS,
    }));
  }
  return false;
});
