// Live graphs, drawn on the popup's two canvases:
//   Audio  — a scrolling level "waveform" over time (input grey, output accent),
//            with the over-threshold highlight, ghost-of-input, and the readout.
//   Buffer — a scrolling time graph of seconds buffered ahead, with the target.
// Polled ~13×/s; rendered with requestAnimationFrame (~60fps) for smooth motion.
import { api, msg, ctx } from "./env.js";

export function setupGraphs() {
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

  // While a voice-over translator (VOT) is playing, the compressor yields — show a
  // warning and dim/lock the audio section (like manual speed on a live stream).
  const votWarnEl = document.getElementById("audioVotWarn");
  const audioBodyEl = document.getElementById("audioBody");
  const audioSectionEl = audioBodyEl && audioBodyEl.closest(".sync-section");
  let audioTranslating = false;
  function setAudioTranslating(on) {
    if (on === audioTranslating) return;
    audioTranslating = on;
    if (votWarnEl) votWarnEl.style.display = on ? "inline-flex" : "none";
    if (audioSectionEl) audioSectionEl.classList.toggle("audio-locked", on);
  }

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
        const d = audioDiffShown, up = d >= 0, dc = col("--text", "#fff"), cxn = w / 2;
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
    if (ctx.activeTabId == null) return;
    api.tabs.sendMessage(ctx.activeTabId, { action: "getMonitor" }, (resp) => {
      if (api.runtime.lastError || !resp) { audioActive = false; setAudioTranslating(false); return; }
      const a = resp.audio || {};
      const wasActive = audioActive;
      audioActive = !!a.active;
      audioEnabled = !!a.enabled;
      setAudioTranslating(!!a.translation);  // VOT etc. playing → warn + lock the section
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
        api.tabs.sendMessage(ctx.activeTabId, { action: "getHistory" }, (r) => {
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
}
