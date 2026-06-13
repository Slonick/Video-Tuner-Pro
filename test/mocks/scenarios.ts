// Deterministic monitor/history data for reproducible screenshots and DOM tests.
import type { MockData } from "./chrome.js";

const THRESHOLD = -30;

// Latest in/out levels are returned alongside the history so the getMonitor
// readout matches the last point of the getHistory graph.
function audioWaveform(n = 48, step = 150) {
  const audio: [number, number][] = [];
  let lastIn = -45, lastOut = -45;
  for (let i = 0; i < n; i++) {
    const env = 0.5 + 0.5 * Math.sin(i * 0.18) * Math.cos(i * 0.07);
    const inDb = -48 + 40 * Math.max(0, Math.min(1, env));        // ~-48…-8
    const over = Math.max(0, inDb - THRESHOLD);
    const outDb = Math.min(0, inDb - over * 0.6 + 9);             // compress + make-up
    lastIn = Math.round(inDb * 10) / 10; lastOut = Math.round(outDb * 10) / 10;
    audio.push([lastIn, lastOut]);
  }
  return { audio, audioStep: step, lastIn, lastOut };
}

function latencyHistory(n = 60, base = 7) {
  const buffer: [number, number][] = [];
  let last = base;
  for (let i = 0; i < n; i++) {
    const dt = (n - 1 - i) * 500;                                  // ms ago
    last = base + 2 * Math.sin(i * 0.22) + 0.4 * Math.sin(i * 0.9);
    buffer.push([dt, Math.round(last * 100) / 100]);
  }
  return { buffer, last: Math.round(last * 100) / 100 };
}

const SETTINGS = {
  domains: {},
  showRemaining: true, streamBadge: true,
  liveSync: true, liveSyncTarget: 5,
  audioComp: true, audioCompThreshold: THRESHOLD, audioCompKnee: 30,
  audioCompRatio: 10, audioCompAttack: 0, audioCompRelease: 1, audioCompGain: 10,
};

export type ScenarioName = "audio" | "live" | "vot" | "idle";

// `messages` is layered in by the caller.
export function scenario(name: ScenarioName = "audio"): MockData {
  const wave = audioWaveform();
  const audioLevels = (translation: boolean) => ({
    active: true, enabled: true, translation,
    in: wave.lastIn, out: wave.lastOut, threshold: THRESHOLD,
  });

  switch (name) {
    case "live": {
      const lat = latencyHistory();
      return {
        settings: SETTINGS,
        speed: { speed: 1.3, live: true },
        monitor: { audio: audioLevels(false), buffer: lat.last, bitrate: 5_200_000, target: 5, live: true, hasVideo: true },
        history: { audio: wave.audio, audioStep: wave.audioStep, buffer: lat.buffer },
      };
    }
    case "vot":
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: { audio: audioLevels(true), buffer: null, bitrate: null, target: 5, live: false, hasVideo: true },
        history: { audio: wave.audio, audioStep: wave.audioStep, buffer: [] },
      };
    case "idle":
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: { audio: { active: false, enabled: true, translation: false }, buffer: null, bitrate: null, target: 5, live: false, hasVideo: false },
        history: { audio: [], audioStep: 150, buffer: [] },
      };
    case "audio":
    default:
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: { audio: audioLevels(false), buffer: null, bitrate: null, target: 5, live: false, hasVideo: true },
        history: { audio: wave.audio, audioStep: wave.audioStep, buffer: [] },
      };
  }
}
