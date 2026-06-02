// Video Speed Controller Pro — popup (Chrome + Firefox)
const api = (typeof browser !== "undefined") ? browser : chrome;

// Settings sync across devices (Chrome Sync / Firefox Sync); falls back to local.
const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;

const msg = (key, subs) => api.i18n.getMessage(key, subs);

// Replace text of every [data-i18n] element with its localized string.
function localize() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const text = msg(el.dataset.i18n);
    if (text) el.textContent = text;
  });
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

let activeTabId = null;
let currentDomain = "";
let liveMisses = 0; // debounce: only drop the "live" UI after several misses

function clamp(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

function getActiveTab() {
  return new Promise((resolve) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function updateUI(speed) {
  const percent = Math.round(speed * 100);
  document.getElementById("speedValue").textContent = percent + "%";
  document.getElementById("speedSub").textContent = speed.toFixed(2) + msg("speedSuffix");
  document.getElementById("currentSpeedPct").textContent = percent + "%";

  const slider = document.getElementById("speedSlider");
  slider.value = Math.min(Number(slider.max), Math.max(Number(slider.min), percent));

  document.querySelectorAll(".btn-speed").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.percent) === percent);
  });
}

function setLive(flag) {
  document.getElementById("liveNote").style.display = flag ? "block" : "none";
  // On a live stream the manual speed controls don't apply — lock them.
  document.querySelector(".speed-section").classList.toggle("locked", flag);
}

// Send the speed to the content script (it persists per-domain) and reflect in UI.
function setSpeed(speed) {
  const clamped = clamp(speed);
  updateUI(clamped);
  if (activeTabId == null) return;
  api.tabs.sendMessage(activeTabId, { action: "setSpeed", speed: clamped }, (resp) => {
    if (api.runtime.lastError) {
      // No content script on this page (e.g. chrome://, PDF, store pages).
      document.getElementById("noVideo").style.display = "block";
      return;
    }
    if (resp) {
      setLive(!!resp.live);
      // On a live stream the content script may clamp our speed back to 1x.
      if (typeof resp.speed === "number") updateUI(resp.speed);
    }
  });
}

function resetSpeed() {
  setSpeed(1.0);
}

// --- Live-sync settings (global, persisted in storage) ---
function clampTarget(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 3;
  return Math.min(15, Math.max(0, Math.round(n)));
}

function clampMaxPercent(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 150;
  return Math.min(300, Math.max(125, Math.round(n / 5) * 5));
}

function reflectSyncUI(enabled, target, maxPercent) {
  document.getElementById("liveSyncToggle").checked = enabled;
  document.getElementById("syncBody").classList.toggle("enabled", enabled);
  document.getElementById("syncTarget").value = target;
  document.getElementById("syncTargetVal").textContent = target;
  document.getElementById("syncMax").value = maxPercent;
  document.getElementById("syncMaxVal").textContent = maxPercent;
}

function loadSyncSettings() {
  STORE.get(["liveSync", "liveSyncTarget", "liveSyncMax"], (result) => {
    reflectSyncUI(
      !!result.liveSync,
      clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 3),
      clampMaxPercent((result.liveSyncMax != null ? result.liveSyncMax : 1.5) * 100)
    );
  });
}

function saveDomainSpeed(speed) {
  if (!currentDomain) return;
  STORE.get(["domains"], (result) => {
    const domains = result.domains || {};
    domains[currentDomain] = speed;
    STORE.set({ domains });
  });
}

// Remember the current speed for THIS site only. Other sites stay at 100%.
function setAsDefault() {
  const speed = clamp(parseFloat(document.getElementById("speedValue").textContent) / 100);
  if (activeTabId != null) {
    api.tabs.sendMessage(activeTabId, { action: "rememberSite", speed }, () => {
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

async function init() {
  const tab = await getActiveTab();
  activeTabId = tab ? tab.id : null;

  try {
    currentDomain = tab && tab.url ? new URL(tab.url).hostname : "";
  } catch (e) {
    currentDomain = "";
  }
  document.getElementById("currentDomain").textContent = currentDomain || "—";

  // Ask the content script for the live speed; fall back to stored value.
  let resolved = false;
  if (activeTabId != null) {
    api.tabs.sendMessage(activeTabId, { action: "getSpeed" }, (resp) => {
      if (!api.runtime.lastError && resp && typeof resp.speed === "number") {
        resolved = true;
        updateUI(resp.speed);
        setLive(!!resp.live);
      } else {
        document.getElementById("noVideo").style.display = "block";
        fallbackFromStorage();
      }
    });
  } else {
    fallbackFromStorage();
  }

  // Safety: if messaging never calls back, use storage.
  setTimeout(() => { if (!resolved) fallbackFromStorage(); }, 400);
}

function fallbackFromStorage() {
  STORE.get(["domains"], (result) => {
    const domains = result.domains || {};
    updateUI(clamp(domains[currentDomain] || 1.0));
  });
}

// Debounce writes — storage.sync rate-limits how often you may write, and the
// range sliders fire many "input" events while dragging.
function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
const saveSyncTarget = debounce((v) => STORE.set({ liveSyncTarget: v }), 350);
const saveSyncMax = debounce((v) => STORE.set({ liveSyncMax: v }), 350);

// --- Event wiring ---
document.getElementById("speedSlider").addEventListener("input", (e) => {
  setSpeed(parseFloat(e.target.value) / 100);
});
document.querySelectorAll(".btn-speed").forEach((btn) => {
  btn.addEventListener("click", () => setSpeed(Number(btn.dataset.percent) / 100));
});
document.getElementById("resetBtn").addEventListener("click", resetSpeed);
document.getElementById("setDefaultBtn").addEventListener("click", setAsDefault);

document.getElementById("liveSyncToggle").addEventListener("change", (e) => {
  const enabled = e.target.checked;
  document.getElementById("syncBody").classList.toggle("enabled", enabled);
  STORE.set({ liveSync: enabled });
});
document.getElementById("syncTarget").addEventListener("input", (e) => {
  const target = clampTarget(e.target.value);
  document.getElementById("syncTargetVal").textContent = target;
  saveSyncTarget(target);
});
document.getElementById("syncMax").addEventListener("input", (e) => {
  const percent = clampMaxPercent(e.target.value);
  document.getElementById("syncMaxVal").textContent = percent;
  saveSyncMax(percent / 100);
});

localize();
init();
loadSyncSettings();

// While the popup is open, refresh the readout so live-sync speed is visible.
setInterval(() => {
  if (activeTabId == null) return;
  api.tabs.sendMessage(activeTabId, { action: "getSpeed" }, (resp) => {
    if (api.runtime.lastError || !resp) return;
    if (resp.live) {
      liveMisses = 0;
      setLive(true);
      // Live-sync changes the speed on its own — keep the readout in sync.
      if (typeof resp.speed === "number") updateUI(resp.speed);
    } else if (++liveMisses >= 4) {
      setLive(false);
    }
  });
}, 1000);
