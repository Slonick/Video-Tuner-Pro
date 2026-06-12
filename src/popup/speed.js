// Speed controls: the readout, slider, preset buttons, Reset, Remember-site, and
// the periodic poll that keeps the readout in sync with live-sync on the page.
import { api, STORE, msg, ctx, clamp, getActiveTab } from "./env.js";

function updateUI(speed) {
  const percent = Math.round(speed * 100);
  document.getElementById("speedValue").textContent = percent + "%";
  document.getElementById("currentSpeedPct").textContent = percent + "%";

  const slider = document.getElementById("speedSlider");
  slider.value = Math.min(Number(slider.max), Math.max(Number(slider.min), percent));

  document.querySelectorAll(".btn-speed").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.percent) === percent);
  });
}

function setLive(flag) {
  // Live streams ignore manual speed — show a small warning icon by the value
  // (overlay, so it never changes the popup height) and lock the controls.
  document.getElementById("liveWarn").style.display = flag ? "inline-flex" : "none";
  document.querySelector(".speed-section").classList.toggle("locked", flag);
}

// Send the speed to the content script (it persists per-domain) and reflect in UI.
// Push a speed to the content script (it applies + persists per-domain).
function sendSpeed(clamped) {
  if (ctx.activeTabId == null) return;
  api.tabs.sendMessage(ctx.activeTabId, { action: "setSpeed", speed: clamped }, (resp) => {
    if (api.runtime.lastError) {
      // No content script on this page (e.g. chrome://, PDF, store pages).
      return;
    }
    if (resp) {
      setLive(!!resp.live);
      // Only re-sync the slider from the reply when the content script actually
      // CLAMPED our speed (e.g. a live stream forced it back to 1×) — re-applying
      // our own echoed value would snap the thumb around.
      if (typeof resp.speed === "number" && Math.round(resp.speed * 100) !== Math.round(clamped * 100)) {
        updateUI(resp.speed);
      }
    }
  });
}

// Immediate apply (preset buttons, Reset).
function setSpeed(speed) {
  const clamped = clamp(speed);
  updateUI(clamped);
  sendSpeed(clamped);
}

function resetSpeed() {
  setSpeed(1.0);
}

function saveDomainSpeed(speed) {
  if (!ctx.currentDomain) return;
  STORE.get(["domains"], (result) => {
    const domains = result.domains || {};
    domains[ctx.currentDomain] = speed;
    STORE.set({ domains });
  });
}

// Remember the current speed for THIS site only. Other sites stay at 100%.
function setAsDefault() {
  const speed = clamp(parseFloat(document.getElementById("speedValue").textContent) / 100);
  if (ctx.activeTabId != null) {
    api.tabs.sendMessage(ctx.activeTabId, { action: "rememberSite", speed }, () => {
      if (api.runtime.lastError) saveDomainSpeed(speed);
    });
  } else {
    saveDomainSpeed(speed);
  }
  const btn = document.getElementById("setDefaultBtn");
  const original = btn.textContent;
  btn.textContent = msg("savedFeedback");
  btn.style.background = "#4caf50";
  setTimeout(() => { btn.textContent = original; btn.style.background = ""; }, 1500);
}

function fallbackFromStorage() {
  STORE.get(["domains"], (result) => {
    const domains = result.domains || {};
    updateUI(clamp(domains[ctx.currentDomain] || 1.0));
  });
}

export async function init() {
  const tab = await getActiveTab();
  ctx.activeTabId = tab ? tab.id : null;

  try {
    ctx.currentDomain = tab && tab.url ? new URL(tab.url).hostname : "";
  } catch (e) {
    ctx.currentDomain = "";
  }
  document.getElementById("currentDomain").textContent = ctx.currentDomain || "—";

  // Ask the content script for the live speed; fall back to stored value.
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

// --- Event wiring ---
// Dragging the slider updates the readout instantly but applies to the video only
// once you stop (debounced) or release (change) — so the thumb stays smooth and we
// don't thrash playbackRate (which glitches audio) on every step while dragging.
const speedSlider = document.getElementById("speedSlider");
let sliderSendTimer = null;
speedSlider.addEventListener("input", (e) => {
  const clamped = clamp(parseFloat(e.target.value) / 100);
  updateUI(clamped);                                           // instant, local
  clearTimeout(sliderSendTimer);
  sliderSendTimer = setTimeout(() => sendSpeed(clamped), 160); // apply after you pause
});
speedSlider.addEventListener("change", (e) => {               // released — apply the final value now
  clearTimeout(sliderSendTimer);
  sendSpeed(clamp(parseFloat(e.target.value) / 100));
});
document.querySelectorAll(".btn-speed").forEach((btn) => {
  btn.addEventListener("click", () => setSpeed(Number(btn.dataset.percent) / 100));
});
document.getElementById("resetBtn").addEventListener("click", resetSpeed);
document.getElementById("setDefaultBtn").addEventListener("click", setAsDefault);

// While the popup is open, refresh the readout so live-sync speed is visible.
setInterval(() => {
  if (ctx.activeTabId == null) return;
  api.tabs.sendMessage(ctx.activeTabId, { action: "getSpeed" }, (resp) => {
    if (api.runtime.lastError || !resp) return;
    if (resp.live) {
      ctx.liveMisses = 0;
      setLive(true);
      // Live-sync changes the speed on its own — keep the readout in sync.
      if (typeof resp.speed === "number") updateUI(resp.speed);
    } else if (++ctx.liveMisses >= 4) {
      setLive(false);
    }
  });
}, 1000);
