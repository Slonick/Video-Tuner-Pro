// Popup ⇄ content messaging. The popup messages the whole tab (all frames); only
// the frame holding the video replies, with the top frame as a deferred fallback.
import { api } from "./platform/browser.js";
import { getDomain } from "./core/domain.js";
import { currentChannel, currentChannelName } from "./channel.js";
import { clamp, clampTarget } from "./core/clamp.js";
import { S } from "./state.js";
import { collectVideos } from "./videos.js";
import { onStreamPage } from "./live/detection.js";
import { setSpeed, persistDomainSpeed, persistChannelSpeed, persistGlobalSpeed, resetScope, resetToSaved } from "./speed.js";
import { setTarget, persistSiteTarget, persistChannelTarget, persistGlobalTarget, resetTargetScope } from "./live/target.js";
import { monitorData } from "./monitor.js";
import { audioLevelHist, A_HIST_MS } from "./audio/metering.js";
import { bufferLevelHist } from "./bitrate.js";

function replyFromVideoFrame(sendResponse: (response?: unknown) => void, build: () => unknown): boolean {
  const hasVid = collectVideos().length > 0;
  const reply = () => { try { sendResponse(build()); } catch (e) {} };
  if (hasVid) { reply(); return true; }
  if (window.top === window) { setTimeout(reply, 60); return true; }
  return false; // subframe without a video stays silent
}

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setSpeed") {
    // Every frame applies it; only the video frame answers.
    setSpeed(request.speed, false, true);
    return replyFromVideoFrame(sendResponse,
      () => ({ success: true, speed: S.currentSpeed, live: onStreamPage() }));
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
    return replyFromVideoFrame(sendResponse,
      () => ({ speed: S.currentSpeed, domain: getDomain(), channel: currentChannel(), channelName: currentChannelName(), scope: S.speedScope, live: onStreamPage() }));
  }
  // --- Live-sync allowed delay (buffer target), per scope — mirrors speed above.
  if (request.action === "setTarget") {
    setTarget(request.target);   // live preview, no persist
    return replyFromVideoFrame(sendResponse,
      () => ({ success: true, target: S.liveSyncTarget }));
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
    resetTargetScope(request.scope === "channel" || request.scope === "global" ? request.scope : "site");
    sendResponse({ success: true });
    return true;
  }
  if (request.action === "getTarget") {
    return replyFromVideoFrame(sendResponse,
      () => ({ target: S.liveSyncTarget, scope: S.targetScope, channel: currentChannel(), channelName: currentChannelName(), live: onStreamPage() }));
  }
  if (request.action === "getMonitor") {
    return replyFromVideoFrame(sendResponse, () => monitorData());
  }
  if (request.action === "getHistory") {
    const nowT = Date.now();
    return replyFromVideoFrame(sendResponse, () => ({
      audio: audioLevelHist.map((p) => [Math.round(p.in * 10) / 10, Math.round(p.out * 10) / 10]),
      audioStep: A_HIST_MS,
      buffer: bufferLevelHist.map((p) => [nowT - p.at, Math.round(p.v * 100) / 100]),
    }));
  }
  return false;
});
