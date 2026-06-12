import { api, getActiveTab } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { msg } from "./i18n.js";
import { ctx } from "./state.js";
import { clamp } from "./core/clamp.js";
import { normalizeHost } from "./core/domain.js";
import { byId } from "./dom.js";

function updateUI(speed: number): void {
  const percent = Math.round(speed * 100);
  byId("speedValue").textContent = percent + "%";
  byId("currentSpeedPct").textContent = percent + "%";

  const slider = byId<HTMLInputElement>("speedSlider");
  slider.value = String(Math.min(Number(slider.max), Math.max(Number(slider.min), percent)));

  document.querySelectorAll<HTMLElement>(".btn-speed").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.percent) === percent);
  });
}

function setLive(flag: boolean): void {
  // Live streams ignore manual speed — show a small warning icon by the value
  // (overlay, so it never changes the popup height) and lock the controls.
  byId("liveWarn").style.display = flag ? "inline-flex" : "none";
  document.querySelector(".speed-section")?.classList.toggle("locked", flag);
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
  updateUI(clamped);
  sendSpeed(clamped);
}

function resetSpeed(): void {
  setSpeed(1.0);
}

function saveDomainSpeed(speed: number): void {
  if (!ctx.currentDomain) return;
  STORE.get(["domains"], (result) => {
    const domains = (result.domains || {}) as Record<string, number>;
    domains[ctx.currentDomain] = speed;
    STORE.set({ domains });
  });
}

function setAsDefault(): void {
  const speed = clamp(parseFloat(byId("speedValue").textContent || "100") / 100);
  if (ctx.activeTabId != null) {
    api.tabs.sendMessage(ctx.activeTabId, { action: "rememberSite", speed }, () => {
      if (api.runtime.lastError) saveDomainSpeed(speed);
    });
  } else {
    saveDomainSpeed(speed);
  }
  const btn = byId("setDefaultBtn");
  const original = btn.textContent;
  btn.textContent = msg("savedFeedback");
  btn.style.background = "#4caf50";
  setTimeout(() => { btn.textContent = original; btn.style.background = ""; }, 1500);
}

function fallbackFromStorage(): void {
  STORE.get(["domains"], (result) => {
    const domains = (result.domains || {}) as Record<string, number>;
    updateUI(clamp(domains[ctx.currentDomain] || 1.0));
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

  let resolved = false;
  if (ctx.activeTabId != null) {
    api.tabs.sendMessage(ctx.activeTabId, { action: "getSpeed" }, (resp) => {
      if (!api.runtime.lastError && resp && typeof resp.speed === "number") {
        resolved = true;
        updateUI(resp.speed);
        setLive(!!resp.live);
      } else {
        fallbackFromStorage();
      }
    });
  } else {
    fallbackFromStorage();
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

// Poll while the popup is open so live-sync speed changes show in the readout.
setInterval(() => {
  if (ctx.activeTabId == null) return;
  api.tabs.sendMessage(ctx.activeTabId, { action: "getSpeed" }, (resp) => {
    if (api.runtime.lastError || !resp) return;
    if (resp.live) {
      ctx.liveMisses = 0;
      setLive(true);
      if (typeof resp.speed === "number") updateUI(resp.speed);
    } else if (++ctx.liveMisses >= 4) {
      setLive(false);
    }
  });
}, 1000);
