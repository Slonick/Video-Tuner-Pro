// Audio-compressor card state + behaviour, ported from audio-settings.ts. Owns the
// on/off flag, the six compressor params (make-up gain is separate — presets never
// touch it), and the editable presets. Writes are debounced and merged so a later
// single-key write can't clobber an earlier different-key one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { clampNum } from "../core/clamp.js";
import {
  normalizeCompPresets,
  compToStorage,
  type CompParams,
  type CompPreset,
} from "../../shared/comp-presets.js";

const EQ = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// values for the five compressor sliders; `animate` says whether the sliders
// should glide (preset apply) or snap (drag / load).
interface CompState {
  values: CompParams;
  animate: boolean;
}

const DEFAULTS: CompParams = { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1 };

export interface UseAudioCompressor {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  comp: CompState;
  gain: number;
  presets: CompPreset[];
  activePreset: number | null;
  setParam: (key: keyof CompParams, value: number) => void;
  setGain: (value: number) => void;
  applyPreset: (index: number) => void;
}

export function useAudioCompressor(): UseAudioCompressor {
  const [enabled, setEnabledState] = useState(true);
  const [comp, setComp] = useState<CompState>({ values: DEFAULTS, animate: false });
  const [gain, setGainState] = useState(0);
  // The global make-up gain a preset without its own gain falls back to. Kept
  // apart from the live `audioCompGain` so a preset's gain override can't clobber
  // it — leaving that preset restores this value.
  const [baseGain, setBaseGain] = useState(0);
  const [presets, setPresets] = useState<CompPreset[]>(() => normalizeCompPresets(undefined));

  const pending = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushAudio = useCallback(() => {
    clearTimeout(saveTimer.current);
    const next = pending.current;
    pending.current = {};
    if (Object.keys(next).length) STORE.set(next);
  }, []);
  const saveAudio = useCallback(
    (obj: Record<string, unknown>) => {
      Object.assign(pending.current, obj);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushAudio, 350);
    },
    [flushAudio],
  );
  useEffect(() => () => flushAudio(), [flushAudio]);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    STORE.set({ audioComp: on });
  }, []);

  const setParam = useCallback(
    (key: keyof CompParams, value: number) => {
      setComp((c) => ({ values: { ...c.values, [key]: value }, animate: false }));
      saveAudio({ [storageKey(key)]: value });
    },
    [saveAudio],
  );

  // Which preset (if any) the current comp values match — lights its button.
  // Gain is intentionally excluded from the match so editing a preset's gain
  // doesn't deactivate it.
  const activePreset = useMemo<number | null>(() => {
    const v = comp.values;
    const i = presets.findIndex(
      (p) =>
        EQ(v.threshold, p.threshold) &&
        EQ(v.knee, p.knee) &&
        EQ(v.ratio, p.ratio) &&
        EQ(v.attack, p.attack) &&
        EQ(v.release, p.release),
    );
    return i === -1 ? null : i;
  }, [comp.values, presets]);

  // The gain slider edits the active preset's own gain when it has one (persist
  // into compPresets), otherwise the global make-up gain. Either way the live
  // value (audioCompGain) is what the content script applies.
  const setGain = useCallback(
    (value: number) => {
      setGainState(value);
      if (activePreset != null && presets[activePreset]?.gain != null) {
        const next = presets.map((p, j) => (j === activePreset ? { ...p, gain: value } : p));
        setPresets(next);
        saveAudio({ compPresets: next, audioCompGain: value });
      } else {
        setBaseGain(value);
        saveAudio({ audioCompBaseGain: value, audioCompGain: value });
      }
    },
    [activePreset, presets, saveAudio],
  );

  const applyPreset = useCallback(
    (index: number) => {
      const p = presets[index];
      if (!p) return;
      const values: CompParams = {
        threshold: p.threshold,
        knee: p.knee,
        ratio: p.ratio,
        attack: p.attack,
        release: p.release,
      };
      setComp({ values, animate: true });
      setEnabledState(true);
      // A preset with its own gain sets the live gain to it; one without falls
      // back to the global make-up gain, restoring it.
      const liveGain = p.gain != null ? p.gain : baseGain;
      setGainState(liveGain);
      saveAudio({ ...compToStorage(values), audioComp: true, audioCompGain: liveGain });
    },
    [presets, baseGain, saveAudio],
  );

  useEffect(() => {
    STORE.get(
      [
        "audioComp",
        "audioCompGain",
        "audioCompBaseGain",
        "audioCompThreshold",
        "audioCompKnee",
        "audioCompRatio",
        "audioCompAttack",
        "audioCompRelease",
      ],
      (r) => {
        setEnabledState(r.audioComp !== false);
        setComp({
          values: {
            threshold: clampNum(r.audioCompThreshold, -100, 0, -60),
            knee: clampNum(r.audioCompKnee, 0, 40, 30),
            ratio: clampNum(r.audioCompRatio, 1, 20, 10),
            attack: clampNum(r.audioCompAttack, 0, 1, 0),
            release: clampNum(r.audioCompRelease, 0, 1, 1),
          },
          animate: false,
        });
        const live = clampNum(r.audioCompGain, 0, 24, 0);
        setGainState(live);
        // Migrate pre-split installs: an absent base gain inherits the stored live.
        setBaseGain(clampNum(r.audioCompBaseGain, 0, 24, live));
      },
    );
    STORE.get(["compPresets"], (r) => setPresets(normalizeCompPresets(r.compPresets)));
  }, []);

  return useMemo(
    () => ({
      enabled,
      setEnabled,
      comp,
      gain,
      presets,
      activePreset,
      setParam,
      setGain,
      applyPreset,
    }),
    [enabled, setEnabled, comp, gain, presets, activePreset, setParam, setGain, applyPreset],
  );
}

function storageKey(key: keyof CompParams): string {
  return (
    {
      threshold: "audioCompThreshold",
      knee: "audioCompKnee",
      ratio: "audioCompRatio",
      attack: "audioCompAttack",
      release: "audioCompRelease",
    } as const
  )[key];
}
