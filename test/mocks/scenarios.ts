// Deterministic monitor/history data for reproducible screenshots and DOM tests.
import type { MockData } from "./chrome.js";

const THRESHOLD = -30;
const GAIN = 10;

// Latest in/out levels are returned alongside the history so the getMonitor
// readout matches the last point of the getHistory graph.
function audioWaveform(n = 48, step = 150) {
  const audio: [number, number][] = [];
  let lastIn = -45,
    lastOut = -45;
  for (let i = 0; i < n; i++) {
    const env = 0.5 + 0.5 * Math.sin(i * 0.18) * Math.cos(i * 0.07);
    const inDb = -48 + 40 * Math.max(0, Math.min(1, env)); // ~-48…-8
    const over = Math.max(0, inDb - THRESHOLD);
    const outDb = inDb - over * 0.6 + GAIN;
    lastIn = Math.round(inDb * 10) / 10;
    lastOut = Math.round(outDb * 10) / 10;
    audio.push([lastIn, lastOut]);
  }
  return { audio, audioStep: step, lastIn, lastOut };
}

// Speech rate oscillating across the target (6), with the resulting speed easing
// down when it's dense — a representative auto-slow trace for the graph.
function autoSlowTrace(n = 80, step = 100) {
  const autoSlow: [number, number][] = [];
  let rate = 6,
    speed = 1.6;
  for (let i = 0; i < n; i++) {
    rate = 6.2 + 2.6 * Math.sin(i * 0.16) + 1.1 * Math.sin(i * 0.55);
    speed = rate > 6 ? Math.max(1.0, 1.6 - (rate - 6) * 0.16) : 1.6;
    autoSlow.push([Math.round(rate * 10) / 10, Math.round(speed * 100) / 100]);
  }
  return {
    autoSlow,
    autoSlowStep: step,
    rate: Math.round(rate * 10) / 10,
    speed: Math.round(speed * 100) / 100,
  };
}

function latencyHistory(n = 60, base = 7) {
  const buffer: [number, number][] = [];
  let last = base;
  for (let i = 0; i < n; i++) {
    const dt = (n - 1 - i) * 500; // ms ago
    last = base + 2 * Math.sin(i * 0.22) + 0.4 * Math.sin(i * 0.9);
    buffer.push([dt, Math.round(last * 100) / 100]);
  }
  return { buffer, last: Math.round(last * 100) / 100 };
}

const SETTINGS = {
  domains: {},
  showRemaining: true,
  streamBadge: true,
  liveSync: true,
  liveSyncTarget: 5,
  audioComp: true,
  audioCompThreshold: THRESHOLD,
  audioCompKnee: 30,
  audioCompRatio: 10,
  audioCompAttack: 0,
  audioCompRelease: 1,
  audioCompGain: GAIN,
  autoSlowGlobal: { target: 6 },
};

export type ScenarioName = "audio" | "live" | "vot" | "idle" | "promo";

// `messages` is layered in by the caller.
export function scenario(name: ScenarioName = "audio"): MockData {
  const wave = audioWaveform();
  const slow = autoSlowTrace();
  const autoSlow = (active: boolean) => ({ active, rate: slow.rate, target: 6, speed: slow.speed });
  const audioLevels = (translation: boolean) => ({
    active: true,
    enabled: true,
    translation,
    in: wave.lastIn,
    out: wave.lastOut,
    threshold: THRESHOLD,
  });

  switch (name) {
    case "live": {
      const lat = latencyHistory();
      return {
        settings: SETTINGS,
        speed: { speed: 1.3, live: true },
        monitor: {
          audio: audioLevels(false),
          autoSlow: autoSlow(false), // off on streams (owned by live-sync)
          buffer: lat.last,
          bitrate: 5_200_000,
          target: 5,
          live: true,
          hasVideo: true,
        },
        history: { audio: wave.audio, audioStep: wave.audioStep, buffer: lat.buffer },
      };
    }
    case "vot":
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: {
          audio: audioLevels(true),
          autoSlow: autoSlow(false),
          buffer: null,
          bitrate: null,
          target: 5,
          live: false,
          hasVideo: true,
        },
        history: { audio: wave.audio, audioStep: wave.audioStep, buffer: [] },
      };
    case "idle":
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: {
          audio: { active: false, enabled: true, translation: false },
          autoSlow: autoSlow(false),
          buffer: null,
          bitrate: null,
          target: 5,
          live: false,
          hasVideo: false,
        },
        history: { audio: [], audioStep: 150, buffer: [] },
      };
    case "promo": {
      // Every graph and Viewer control populated for the store assets. The lock
      // states (Speed/Auto-slow dim on a stream, Live-sync off one) are neutralised
      // in CSS by the promo renderer, so every card reads as live with data.
      const lat = latencyHistory();
      return {
        // threshold matches the Voice preset so it reads as selected.
        settings: {
          ...SETTINGS,
          audioCompThreshold: -60,
          viewerAutoEnabled: true,
          viewerBackdropVideo: true,
        },
        speed: { speed: 1.3, live: true, channel: "slooonick", channelName: "slooonick" },
        viewer: { autoMode: "normal", pageMode: "normal", fitMode: "cover", scope: "site" },
        monitor: {
          audio: audioLevels(false),
          autoSlow: autoSlow(true),
          buffer: lat.last,
          bitrate: 5_200_000,
          target: 5,
          live: true,
          hasVideo: true,
        },
        history: {
          audio: wave.audio,
          audioStep: wave.audioStep,
          buffer: lat.buffer,
          autoSlow: slow.autoSlow,
          autoSlowStep: slow.autoSlowStep,
        },
      };
    }
    case "audio":
    default:
      return {
        settings: SETTINGS,
        speed: { speed: 1, live: false },
        monitor: {
          audio: audioLevels(false),
          autoSlow: autoSlow(true),
          buffer: null,
          bitrate: null,
          target: 5,
          live: false,
          hasVideo: true,
        },
        history: {
          audio: wave.audio,
          audioStep: wave.audioStep,
          buffer: [],
          autoSlow: slow.autoSlow,
          autoSlowStep: slow.autoSlowStep,
        },
      };
  }
}
