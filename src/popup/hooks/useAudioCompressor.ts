// Audio-compressor card state + behaviour, ported from audio-settings.ts. Owns the
// on/off flag, the six compressor params (make-up gain is separate — presets never
// touch it), and the editable presets. Writes are debounced and merged so a later
// single-key write can't clobber an earlier different-key one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { clampNum } from "../core/clamp.js";
import {
  resolvePresets,
  compToStorage,
  type CompParams,
  type PresetName,
  type ResolvedPreset,
  type StoredPresets,
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
  presets: Record<PresetName, ResolvedPreset>;
  activePreset: PresetName | null;
  setParam: (key: keyof CompParams, value: number) => void;
  setGain: (value: number) => void;
  applyPreset: (name: PresetName) => void;
}

export function useAudioCompressor(): UseAudioCompressor {
  const [enabled, setEnabledState] = useState(true);
  const [comp, setComp] = useState<CompState>({ values: DEFAULTS, animate: false });
  const [gain, setGainState] = useState(0);
  const [presets, setPresets] = useState<Record<PresetName, ResolvedPreset>>(() =>
    resolvePresets(undefined),
  );

  const pending = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveAudio = useCallback((obj: Record<string, unknown>) => {
    Object.assign(pending.current, obj);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      STORE.set(pending.current);
      pending.current = {};
    }, 350);
  }, []);

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

  const setGain = useCallback(
    (value: number) => {
      setGainState(value);
      saveAudio({ audioCompGain: value });
    },
    [saveAudio],
  );

  const applyPreset = useCallback(
    (name: PresetName) => {
      const p = presets[name];
      const values: CompParams = {
        threshold: p.threshold,
        knee: p.knee,
        ratio: p.ratio,
        attack: p.attack,
        release: p.release,
      };
      setComp({ values, animate: true });
      setEnabledState(true);
      saveAudio({ ...compToStorage(values), audioComp: true });
    },
    [presets, saveAudio],
  );

  // Which preset (if any) the current comp values match — lights its button.
  const activePreset = useMemo<PresetName | null>(() => {
    const v = comp.values;
    const match = (Object.keys(presets) as PresetName[]).find((name) => {
      const p = presets[name];
      return (
        EQ(v.threshold, p.threshold) &&
        EQ(v.knee, p.knee) &&
        EQ(v.ratio, p.ratio) &&
        EQ(v.attack, p.attack) &&
        EQ(v.release, p.release)
      );
    });
    return match ?? null;
  }, [comp.values, presets]);

  useEffect(() => {
    STORE.get(
      [
        "audioComp",
        "audioCompGain",
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
        setGainState(clampNum(r.audioCompGain, 0, 24, 0));
      },
    );
    STORE.get(["compPresets"], (r) =>
      setPresets(resolvePresets(r.compPresets as StoredPresets | undefined)),
    );
  }, []);

  return { enabled, setEnabled, comp, gain, presets, activePreset, setParam, setGain, applyPreset };
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
