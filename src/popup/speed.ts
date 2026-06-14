import { api, getActiveTab } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { msg } from "./i18n.js";
import { ctx } from "./state.js";
import { clamp } from "./core/clamp.js";
import { normalizeHost } from "./core/domain.js";
import { tweenSlider } from "./core/tween-slider.js";
import { tweenNumber } from "./core/tween-number.js";
import { movePill } from "./core/seg-pill.js";
import { byId } from "./dom.js";

// `animate` glides the thumb to the new value (preset / ± / reset); the readout
// and active preset snap to the target so they don't flicker through the glide.
// Drag echo, live-sync poll and initial load pass it false — they must not fight
// the user's finger or jitter the thumb on every tick.
function updateUI(speed: number, animate = false): void {
  const percent = Math.round(speed * 100);
  const slider = byId<HTMLInputElement>("speedSlider");
  const target = Math.min(Number(slider.max), Math.max(Number(slider.min), percent));
  const readout = byId("currentSpeedPct");

  document.querySelectorAll<HTMLElement>(".btn-speed").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.percent) === percent);
  });

  if (animate) {
    // Thumb and readout animate independently (own tweens), not driven off
    // each other — the number counts from whatever it currently shows.
    const from = parseInt(readout.textContent || "", 10) || percent;
    tweenNumber(readout, from, percent, (v) => Math.round(v) + "%");
    tweenSlider(slider, target);
  } else {
    slider.value = String(target);
    readout.textContent = percent + "%";
  }
}

function setLive(flag: boolean): void {
  // Live streams ignore manual speed — show a small warning icon by the value
  // (overlay, so it never changes the popup height) and lock the controls.
  byId("liveWarn").style.display = flag ? "inline-flex" : "none";
  document.querySelector(".speed-section")?.classList.toggle("locked", flag);
}

type Scope = "global" | "site" | "channel";

// The "Channel" scope segment shows only on a YouTube watch page (content sends
// the channel key in getSpeed; null elsewhere).
function setChannel(channel: string | null | undefined, name?: string | null): void {
  const on = !!channel;
  byId("scopeSeg").classList.toggle("has-channel", on);
  // If the channel segment vanished while it was selected, fall back to "site".
  if (!on && selectedScope() === "channel") selectScope("site");
  // The columns changed (2 ↔ 3) — re-place the pill over the active segment.
  movePill(byId("scopeSeg"));
  // Channel (de)appeared or switched — refresh the slot dots for the new key.
  if ((channel ?? null) !== savedChannelKey) {
    savedChannelKey = channel ?? null;
    refreshScopeSaved();
  }
  const label = name || channel || "";
  // Scope subtitle under the domain: the channel on a YouTube watch page, else
  // just the static "Site" label.
  byId("speedScope").textContent = on && label ? label : msg("speedScopeSite");
}

function scopeOpts(): HTMLElement[] {
  // Scoped to the speed picker — the live-sync card has its own .scope-opt buttons.
  return Array.from(document.querySelectorAll<HTMLElement>("#scopeSeg .scope-opt"));
}
function selectedScope(): Scope {
  return (scopeOpts().find((b) => b.classList.contains("active"))?.dataset.scope as Scope) || "site";
}
function selectScope(scope: Scope): void {
  scopeOpts().forEach((b) => {
    const on = b.dataset.scope === scope;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
  movePill(byId("scopeSeg"));
}
// Default the picker to "site"; only preselect "channel" when a channel speed is
// actually saved (the page's speed resolves from the channel scope).
function applyDefaultScope(scope: Scope | null | undefined, hasChannel: boolean): void {
  selectScope(hasChannel && scope === "channel" ? "channel" : "site");
}

// Per-scope "has a saved speed" dot. Global/site read straight from storage;
// channel uses the key the page reported (saves normalise to that key).
let savedChannelKey: string | null = null;
function refreshScopeSaved(): void {
  STORE.get(["domains", "globalSpeed", "channels"], (r) => {
    const domains = (r.domains || {}) as Record<string, number>;
    const channels = (r.channels || {}) as Record<string, number>;
    const has: Record<Scope, boolean> = {
      global: r.globalSpeed != null,
      site: !!ctx.currentDomain && domains[ctx.currentDomain] != null,
      channel: !!savedChannelKey && channels[savedChannelKey] != null,
    };
    scopeOpts().forEach((b) => b.classList.toggle("has-saved", has[b.dataset.scope as Scope]));
  });
}
// Flip one slot's dot without a storage round-trip — we just saved/cleared it.
function markScopeSaved(scope: Scope, on: boolean): void {
  scopeOpts().find((b) => b.dataset.scope === scope)?.classList.toggle("has-saved", on);
}

// The current speed (as a fraction) read back from the header readout — the one
// place the popup keeps it once the slider/buttons/+−/keyboard have all moved it.
function currentPctSpeed(): number {
  return clamp(parseFloat(byId("currentSpeedPct").textContent || "100") / 100);
}

function flashSaved(btn: HTMLElement): void {
  const original = btn.textContent;
  btn.textContent = msg("savedFeedback");
  btn.style.background = "#4caf50";
  setTimeout(() => { btn.textContent = original; btn.style.background = ""; }, 1500);
}

function sendSpeed(clamped: number): void {
  if (ctx.activeTabId == null) return;
  api.tabs.sendMessage(ctx.activeTabId, { action: "setSpeed", speed: clamped }, (resp) => {
    if (api.runtime.lastError) {
      // No content script on this page (e.g. chrome://, PDF, store pages).
      return;
    }
    if (resp) {
      setLive(!!resp.live);
      // Only re-sync the slider when the content script CLAMPED our speed (e.g. a
      // live stream forced it back to 1×); re-applying our own echoed value would
      // snap the thumb around.
      if (typeof resp.speed === "number" && Math.round(resp.speed * 100) !== Math.round(clamped * 100)) {
        updateUI(resp.speed);
      }
    }
  });
}

function setSpeed(speed: number): void {
  const clamped = clamp(speed);
  updateUI(clamped, true);
  sendSpeed(clamped);
}

// Clear the saved speed for the selected scope, then pull the re-resolved speed
// back into the readout. The selected scope segment stays put (the user chose it).
function resetScopeFallback(scope: Scope): void {
  if (scope === "channel") { setSpeed(1.0); return; } // no DOM keys available off the page
  if (scope === "global") { STORE.remove("globalSpeed", () => fallbackFromStorage(true)); return; }
  if (scope === "site" && ctx.currentDomain) {
    STORE.get(["domains"], (result) => {
      const domains = (result.domains || {}) as Record<string, number>;
      delete domains[ctx.currentDomain];
      STORE.set({ domains }, () => fallbackFromStorage(true));
    });
  } else {
    fallbackFromStorage(true);
  }
}

// The ⟲ button by the readout: revert a manual change to the saved speed
// (priority chain), deleting nothing. Pulls the re-resolved value back.
function resetManual(): void {
  const tabId = ctx.activeTabId;
  if (tabId == null) { fallbackFromStorage(true); return; }
  api.tabs.sendMessage(tabId, { action: "resetToSaved" }, () => {
    if (api.runtime.lastError) { fallbackFromStorage(true); return; }
    setTimeout(() => api.tabs.sendMessage(tabId, { action: "getSpeed" }, (r) => {
      if (!api.runtime.lastError && r && typeof r.speed === "number") updateUI(r.speed, true);
    }), 80);
  });
}

function resetSpeed(): void {
  const scope = selectedScope();
  markScopeSaved(scope, false); // the slot is being cleared
  const tabId = ctx.activeTabId;
  if (tabId == null) { resetScopeFallback(scope); return; }
  api.tabs.sendMessage(tabId, { action: "reset", scope }, () => {
    if (api.runtime.lastError) { resetScopeFallback(scope); return; }
    // Content cleared the scope and re-resolved; pull the new value back.
    setTimeout(() => api.tabs.sendMessage(tabId, { action: "getSpeed" }, (r) => {
      if (!api.runtime.lastError && r && typeof r.speed === "number") updateUI(r.speed, true);
    }), 80);
  });
}

// No content script (chrome:// / store pages): write the scope's speed straight
// to storage. The channel scope needs the page DOM, so it has no fallback.
function saveScopeFallback(scope: Scope, speed: number): void {
  if (scope === "global") { STORE.set({ globalSpeed: speed }); return; }
  if (scope === "site" && ctx.currentDomain) {
    STORE.get(["domains"], (result) => {
      const domains = (result.domains || {}) as Record<string, number>;
      domains[ctx.currentDomain] = speed;
      STORE.set({ domains });
    });
  }
}

function setAsDefault(): void {
  const speed = currentPctSpeed();
  const scope = selectedScope();
  if (ctx.activeTabId != null) {
    api.tabs.sendMessage(ctx.activeTabId, { action: "remember", scope, speed }, () => {
      if (api.runtime.lastError) saveScopeFallback(scope, speed);
    });
  } else {
    saveScopeFallback(scope, speed);
  }
  markScopeSaved(scope, true);
  flashSaved(byId("setDefaultBtn"));
}

// Mirror of the content resolver for the no-content-script display path:
// site > global > 100% (channel needs the page, absent here).
function fallbackFromStorage(animate = false): void {
  STORE.get(["domains", "globalSpeed"], (result) => {
    const domains = (result.domains || {}) as Record<string, number>;
    const v = domains[ctx.currentDomain] ?? (result.globalSpeed as number | undefined) ?? 1.0;
    updateUI(clamp(v), animate);
  });
}

export async function init(): Promise<void> {
  const tab = await getActiveTab();
  ctx.activeTabId = tab?.id ?? null;

  try {
    ctx.currentDomain = tab && tab.url ? normalizeHost(new URL(tab.url).hostname) : "";
  } catch (e) {
    ctx.currentDomain = "";
  }
  byId("currentDomain").textContent = ctx.currentDomain || "—";
  // Super theater only does anything on YouTube, so only there does it stay
  // usable while a live stream locks the rest of the card.
  document.querySelector(".speed-section")
    ?.classList.toggle("is-youtube", /(^|\.)youtube(-nocookie)?\.com$/.test(ctx.currentDomain));

  let resolved = false;
  if (ctx.activeTabId != null) {
    api.tabs.sendMessage(ctx.activeTabId, { action: "getSpeed" }, (resp) => {
      if (!api.runtime.lastError && resp && typeof resp.speed === "number") {
        resolved = true;
        updateUI(resp.speed);
        setLive(!!resp.live);
        setChannel(resp.channel, resp.channelName);
        applyDefaultScope(resp.scope, !!resp.channel);
        refreshScopeSaved();
      } else {
        fallbackFromStorage();
        applyDefaultScope(null, false);
        refreshScopeSaved();
      }
    });
  } else {
    fallbackFromStorage();
    refreshScopeSaved();
  }

  // Safety: if messaging never calls back, use storage.
  setTimeout(() => { if (!resolved) fallbackFromStorage(); }, 400);
}

// Dragging the slider updates the readout instantly but applies to the video only
// once you stop (debounced) or release (change) — so the thumb stays smooth and we
// don't thrash playbackRate (which glitches audio) on every step while dragging.
const speedSlider = byId<HTMLInputElement>("speedSlider");
let sliderSendTimer: ReturnType<typeof setTimeout> | undefined;
speedSlider.addEventListener("input", () => {
  const clamped = clamp(parseFloat(speedSlider.value) / 100);
  updateUI(clamped);
  clearTimeout(sliderSendTimer);
  sliderSendTimer = setTimeout(() => sendSpeed(clamped), 160);
});
speedSlider.addEventListener("change", () => {
  clearTimeout(sliderSendTimer);
  sendSpeed(clamp(parseFloat(speedSlider.value) / 100));
});
document.querySelectorAll<HTMLElement>(".btn-speed").forEach((btn) => {
  btn.addEventListener("click", () => setSpeed(Number(btn.dataset.percent) / 100));
});
byId("resetBtn").addEventListener("click", resetSpeed);
byId("setDefaultBtn").addEventListener("click", setAsDefault);

// The −/+ buttons by the readout nudge speed by 5% (the slider's step), so you
// can adjust without expanding the card.
byId("speedDown").addEventListener("click", () => setSpeed(currentPctSpeed() - 0.05));
byId("speedUp").addEventListener("click", () => setSpeed(currentPctSpeed() + 0.05));
byId("speedReset").addEventListener("click", resetManual);

// Picking a scope segment just changes where the next Reset / Remember acts.
scopeOpts().forEach((btn) => {
  btn.addEventListener("click", () => selectScope(btn.dataset.scope as Scope));
});

// Poll while the popup is open so live-sync speed changes show in the readout.
// The entry point schedules this every second; the body stays here, testable.
export function pollSpeed(): void {
  if (ctx.activeTabId == null) return;
  api.tabs.sendMessage(ctx.activeTabId, { action: "getSpeed" }, (resp) => {
    if (api.runtime.lastError || !resp) return;
    setChannel(resp.channel, resp.channelName);
    if (resp.live) {
      ctx.liveMisses = 0;
      setLive(true);
      if (typeof resp.speed === "number") updateUI(resp.speed);
    } else if (++ctx.liveMisses >= 4) {
      setLive(false);
    }
  });
}
