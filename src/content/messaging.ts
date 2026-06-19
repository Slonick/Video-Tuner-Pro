// Popup ⇄ content messaging. The popup messages the whole tab (all frames); only
// the frame holding the video replies, with the top frame as a deferred fallback.
import { api } from "./platform/browser.js";
import { getDomain } from "./core/domain.js";
import { currentChannel, currentChannelName } from "./channel.js";
import { clamp, clampTarget } from "./core/clamp.js";
import { S } from "./state.js";
import { collectVideos } from "./videos.js";
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
import { AUTO_SLOW_DEFAULTS, type AutoSlowSettings } from "./core/resolve.js";
import { monitorData } from "./monitor.js";
import { audioLevelHist, A_HIST_MS } from "./audio/metering.js";
import { autoSlowHist, AUTO_SLOW_HIST_MS } from "./audio/autoslow-state.js";
import { bufferLevelHist } from "./bitrate.js";

// Build a settings bundle from a popup message, clamped to valid ranges.
function autoSlowFromRequest(req: { enabled?: unknown; target?: unknown }): AutoSlowSettings {
  const target = Number(req.target);
  return {
    on: req.enabled === true,
    target: Number.isNaN(target) ? AUTO_SLOW_DEFAULTS.target : Math.min(12, Math.max(3, target)),
  };
}

function replyFromVideoFrame(
  sendResponse: (response?: unknown) => void,
  build: () => unknown,
): boolean {
  const hasVid = collectVideos().length > 0;
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

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setSpeed") {
    // Every frame applies it; only the video frame answers.
    setSpeed(request.speed, false, true);
    return replyFromVideoFrame(sendResponse, () => ({
      success: true,
      speed: S.currentSpeed,
      live: onStreamPage(),
    }));
  }
  if (request.action === "remember") {
    const speed = typeof request.speed === "number" ? clamp(request.speed) : S.currentSpeed;
    if (request.scope === "channel") persistChannelSpeed(speed);
    else if (request.scope === "global") persistGlobalSpeed(speed);
    else persistDomainSpeed(speed);
    sendResponse({ success: true, speed });
    return true;
  }
  if (request.action === "reset") {
    resetScope(request.scope === "channel" || request.scope === "global" ? request.scope : "site");
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "resetToSaved") {
    resetToSaved();
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "getSpeed") {
    return replyFromVideoFrame(sendResponse, () => ({
      speed: S.currentSpeed,
      domain: getDomain(),
      channel: currentChannel(),
      channelName: currentChannelName(),
      scope: S.speedScope,
      live: onStreamPage(),
    }));
  }
  // --- Live-sync allowed delay (buffer target), per scope — mirrors speed above.
  if (request.action === "setTarget") {
    setTarget(request.target); // live preview, no persist
    return replyFromVideoFrame(sendResponse, () => ({ success: true, target: S.liveSyncTarget }));
  }
  if (request.action === "rememberTarget") {
    const target = clampTarget(request.target);
    if (request.scope === "channel") persistChannelTarget(target);
    else if (request.scope === "global") persistGlobalTarget(target);
    else persistSiteTarget(target);
    sendResponse({ success: true, target });
    return true;
  }
  if (request.action === "resetTarget") {
    resetTargetScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
    );
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "resetTargetToSaved") {
    applyResolvedTargetFromStore(); // discard the live preview, re-apply the saved delay
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "getTarget") {
    return replyFromVideoFrame(sendResponse, () => ({
      target: S.liveSyncTarget,
      scope: S.targetScope,
      channel: currentChannel(),
      channelName: currentChannelName(),
      live: onStreamPage(),
    }));
  }
  // --- Auto-slow settings bundle (enable + target), per scope — mirrors the
  // live-sync target above.
  if (request.action === "setAutoSlow") {
    setAutoSlowPreview(autoSlowFromRequest(request)); // live preview, no persist
    return replyFromVideoFrame(sendResponse, () => ({ success: true }));
  }
  if (request.action === "rememberAutoSlow") {
    const s = autoSlowFromRequest(request);
    if (request.scope === "channel") persistChannelAutoSlow(s);
    else if (request.scope === "global") persistGlobalAutoSlow(s);
    else persistSiteAutoSlow(s);
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "resetAutoSlow") {
    resetAutoSlowScope(
      request.scope === "channel" || request.scope === "global" ? request.scope : "site",
    );
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "resetAutoSlowToSaved") {
    applyResolvedAutoSlowFromStore(); // discard the live preview, re-apply the saved bundle
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "getAutoSlow") {
    return replyFromVideoFrame(sendResponse, () => ({
      enabled: S.autoSlowEnabled,
      target: S.autoSlowTarget,
      scope: S.autoSlowScope,
      channel: currentChannel(),
      channelName: currentChannelName(),
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
