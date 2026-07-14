// General card: theme (applies live) + glass opacity, language (saves + reloads),
// and the on-video button mode. Also defines the JSON Backup export/import control
// (exported), which the Sync section renders as a row under Data & sync.
import { useEffect, useRef, useState } from "react";
import { STORE } from "../../shared/store.js";
import { THEMES, type Theme, setTheme } from "../../shared/theme.js";
import { LOCALES, LOCALE_NAMES, getLang, setLang, type Lang } from "../../shared/i18n-config.js";
import { SYNC_MASTER_KEY, SYNC_META_KEY } from "../../shared/sync-config.js";
import { msg } from "../../popup/i18n.js";
import { Group } from "../Group.js";
import { Button } from "../../ui/Button.js";
import { Segmented } from "../../ui/Segmented.js";
import { Slider } from "../../ui/Slider.js";
import { Switch } from "../../ui/Switch.js";
import {
  applyGlassOpacity,
  clampGlassOpacity,
  GLASS_OPACITY_KEY,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
  DEFAULT_GLASS_OPACITY,
} from "../../shared/glass.js";
import {
  hasSponsorDataConsent,
  removeSponsorDataConsent,
  requestSponsorDataConsent,
} from "../../shared/sponsor-consent.js";

const THEME_LABEL: Record<Theme, string> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};
const FILE = "video-tuner-pro-settings.json";

function hasPresetArrayMismatch(data: Record<string, unknown>): boolean {
  const presets = data.speedPresets;
  if (!Array.isArray(presets)) return false;
  return (
    (Array.isArray(data.presetKeys) && data.presetKeys.length !== presets.length) ||
    (Array.isArray(data.presetPins) && data.presetPins.length !== presets.length)
  );
}

function ThemeSeg() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => {
    STORE.get(["theme"], (r) => setThemeState((r.theme as Theme) || "system"));
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };
  return (
    <Segmented
      id="themeSeg"
      ariaLabel={msg("optThemeLabel") || "Theme"}
      items={THEMES.map((t) => ({ value: t, label: msg(THEME_LABEL[t]) || t }))}
      value={theme}
      onChange={pick}
    />
  );
}

type OverlayMode = "off" | "fullscreen" | "always";
const OVERLAY_MODES: OverlayMode[] = ["off", "fullscreen", "always"];
const OVERLAY_LABEL: Record<OverlayMode, string> = {
  off: "overlayBtnOff",
  fullscreen: "overlayBtnFullscreen",
  always: "overlayBtnAlways",
};

function OverlayBtnSeg() {
  const [mode, setMode] = useState<OverlayMode>("fullscreen");
  useEffect(() => {
    STORE.get(["overlayButton"], (r) => {
      const v = r.overlayButton;
      setMode(v === "off" || v === "always" ? v : "fullscreen");
    });
  }, []);
  const pick = (m: OverlayMode) => {
    setMode(m);
    STORE.set({ overlayButton: m });
  };
  return (
    <Segmented
      id="overlayBtnSeg"
      ariaLabel={msg("overlayBtnLabel") || "On-video button"}
      items={OVERLAY_MODES.map((m) => ({ value: m, label: msg(OVERLAY_LABEL[m]) || m }))}
      value={mode}
      onChange={pick}
    />
  );
}

type ViewerAuto = "off" | "normal" | "theater";
const VIEWER_AUTO_MODES: ViewerAuto[] = ["off", "normal", "theater"];
const VIEWER_AUTO_LABEL: Record<ViewerAuto, string> = {
  off: "overlayBtnOff",
  normal: "viewerAutoNormal",
  theater: "viewerAutoTheater",
};

function ViewerAutoSeg() {
  const [mode, setMode] = useState<ViewerAuto>("off");
  useEffect(() => {
    STORE.get(["viewerAutoGlobal", "viewerAuto"], (r) => {
      const v = r.viewerAutoGlobal ?? r.viewerAuto;
      setMode(v === "normal" || v === "theater" ? v : "off");
    });
  }, []);
  const pick = (m: ViewerAuto) => {
    setMode(m);
    STORE.set({ viewerAutoGlobal: m });
  };
  return (
    <Segmented
      id="viewerAutoSeg"
      ariaLabel={msg("optViewerAutoLabel") || "Auto pop-out on play"}
      items={VIEWER_AUTO_MODES.map((m) => ({ value: m, label: msg(VIEWER_AUTO_LABEL[m]) || m }))}
      value={mode}
      onChange={pick}
    />
  );
}

function SponsorSwitch() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    STORE.get(["sponsorMarks"], (r) => {
      if (r.sponsorMarks !== true) return setOn(false);
      void hasSponsorDataConsent().then((granted) => {
        setOn(granted);
      });
    });
  }, []);
  const toggle = async (v: boolean) => {
    if (!v) {
      setOn(false);
      STORE.set({ sponsorMarks: false });
      await removeSponsorDataConsent();
      return;
    }
    const granted = await requestSponsorDataConsent();
    setOn(granted);
    STORE.set({ sponsorMarks: granted });
  };
  return (
    <Switch
      checked={on}
      onChange={toggle}
      ariaLabel={msg("optSponsorLabel") || "SponsorBlock markers"}
    />
  );
}

function GlassOpacity() {
  const [v, setV] = useState(DEFAULT_GLASS_OPACITY);
  useEffect(() => {
    STORE.get([GLASS_OPACITY_KEY], (r) => setV(clampGlassOpacity(r[GLASS_OPACITY_KEY])));
  }, []);
  const onChange = (n: number) => {
    const c = clampGlassOpacity(n);
    setV(c);
    applyGlassOpacity(document.documentElement, c); // live preview on this page
    STORE.set({ [GLASS_OPACITY_KEY]: c });
  };
  return (
    <div className="opt-glass-slider">
      <Slider
        className="opt-slider"
        id="glassOpacity"
        min={GLASS_OPACITY_MIN}
        max={GLASS_OPACITY_MAX}
        step={0.05}
        value={v}
        ariaLabel={msg("optGlassLabel") || "Glass opacity"}
        onChange={onChange}
      />
      <b className="opt-param-val">{Math.round(v * 100)}%</b>
    </div>
  );
}

function LangGrid() {
  const [lang, setLangState] = useState<Lang>("system");
  useEffect(() => {
    getLang(setLangState);
  }, []);
  const options: Array<[Lang, string]> = [
    ["system", msg("langSystem") || "System"],
    ...LOCALES.map((c) => [c, LOCALE_NAMES[c]] as [Lang, string]),
  ];
  return (
    <Segmented
      id="langGrid"
      className="lang-grid"
      ariaLabel={msg("optLangLabel") || "Language"}
      items={options.map(([value, label]) => ({ value, label }))}
      value={lang}
      onChange={(v) => setLang(v, () => location.reload())}
    />
  );
}

// Briefly turn a button green/red with a confirming label, then restore it.
type Flash = { key: string; ok: boolean } | null;

export function Backup() {
  const [exp, setExp] = useState<Flash>(null);
  const [imp, setImp] = useState<Flash>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (set: (f: Flash) => void, key: string, ok: boolean) => {
    set({ key, ok });
    timer.current = setTimeout(() => set(null), ok ? 1500 : 1500);
  };

  const doExport = () => {
    STORE.get(null, (all) => {
      const data: Record<string, unknown> = { ...all };
      delete data[SYNC_META_KEY];
      delete data[SYNC_MASTER_KEY];
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = FILE;
      a.click();
      URL.revokeObjectURL(url);
      flash(setExp, "optExportDone", true);
    });
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        flash(setImp, "optImportError", false);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        flash(setImp, "optImportError", false);
        return;
      }
      const data = { ...(parsed as Record<string, unknown>) };
      delete data[SYNC_META_KEY]; // never import another device's sync choices
      delete data[SYNC_MASTER_KEY];
      if (hasPresetArrayMismatch(data)) {
        flash(setImp, "optImportError", false);
        return;
      }
      STORE.get(null, (current) => {
        const stale = Object.keys(current).filter(
          (key) => key !== SYNC_META_KEY && key !== SYNC_MASTER_KEY && !(key in data),
        );
        const done = () => {
          flash(setImp, "optImportDone", true);
          setTimeout(() => location.reload(), 1000);
        };
        const removeStale = () => {
          if (!stale.length) {
            done();
            return;
          }
          const removeEverywhere = STORE.removeEverywhere?.bind(STORE) ?? STORE.remove.bind(STORE);
          removeEverywhere(stale, (ok) => {
            if (ok === false) {
              flash(setImp, "optImportError", false);
              return;
            }
            done();
          });
        };
        STORE.set(data, (ok) => {
          if (ok === false) {
            flash(setImp, "optImportError", false);
            return;
          }
          removeStale();
        });
      });
    };
    reader.readAsText(file);
  };

  const cls = (base: string, f: Flash) => base + (f ? (f.ok ? " btn-ok" : " btn-err") : "");
  return (
    <div className="opt-actions">
      <Button id="exportBtn" className={cls("btn-action btn-default", exp)} onClick={doExport}>
        {exp ? msg(exp.key) || exp.key : msg("optExport") || "Export…"}
      </Button>
      <Button
        id="importBtn"
        className={cls("btn-action btn-reset", imp)}
        onClick={() => fileRef.current?.click()}
      >
        {imp ? msg(imp.key) || imp.key : msg("optImport") || "Import…"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function General() {
  return (
    <Group>
      <div className="opt-field">
        <span className="opt-field-label">{msg("optThemeLabel") || "Theme"}</span>
        <ThemeSeg />
      </div>
      <div className="opt-field opt-field-block">
        <span className="opt-field-text">
          <span className="opt-field-label">{msg("optGlassLabel") || "Glass opacity"}</span>
          <span className="opt-field-desc">
            {msg("optGlassHint") ||
              "How solid the frosted glass looks, across the popup and on-video panels."}
          </span>
        </span>
        <GlassOpacity />
      </div>
      <div className="opt-field opt-field-block">
        <span className="opt-field-label">{msg("optLangLabel") || "Language"}</span>
        <LangGrid />
      </div>
      <div className="opt-field opt-field-block">
        <span className="opt-field-text">
          <span className="opt-field-label">{msg("overlayBtnLabel") || "On-video button"}</span>
          <span className="opt-field-desc">{msg("overlayBtnHint")}</span>
        </span>
        <OverlayBtnSeg />
      </div>
      <div className="opt-field opt-field-block">
        <span className="opt-field-text">
          <span className="opt-field-label">
            {msg("optViewerAutoLabel") || "Auto pop-out on play"}
          </span>
          <span className="opt-field-desc">{msg("optViewerAutoHint")}</span>
        </span>
        <ViewerAutoSeg />
      </div>
      <div className="opt-field">
        <span className="opt-field-text">
          <span className="opt-field-label">
            {msg("optSponsorLabel") || "SponsorBlock markers"}
          </span>
          <span className="opt-field-desc">{msg("optSponsorHint")}</span>
        </span>
        <SponsorSwitch />
      </div>
    </Group>
  );
}
