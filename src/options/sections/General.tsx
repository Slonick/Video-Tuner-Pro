// General card: theme (applies live), language (saves + reloads), and JSON
// backup export/import. Mirrors the old appearance.ts + backup.ts behaviour.
import { useEffect, useRef, useState } from "react";
import { STORE } from "../../shared/store.js";
import { THEMES, type Theme, setTheme } from "../../shared/theme.js";
import { LOCALES, LOCALE_NAMES, getLang, setLang, type Lang } from "../../shared/i18n-config.js";
import { SYNC_META_KEY } from "../../shared/sync-config.js";
import { msg } from "../../popup/i18n.js";
import { StoredToggle } from "../../popup/components/StoredToggle.js";
import { Button } from "../../ui/Button.js";
import { Segmented } from "../../ui/Segmented.js";
import { Slider } from "../../ui/Slider.js";
import {
  applyGlassOpacity,
  clampGlassOpacity,
  GLASS_OPACITY_KEY,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
  DEFAULT_GLASS_OPACITY,
} from "../../shared/glass.js";

const THEME_LABEL: Record<Theme, string> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};
const FILE = "video-tuner-pro-settings.json";

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

function Backup() {
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
      STORE.set(data, () => {
        flash(setImp, "optImportDone", true);
        setTimeout(() => location.reload(), 1000);
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
    <section className="card">
      <h2>{msg("optGeneralTitle") || "General"}</h2>
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
      <div className="opt-field">
        <span className="opt-field-text">
          <span className="opt-field-label">{msg("forceRateLabel") || "Force speed"}</span>
          <span className="opt-field-desc">{msg("forceRateHint")}</span>
        </span>
        <StoredToggle id="forceRateToggle" storageKey="forceRate" defaultOn={false} />
      </div>
      <div className="opt-field">
        <span className="opt-field-label">{msg("optBackupTitle") || "Backup"}</span>
        <Backup />
      </div>
    </section>
  );
}
