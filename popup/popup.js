// Video Tuner Pro — popup (Chrome + Firefox)
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

// --- Audio compression settings (global, persisted in storage) ---
// The compressor exposes the raw DynamicsCompressor params directly. These keys
// are exactly what the content script reads and applies.
function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

// FrankerFaceZ-style defaults, used for the initial state and the Reset button.
const AUDIO_DEFAULTS = {
  audioCompThreshold: -50,
  audioCompKnee: 40,
  audioCompRatio: 12,
  audioCompAttack: 0,
  audioCompRelease: 0.25,
  audioCompGain: 0,
};

function reflectAudioUI(s) {
  document.getElementById("audioCompToggle").checked = s.enabled;
  document.getElementById("acThreshold").value = s.threshold;
  document.getElementById("acKnee").value = s.knee;
  document.getElementById("acRatio").value = s.ratio;
  document.getElementById("acAttack").value = s.attack;
  document.getElementById("acRelease").value = s.release;
  document.getElementById("acGain").value = s.gain;
}

function loadAudioSettings() {
  STORE.get(
    ["audioComp", "audioCompGain", "audioCompThreshold", "audioCompKnee",
     "audioCompRatio", "audioCompAttack", "audioCompRelease"],
    (r) => {
      reflectAudioUI({
        enabled: !!r.audioComp,
        gain: clampNum(r.audioCompGain, 0, 24, 0),
        threshold: clampNum(r.audioCompThreshold, -100, 0, -50),
        knee: clampNum(r.audioCompKnee, 0, 40, 40),
        ratio: clampNum(r.audioCompRatio, 1, 20, 12),
        attack: clampNum(r.audioCompAttack, 0, 1, 0),
        release: clampNum(r.audioCompRelease, 0, 1, 0.25),
      });
    }
  );
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

// Audio writes are partial (one key here, several there). Merge them into one
// pending object so a later write can't clobber an earlier different-key write.
let pendingAudio = {};
let audioSaveTimer = null;
function saveAudio(obj) {
  Object.assign(pendingAudio, obj);
  clearTimeout(audioSaveTimer);
  audioSaveTimer = setTimeout(() => {
    STORE.set(pendingAudio);
    pendingAudio = {};
  }, 350);
}

// --- Event wiring ---
document.getElementById("speedSlider").addEventListener("input", (e) => {
  setSpeed(parseFloat(e.target.value) / 100);
});
document.querySelectorAll(".btn-speed").forEach((btn) => {
  btn.addEventListener("click", () => setSpeed(Number(btn.dataset.percent) / 100));
});
document.getElementById("resetBtn").addEventListener("click", resetSpeed);
document.getElementById("setDefaultBtn").addEventListener("click", setAsDefault);

// Section headers expand/collapse their body (independent of the on/off switch).
document.querySelectorAll(".sec-main").forEach((btn) => {
  btn.addEventListener("click", () => {
    const body = document.getElementById(btn.dataset.target);
    const open = body.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
});

// The first time a section is switched on, auto-expand it so the user sees its
// settings. Tracked by a persistent flag so it only happens once, ever.
function autoExpandOnFirstEnable(enabled, bodyId, seenKey) {
  if (!enabled) return;
  STORE.get([seenKey], (r) => {
    if (r[seenKey]) return;
    const body = document.getElementById(bodyId);
    body.classList.add("open");
    const btn = document.querySelector('.sec-main[data-target="' + bodyId + '"]');
    if (btn) btn.setAttribute("aria-expanded", "true");
    STORE.set({ [seenKey]: true });
  });
}

document.getElementById("liveSyncToggle").addEventListener("change", (e) => {
  STORE.set({ liveSync: e.target.checked });
  autoExpandOnFirstEnable(e.target.checked, "syncBody", "liveSyncSeen");
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

document.getElementById("audioCompToggle").addEventListener("change", (e) => {
  STORE.set({ audioComp: e.target.checked });
  autoExpandOnFirstEnable(e.target.checked, "audioBody", "audioSeen");
});

// Show speed + remaining time on the video.
document.getElementById("onVideoToggle").addEventListener("change", (e) => {
  STORE.set({ showRemaining: e.target.checked });
});

// Each compressor param input writes its own storage key directly.
const ADV = [
  ["acThreshold", "audioCompThreshold", -100, 0, -50],
  ["acKnee", "audioCompKnee", 0, 40, 40],
  ["acRatio", "audioCompRatio", 1, 20, 12],
  ["acAttack", "audioCompAttack", 0, 1, 0],
  ["acRelease", "audioCompRelease", 0, 1, 0.25],
  ["acGain", "audioCompGain", 0, 24, 0],
];
ADV.forEach(([id, key, lo, hi, def]) => {
  document.getElementById(id).addEventListener("input", (e) => {
    saveAudio({ [key]: clampNum(e.target.value, lo, hi, def) });
  });
});

// Reset all compressor parameters to the FrankerFaceZ-style defaults.
document.getElementById("audioReset").addEventListener("click", () => {
  reflectAudioUI({
    enabled: document.getElementById("audioCompToggle").checked,
    threshold: AUDIO_DEFAULTS.audioCompThreshold,
    knee: AUDIO_DEFAULTS.audioCompKnee,
    ratio: AUDIO_DEFAULTS.audioCompRatio,
    attack: AUDIO_DEFAULTS.audioCompAttack,
    release: AUDIO_DEFAULTS.audioCompRelease,
    gain: AUDIO_DEFAULTS.audioCompGain,
  });
  saveAudio(Object.assign({}, AUDIO_DEFAULTS));
});

localize();
init();
loadSyncSettings();
loadAudioSettings();
STORE.get(["showRemaining"], (r) => { document.getElementById("onVideoToggle").checked = !!r.showRemaining; });

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

// --- Live graphs ---
// Audio: before/after level bars with peak-hold (held ~3s, then released).
// Buffer: a scrolling time graph of seconds buffered ahead, with the target line.
// Polled ~13×/s; rendered with requestAnimationFrame (~60fps) for smooth motion.
(function setupGraphs() {
  const aCanvas = document.getElementById("audioMeter");
  const bCanvas = document.getElementById("bufferMeter");
  if ((!aCanvas || !aCanvas.getContext) && (!bCanvas || !bCanvas.getContext)) return;
  const acx = aCanvas && aCanvas.getContext("2d");
  const bcx = bCanvas && bCanvas.getContext("2d");
  const A_MIN = -60, A_MAX = 0;          // audio dB range
  const PEAK_HOLD = 3000;                // ms to hold an audio peak before release
  const BUF_WINDOW = 30000;              // buffer graph time window (ms)

  function col(name, fb) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
  }
  function now() { return performance.now(); }
  function fitCanvas(canvas, cx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 290, h = canvas.clientHeight || 50;
    if (canvas._w !== w || canvas._h !== h) {
      canvas._w = w; canvas._h = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { w, h };
  }
  function roundBar(cx, x, y, w, h) {
    if (w <= 0) return;
    const r = Math.min(3, h / 2);
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r);
    cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r);
    cx.arcTo(x, y, x + w, y, r);
    cx.closePath();
    cx.fill();
  }

  const cur = { in: A_MIN, out: A_MIN };           // eased displayed levels
  const tgt = { in: A_MIN, out: A_MIN };           // latest polled levels
  const peak = { in: A_MIN, inAt: 0, out: A_MIN, outAt: 0 };
  let audioActive = false;
  const bufHist = [];                              // {t, v} smoothed buffer history
  let bufSmooth = null;                            // EMA state for buffer samples
  let bufLive = false;                             // only graph the buffer on live streams
  let bufBitrate = null;                           // latest download bitrate (bits/s) or null
  let bufBitrateShown = null;                      // value actually drawn (refreshed ~1×/s)
  let bufBitrateAt = 0;                            // when bufBitrateShown was last refreshed
  let yMax = 8;                                    // buffer graph eased Y scale

  function fmtBitrate(bps) {
    if (bps == null || !isFinite(bps) || bps <= 0) return null;
    return bps >= 1e6 ? (bps / 1e6).toFixed(1) + " Mbps" : Math.round(bps / 1e3) + " kbps";
  }

  // Smooth polyline through points using midpoint quadratic curves (rounds corners).
  function smoothLine(cx, pts) {
    if (!pts.length) return;
    cx.moveTo(pts[0].x, pts[0].y);
    if (pts.length < 3) { for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      cx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const n = pts.length - 1;
    cx.quadraticCurveTo(pts[n].x, pts[n].y, pts[n].x, pts[n].y);
  }

  function drawAudio() {
    const { w, h } = fitCanvas(aCanvas, acx);
    if (!w) return;
    const muted = col("--muted", "#888"), accent = col("--accent", "#0a84ff"), text = col("--text", "#111");
    const xFor = (db) => (Math.max(A_MIN, Math.min(A_MAX, db)) - A_MIN) / (A_MAX - A_MIN) * w;
    const barH = 12, gap = 5, y1 = 5, y2 = y1 + barH + gap;
    acx.clearRect(0, 0, w, h);
    acx.strokeStyle = "rgba(127,127,127,0.16)"; acx.lineWidth = 1;
    acx.fillStyle = muted; acx.font = "9px -apple-system, sans-serif"; acx.textAlign = "center";
    for (let db = A_MIN; db <= A_MAX; db += 12) {
      const x = Math.round(xFor(db)) + 0.5;
      acx.beginPath(); acx.moveTo(x, 2); acx.lineTo(x, y2 + barH + 2); acx.stroke();
      if (db > A_MIN && db < A_MAX) acx.fillText(String(db), x, h - 1);
    }
    acx.fillStyle = "rgba(127,127,127,0.18)";
    roundBar(acx, 0, y1, w, barH); roundBar(acx, 0, y2, w, barH);
    if (audioActive) {
      acx.fillStyle = muted; roundBar(acx, 0, y1, xFor(cur.in), barH);
      acx.fillStyle = accent; roundBar(acx, 0, y2, xFor(cur.out), barH);
      // peak-hold ticks
      acx.fillStyle = text;
      if (peak.in > A_MIN) acx.fillRect(Math.round(xFor(peak.in)) - 1, y1 - 1, 2, barH + 2);
      if (peak.out > A_MIN) acx.fillRect(Math.round(xFor(peak.out)) - 1, y2 - 1, 2, barH + 2);
    }
    const thr = Number(document.getElementById("acThreshold").value);
    if (!Number.isNaN(thr)) {
      const x = Math.round(xFor(thr)) + 0.5;
      acx.strokeStyle = "#ff9f0a"; acx.lineWidth = 2;
      acx.beginPath(); acx.moveTo(x, 2); acx.lineTo(x, y2 + barH + 2); acx.stroke();
    }
  }

  function drawBuffer() {
    const { w, h } = fitCanvas(bCanvas, bcx);
    if (!w) return;
    // Not a live stream → nothing to graph; show a short hint instead.
    if (!bufLive) {
      bcx.clearRect(0, 0, w, h);
      bcx.fillStyle = col("--muted", "#888"); bcx.globalAlpha = 0.7;
      bcx.font = "11px -apple-system, sans-serif"; bcx.textAlign = "center"; bcx.textBaseline = "middle";
      bcx.fillText(msg("bufferLiveOnly") || "Live streams only", w / 2, h / 2);
      bcx.globalAlpha = 1; bcx.textBaseline = "alphabetic";
      return;
    }
    const t = now();
    const target = Number(document.getElementById("syncTarget").value);
    const padT = 5, padB = 11, gh = h - padT - padB;
    // dynamic Y scale that fits target + recent history
    let mx = (Number.isNaN(target) ? 6 : target + 1);
    for (const p of bufHist) if (t - p.t <= BUF_WINDOW && p.v > mx) mx = p.v;
    yMax += (Math.max(6, mx * 1.15) - yMax) * 0.08;
    const yFor = (v) => padT + gh * (1 - Math.min(Math.max(v, 0), yMax) / yMax);
    const xFor = (ts) => w * (1 - (t - ts) / BUF_WINDOW);

    bcx.clearRect(0, 0, w, h);
    // horizontal gridlines + second labels
    bcx.strokeStyle = "rgba(127,127,127,0.16)"; bcx.lineWidth = 1;
    bcx.fillStyle = col("--muted", "#888"); bcx.font = "9px -apple-system, sans-serif"; bcx.textAlign = "left";
    const step = yMax <= 8 ? 2 : (yMax <= 16 ? 5 : 10);
    for (let v = step; v < yMax; v += step) {
      const y = Math.round(yFor(v)) + 0.5;
      bcx.beginPath(); bcx.moveTo(0, y); bcx.lineTo(w, y); bcx.stroke();
      bcx.fillText(v + "s", 3, y - 2);
    }
    // buffer area + smoothed line
    if (bufHist.length) {
      const pts = bufHist.map((p) => ({ x: xFor(p.t), y: yFor(p.v) }));
      const baseY = padT + gh;
      bcx.beginPath();
      smoothLine(bcx, pts);
      bcx.lineTo(pts[pts.length - 1].x, baseY); bcx.lineTo(pts[0].x, baseY); bcx.closePath();
      bcx.fillStyle = "rgba(48,192,160,0.16)"; bcx.fill();
      bcx.beginPath(); smoothLine(bcx, pts);
      bcx.strokeStyle = "#30c0a0"; bcx.lineWidth = 2; bcx.lineJoin = "round"; bcx.lineCap = "round"; bcx.stroke();
    }
    // target line
    if (!Number.isNaN(target)) {
      const y = Math.round(yFor(target)) + 0.5;
      bcx.strokeStyle = "#ff9f0a"; bcx.lineWidth = 1.5; bcx.setLineDash([4, 3]);
      bcx.beginPath(); bcx.moveTo(0, y); bcx.lineTo(w, y); bcx.stroke();
      bcx.setLineDash([]);
      bcx.fillStyle = "#ff9f0a"; bcx.textAlign = "right";
      bcx.fillText(target + "s", w - 3, y - 2);
    }
    // current value, centered — drawn with a background-colored halo so it stays
    // readable over the line, grid and target dash.
    if (bufHist.length) {
      const v = bufHist[bufHist.length - 1].v;
      const label = (v < 10 ? v.toFixed(1) : Math.round(v)) + "s";
      bcx.font = "700 17px -apple-system, sans-serif";
      bcx.textAlign = "center"; bcx.textBaseline = "middle";
      bcx.lineWidth = 4; bcx.lineJoin = "round";
      bcx.strokeStyle = col("--seg", "#eee");
      bcx.strokeText(label, w / 2, h / 2);
      bcx.fillStyle = col("--text", "#222");
      bcx.fillText(label, w / 2, h / 2);
      bcx.textBaseline = "alphabetic";
    }
    // download bitrate, as plain text in the bottom-left corner
    const br = fmtBitrate(bufBitrateShown);
    if (br) {
      bcx.font = "10px -apple-system, sans-serif";
      bcx.textAlign = "left"; bcx.textBaseline = "alphabetic";
      bcx.fillStyle = col("--muted", "#888");
      bcx.fillText("≈ " + br, 3, h - 2);
    }
  }

  function frame() {
    const t = now();
    cur.in += (tgt.in - cur.in) * 0.3;
    cur.out += (tgt.out - cur.out) * 0.3;
    // peak hold: keep the max; after PEAK_HOLD decay toward the current level.
    if (cur.in > peak.in) { peak.in = cur.in; peak.inAt = t; }
    else if (t - peak.inAt > PEAK_HOLD) peak.in += (cur.in - peak.in) * 0.06;
    if (cur.out > peak.out) { peak.out = cur.out; peak.outAt = t; }
    else if (t - peak.outAt > PEAK_HOLD) peak.out += (cur.out - peak.out) * 0.06;

    if (acx) drawAudio();
    if (bcx) drawBuffer();
    requestAnimationFrame(frame); // graphs are always visible while the popup is open
  }

  // Poll the page for data ~13×/s; the rAF loop above interpolates between samples.
  setInterval(() => {
    if (activeTabId == null) return;
    api.tabs.sendMessage(activeTabId, { action: "getMonitor" }, (resp) => {
      if (api.runtime.lastError || !resp) { audioActive = false; return; }
      const a = resp.audio || {};
      audioActive = !!a.active;
      if (audioActive) {
        tgt.in = a.in; tgt.out = a.out;
        const t = now(); // capture raw peaks too (eased cur can miss fast transients)
        if (a.in > peak.in) { peak.in = a.in; peak.inAt = t; }
        if (a.out > peak.out) { peak.out = a.out; peak.outAt = t; }
      }
      bufLive = !!resp.live;
      if (bufLive && typeof resp.buffer === "number") {
        const t = now();
        // Smooth the raw buffer reading (it sawtooths per segment) before plotting.
        bufSmooth = bufSmooth == null ? resp.buffer : bufSmooth + (resp.buffer - bufSmooth) * 0.18;
        bufHist.push({ t, v: bufSmooth });
        while (bufHist.length && t - bufHist[0].t > BUF_WINDOW + 1000) bufHist.shift();
        bufBitrate = typeof resp.bitrate === "number" ? resp.bitrate : null;
        // Refresh the displayed value at most once a second so the digits sit still.
        if (bufBitrateShown == null || t - bufBitrateAt > 1000) {
          bufBitrateShown = bufBitrate; bufBitrateAt = t;
        }
      } else {
        // Not a live stream — the buffer graph is meaningless, so keep it empty.
        bufHist.length = 0; bufSmooth = null;
        bufBitrate = bufBitrateShown = null;
      }
    });
  }, 75);

  requestAnimationFrame(frame);
})();
