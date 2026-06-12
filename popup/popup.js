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

// Default compressor settings, used for the initial state and the Reset button.
const AUDIO_DEFAULTS = {
  audioCompThreshold: -60,
  audioCompKnee: 30,
  audioCompRatio: 10,
  audioCompAttack: 0,
  audioCompRelease: 1,
  audioCompGain: 0,
};

// Format a compressor param for its slider readout.
function fmtParam(key, v) {
  v = Number(v);
  switch (key) {
    case "audioCompRatio": return v + ":1";
    case "audioCompAttack":
    case "audioCompRelease": return Math.round(v * 1000) + " ms";
    default: return v + " dB"; // threshold, knee, gain
  }
}

function setParam(id, key, value) {
  document.getElementById(id).value = value;
  const out = document.getElementById(id + "Val");
  if (out) out.textContent = fmtParam(key, value);
}

function reflectAudioUI(s) {
  document.getElementById("audioCompToggle").checked = s.enabled;
  setParam("acThreshold", "audioCompThreshold", s.threshold);
  setParam("acKnee", "audioCompKnee", s.knee);
  setParam("acRatio", "audioCompRatio", s.ratio);
  setParam("acAttack", "audioCompAttack", s.attack);
  setParam("acRelease", "audioCompRelease", s.release);
  setParam("acGain", "audioCompGain", s.gain);
}

function loadAudioSettings() {
  STORE.get(
    ["audioComp", "audioCompGain", "audioCompThreshold", "audioCompKnee",
     "audioCompRatio", "audioCompAttack", "audioCompRelease"],
    (r) => {
      reflectAudioUI({
        enabled: !!r.audioComp,
        gain: clampNum(r.audioCompGain, 0, 24, 0),
        threshold: clampNum(r.audioCompThreshold, -100, 0, -60),
        knee: clampNum(r.audioCompKnee, 0, 40, 30),
        ratio: clampNum(r.audioCompRatio, 1, 20, 10),
        attack: clampNum(r.audioCompAttack, 0, 1, 0),
        release: clampNum(r.audioCompRelease, 0, 1, 1),
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
// Smoothly bring an expanding section's body fully into view, in sync with the
// CSS max-height transition. We aim at a FIXED target — where the body's bottom
// will sit once expanded (el.scrollHeight gives the full content height even
// while it's still collapsed) — and ease there with easeOutCubic over DUR, so it
// lands exactly flush at the end (no residual) instead of asymptotically.
function revealOnExpand(el) {
  const root = document.scrollingElement || document.documentElement;
  const sec = el.closest(".sync-section") || el;
  const DUR = 480, MARGIN = 12, vh = window.innerHeight;
  let start = null;
  function step(now) {
    if (start === null) start = now;
    const last = now - start >= DUR;
    // Live target: keep the SECTION's bottom (which includes the bottom chevron)
    // just inside the fold. Reading it each frame self-corrects for the growing
    // body + margin/padding, so it lands exactly — on the last frame, close the
    // full remaining gap so it never stops short.
    const below = sec.getBoundingClientRect().bottom - vh + MARGIN;
    const room = (root.scrollHeight - vh) - root.scrollTop;
    if (below > 0 && room > 0) root.scrollTop += Math.min(below, room) * (last ? 1 : 0.25);
    if (!last) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function toggleSection(btn) {
  const body = document.getElementById(btn.dataset.target);
  const open = body.classList.toggle("open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) revealOnExpand(body);   // scroll the revealed sliders into view, in sync with the expand
}
document.querySelectorAll(".sec-main").forEach((btn) => {
  btn.addEventListener("click", () => toggleSection(btn));
});
// The bottom chevron toggles the same section it belongs to.
document.querySelectorAll(".expand-hint").forEach((hint) => {
  hint.addEventListener("click", () => {
    const btn = hint.closest(".sync-section")?.querySelector(".sec-main");
    if (btn) toggleSection(btn);
  });
});

// Info tooltips open upward (above the section) by default; if the section is
// near the top of the popup there's no room, so flip them below instead.
document.querySelectorAll(".info").forEach((info) => {
  const tip = info.querySelector(".tip");
  if (!tip) return;
  const place = () => {
    const head = info.closest(".sec-head") || info;
    const need = tip.offsetHeight + 16; // tip height + gap above the header
    info.classList.toggle("tip-below", head.getBoundingClientRect().top < need);
  };
  info.addEventListener("mouseenter", place);
  info.addEventListener("focusin", place);
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
  ["acThreshold", "audioCompThreshold", -100, 0, -60],
  ["acKnee", "audioCompKnee", 0, 40, 30],
  ["acRatio", "audioCompRatio", 1, 20, 10],
  ["acAttack", "audioCompAttack", 0, 1, 0],
  ["acRelease", "audioCompRelease", 0, 1, 1],
  ["acGain", "audioCompGain", 0, 24, 0],
];
ADV.forEach(([id, key, lo, hi, def]) => {
  document.getElementById(id).addEventListener("input", (e) => {
    const v = clampNum(e.target.value, lo, hi, def);
    const out = document.getElementById(id + "Val");
    if (out) out.textContent = fmtParam(key, v);
    saveAudio({ [key]: v });
  });
});

// Reset all compressor parameters to the defaults.
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
// Audio: a scrolling level "waveform" over time (input grey, output accent).
// Buffer: a scrolling time graph of seconds buffered ahead, with the target line.
// Polled ~13×/s; rendered with requestAnimationFrame (~60fps) for smooth motion.
(function setupGraphs() {
  const aCanvas = document.getElementById("audioMeter");
  const bCanvas = document.getElementById("bufferMeter");
  if ((!aCanvas || !aCanvas.getContext) && (!bCanvas || !bCanvas.getContext)) return;
  const acx = aCanvas && aCanvas.getContext("2d");
  const bcx = bCanvas && bCanvas.getContext("2d");
  const A_MIN = -100, A_MAX = 0;         // audio dB range (centre = A_MIN)
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

  const cur = { in: A_MIN, out: A_MIN };           // eased displayed levels
  const tgt = { in: A_MIN, out: A_MIN };           // latest polled levels
  let audioActive = false;
  let audioEnabled = false;                         // compressor actually processing on the page
  let compAnim = 0;                                 // eased 0(off)…1(on) for readout/ghost morph
  let histSeeded = false;                           // graphs pre-filled from history yet?
  const A_WINDOW = 6000;                            // audio waveform time window (ms)
  const audioHist = [];                            // {t, in, out} dB level history
  let audioDiffShown = null, audioDiffAt = 0;      // centered "out − in" dB readout
  let audioInShown = null, audioOutShown = null;   // corner in/out level readouts

  function fmtMag(d) {                               // magnitude only; direction shown by the arrow
    const v = Math.abs(d);
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + " dB";
  }
  function fmtLevel(db) {
    const v = Math.max(A_MIN, Math.round(db));
    return (v < 0 ? "−" + (-v) : String(v)) + " dB";
  }
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

  // A scrolling level "waveform" (like a DAW track): output on top (accent),
  // input on the bottom (grey). The input peaks that poke past the threshold get
  // an orange edge (that's what the compressor acts on). The live output−input
  // change shows centred, like the buffer graph.
  const A_OVER = "#ff9f0a";                          // over-threshold highlight (== threshold colour)
  function drawAudio() {
    const { w, h } = fitCanvas(aCanvas, acx);
    if (!w) return;
    const muted = col("--muted", "#888"), accent = col("--accent", "#0a84ff");
    acx.clearRect(0, 0, w, h);
    const waveW = w;
    const mid = h / 2, maxAmp = h / 2 - 1;
    const ampFor = (db) => ((Math.max(A_MIN, Math.min(A_MAX, db)) - A_MIN) / (A_MAX - A_MIN)) * maxAmp;
    const t = now();
    const xFor = (ts) => waveW * (1 - (t - ts) / A_WINDOW);
    const thr = Number(document.getElementById("acThreshold").value);
    const thrAmp = Number.isNaN(thr) ? null : ampFor(thr);

    // centre line
    acx.strokeStyle = "rgba(127,127,127,0.18)"; acx.lineWidth = 1;
    acx.beginPath(); acx.moveTo(0, Math.round(mid) + 0.5); acx.lineTo(waveW, Math.round(mid) + 0.5); acx.stroke();
    // threshold guide — only on the input (bottom) half; that's what's compressed
    if (thrAmp != null) {
      acx.strokeStyle = "rgba(255,159,10,0.55)"; acx.setLineDash([3, 3]);
      acx.beginPath();
      acx.moveTo(0, Math.round(mid + thrAmp) + 0.5); acx.lineTo(waveW, Math.round(mid + thrAmp) + 0.5);
      acx.stroke(); acx.setLineDash([]);
    }

    // one half of the waveform: dir -1 = upward (output), +1 = downward (input)
    const half = (getDb, dir, color, fillAlpha) => {
      const pts = audioHist.map((p) => ({ x: xFor(p.t), a: ampFor(getDb(p)) }));
      acx.beginPath();
      acx.moveTo(pts[0].x, mid);
      for (let i = 0; i < pts.length; i++) acx.lineTo(pts[i].x, mid + dir * pts[i].a);
      acx.lineTo(pts[pts.length - 1].x, mid); acx.closePath();
      acx.globalAlpha = fillAlpha; acx.fillStyle = color; acx.fill(); acx.globalAlpha = 1;
      acx.strokeStyle = color; acx.lineWidth = 1;
      acx.beginPath();
      acx.moveTo(pts[0].x, mid + dir * pts[0].a);
      for (let i = 1; i < pts.length; i++) acx.lineTo(pts[i].x, mid + dir * pts[i].a);
      acx.stroke();
    };

    if (audioHist.length >= 2) {
      half((p) => p.out, -1, accent, 0.55);   // output on top
      half((p) => p.in, 1, muted, 0.45);       // input on bottom
      // Fill the input above the threshold, clipped to below the line. Opacity
      // grows with level so it only goes solid on loud peaks: faint at the
      // threshold, ramping through the knee (the soft transition, threshold →
      // threshold+knee), and reaching full opacity only near 0 dB.
      if (thrAmp != null) {
        const knee = Number(document.getElementById("acKnee").value) || 0;
        const yThr = mid + thrAmp;
        const yLoud = mid + maxAmp;               // 0 dB — the loudest
        const kneeFrac = Math.min(0.8, Math.max(0.05, knee / Math.max(1, -thr)));
        const grad = acx.createLinearGradient(0, yThr, 0, yLoud);
        grad.addColorStop(0, "rgba(255,159,10,0.10)");          // just over threshold
        grad.addColorStop(kneeFrac, "rgba(255,159,10,0.34)");   // through the knee
        grad.addColorStop(1, "rgba(255,159,10,1)");             // solid only when loud
        const pts = audioHist.map((p) => ({ x: xFor(p.t), a: ampFor(p.in) }));
        acx.save();
        acx.beginPath(); acx.rect(0, yThr, waveW, h - yThr); acx.clip();
        acx.fillStyle = grad;
        acx.beginPath();
        acx.moveTo(pts[0].x, mid);
        for (let i = 0; i < pts.length; i++) acx.lineTo(pts[i].x, mid + pts[i].a);
        acx.lineTo(pts[pts.length - 1].x, mid); acx.closePath();
        acx.fill();
        acx.restore();
      }

      // Ghost of the input level mirrored onto the output (top) half: the gap down
      // to the actual output is how much the compressor pulled the level off. Fades
      // in with the compressor (compAnim); when off, output == input so it vanishes.
      if (compAnim > 0.01) {
        const gp = audioHist.map((p) => ({ x: xFor(p.t), gi: mid - ampFor(p.in), go: mid - ampFor(p.out) }));
        acx.save();
        acx.globalAlpha = 0.18 * compAnim;          // "removed" band
        acx.fillStyle = A_OVER;
        acx.beginPath();
        acx.moveTo(gp[0].x, gp[0].gi);
        for (let i = 0; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
        for (let i = gp.length - 1; i >= 0; i--) acx.lineTo(gp[i].x, gp[i].go);
        acx.closePath(); acx.fill();
        acx.globalAlpha = 0.5 * compAnim;           // dashed "would-be" input level
        acx.strokeStyle = "rgb(214,218,226)"; acx.lineWidth = 1; acx.setLineDash([2, 2]);
        acx.beginPath(); acx.moveTo(gp[0].x, gp[0].gi);
        for (let i = 1; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
        acx.stroke(); acx.setLineDash([]);
        acx.restore();
      }
    }

    // Readout (throttled so digits sit still). OFF → just the current level; ON →
    // before → after with the change. compAnim morphs between the two on toggle.
    if (audioActive && audioHist.length) {
      const last = audioHist[audioHist.length - 1];
      if (audioDiffShown == null || t - audioDiffAt > 600) {  // refresh slowly so digits sit still
        audioDiffShown = last.out - last.in;
        audioOutShown = last.out; audioInShown = last.in;
        audioDiffAt = t;
      }
      const seg = col("--seg", "#2c2c2e");
      acx.lineJoin = "round";
      // OFF: single current level, fades out as the compressor turns on
      const offA = Math.max(0, Math.min(1, 1 - compAnim * 2.4));
      if (offA > 0.01) {
        acx.globalAlpha = offA;
        acx.font = "700 13px -apple-system, sans-serif";
        acx.textAlign = "center"; acx.textBaseline = "middle"; acx.lineWidth = 3.5;
        const lvl = fmtLevel(audioInShown);
        acx.strokeStyle = seg; acx.strokeText(lvl, w / 2, mid);
        acx.fillStyle = "#c7c7cc"; acx.fillText(lvl, w / 2, mid);
        acx.globalAlpha = 1;
      }
      // ON: a single column — output (после) on top, input (до) on the bottom,
      // and in the middle the change magnitude with a triangle for direction
      // (up = louder/boost, down = the compressor cut). Fades in after OFF clears.
      const onA = Math.max(0, Math.min(1, (compAnim - 0.45) * 2.2));
      if (onA > 0.01) {
        acx.globalAlpha = onA;
        const d = audioDiffShown, up = d >= 0, dc = up ? "#5aa8ff" : "#ffb340", cxn = w / 2;
        // output (top) / input (bottom)
        acx.font = "700 12px -apple-system, sans-serif"; acx.textBaseline = "middle"; acx.textAlign = "center"; acx.lineWidth = 3;
        const outL = fmtLevel(audioOutShown), inL = fmtLevel(audioInShown);
        acx.strokeStyle = seg; acx.strokeText(outL, cxn, mid - 13);
        acx.fillStyle = accent; acx.fillText(outL, cxn, mid - 13);
        acx.strokeStyle = seg; acx.strokeText(inL, cxn, mid + 13);
        acx.fillStyle = muted; acx.fillText(inL, cxn, mid + 13);
        // middle: direction triangle + magnitude (the arrow replaces the +/− sign)
        const mag = fmtMag(d);
        acx.font = "700 11px -apple-system, sans-serif";
        const tw = acx.measureText(mag).width, triW = 8, gap = 3, sx = cxn - (triW + gap + tw) / 2, ty = mid;
        const tri = () => {
          acx.beginPath();
          if (up) { acx.moveTo(sx + triW / 2, ty - 4); acx.lineTo(sx, ty + 3); acx.lineTo(sx + triW, ty + 3); }
          else { acx.moveTo(sx + triW / 2, ty + 4); acx.lineTo(sx, ty - 3); acx.lineTo(sx + triW, ty - 3); }
          acx.closePath();
        };
        tri(); acx.lineWidth = 3; acx.strokeStyle = seg; acx.stroke();    // halo
        tri(); acx.fillStyle = dc; acx.fill();
        acx.textAlign = "left";
        acx.lineWidth = 3; acx.strokeStyle = seg; acx.strokeText(mag, sx + triW + gap, ty);
        acx.fillStyle = dc; acx.fillText(mag, sx + triW + gap, ty);
        acx.globalAlpha = 1;
      }
      acx.textBaseline = "alphabetic";
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
      bcx.fillStyle = "rgba(10,132,255,0.16)"; bcx.fill();
      bcx.beginPath(); smoothLine(bcx, pts);
      bcx.strokeStyle = col("--accent", "#0a84ff"); bcx.lineWidth = 2; bcx.lineJoin = "round"; bcx.lineCap = "round"; bcx.stroke();
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
    compAnim += ((audioEnabled ? 1 : 0) - compAnim) * 0.12; // morph readout/ghost on toggle
    // Record the eased level each frame so the waveform scrolls smoothly.
    if (audioActive) {
      audioHist.push({ t, in: cur.in, out: cur.out });
      while (audioHist.length && t - audioHist[0].t > A_WINDOW + 200) audioHist.shift();
    } else if (audioHist.length) {
      audioHist.length = 0; audioDiffShown = null; // stopped — empty the graph
    }
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
      const wasActive = audioActive;
      audioActive = !!a.active;
      audioEnabled = !!a.enabled;
      if (audioActive) {
        tgt.in = a.in; tgt.out = a.out;
        // Snap on (re)activation instead of easing up from the −100 floor, so the
        // very first readout shows the real level rather than a low ramp.
        if (!wasActive) { cur.in = a.in; cur.out = a.out; }
      }
      bufLive = !!resp.live;

      // Pre-fill both graphs once from the background-collected history so they
      // don't start empty (when there's any history to fill them with).
      if (!histSeeded && (audioActive || bufLive)) {
        histSeeded = true;
        api.tabs.sendMessage(activeTabId, { action: "getHistory" }, (r) => {
          if (api.runtime.lastError || !r) return;
          const t0 = now();
          if (r.audio && r.audio.length) {
            const step = r.audioStep || 150, n = r.audio.length;
            const seed = r.audio.map((p, i) => ({ t: t0 - (n - 1 - i) * step, in: p[0], out: p[1] }));
            audioHist.unshift(...seed);
            while (audioHist.length && t0 - audioHist[0].t > A_WINDOW + 200) audioHist.shift();
          }
          if (r.buffer && r.buffer.length) {
            const seedB = r.buffer.map((p) => ({ t: t0 - p[0], v: p[1] })).sort((x, y) => x.t - y.t);
            bufHist.unshift(...seedB);
            if (bufSmooth == null && seedB.length) bufSmooth = seedB[seedB.length - 1].v;
            while (bufHist.length && t0 - bufHist[0].t > BUF_WINDOW + 1000) bufHist.shift();
          }
        });
      }
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
