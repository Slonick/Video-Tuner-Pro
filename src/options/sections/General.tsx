// General card: theme (applies live) + glass opacity, language (saves + reloads), the
// on-video button mode and the sites the extension stays off on. Also defines the JSON
// Backup export/import control (exported), which the Sync section renders as a row
// under Data & sync.
import { useCallback, useEffect, useRef, useState } from "react";
import { STORE, subscribe } from "../../shared/store.js";
import { THEMES, type Theme, setTheme } from "../../shared/theme.js";
import {
  LOCALES,
  LOCALE_NAMES,
  getLang,
  isLocale,
  setLang,
  type Lang,
} from "../../shared/i18n-config.js";
import { KEY_CATEGORY, SYNC_MASTER_KEY, SYNC_META_KEY } from "../../shared/sync-config.js";
import {
  STORED_MAP_NAMES,
  safeKey,
  validStoredMapValue,
  type StoredMapName,
} from "../../shared/map-mutation.js";
import { SITE_BLACKLIST_KEY, normalizeSiteList } from "../../shared/site-blacklist.js";
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

const MAP_NAMES = new Set<string>(STORED_MAP_NAMES);

// What a backup may write: settings keys only (never another device's sync choices
// or internal bookkeeping), a language this build ships, and only the map entries
// their readers accept — so a stale or hand-edited file can't break the UIs.
function importableSettings(file: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file)) {
    if (!Object.hasOwn(KEY_CATEGORY, key)) continue;
    if (key === "uiLang") {
      if (value === "system" || isLocale(value)) out[key] = value;
    } else if (MAP_NAMES.has(key)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entries = Object.entries(value).filter(
        ([k, v]) => safeKey(k) && validStoredMapValue(key as StoredMapName, v),
      );
      if (entries.length) out[key] = Object.fromEntries(entries);
    } else {
      out[key] = value;
    }
  }
  return out;
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

// One site per line (commas and spaces work too). Saved on blur, normalized, and the
// field then shows what was actually stored — "https://www.Example.com/x" → "example.com".
function SiteBlacklist() {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const saved = useRef("");
  const load = useCallback(() => {
    STORE.get([SITE_BLACKLIST_KEY], (r) => {
      saved.current = normalizeSiteList(r[SITE_BLACKLIST_KEY]).join("\n");
      // A field being typed in is left alone — it re-syncs once it loses focus.
      if (document.activeElement !== field.current) setText(saved.current);
    });
  }, []);
  useEffect(() => {
    load();
    return subscribe([SITE_BLACKLIST_KEY], load);
  }, [load]);
  const commit = (value: string) => {
    const list = normalizeSiteList(value.split(/[\s,;]+/));
    const joined = list.join("\n");
    setText(joined);
    if (joined === saved.current) return;
    saved.current = joined;
    STORE.set({ [SITE_BLACKLIST_KEY]: list }, (ok) => {
      if (ok === false) load();
    });
  };
  return (
    <textarea
      ref={field}
      id="siteBlacklist"
      className="opt-textarea"
      rows={4}
      spellCheck={false}
      placeholder="example.com"
      aria-label={msg("optSitesLabel") || "Disabled sites"}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}

function GlassOpacity() {
  const [v, setV] = useState(DEFAULT_GLASS_OPACITY);
  useEffect(() => {
    STORE.get([GLASS_OPACITY_KEY], (r) => setV(clampGlassOpacity(r[GLASS_OPACITY_KEY])));
  }, []);
  const preview = (n: number) => {
    const c = clampGlassOpacity(n);
    setV(c);
    applyGlassOpacity(document.documentElement, c); // live preview on this page
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
        onChange={preview}
        onCommit={(n) => STORE.set({ [GLASS_OPACITY_KEY]: clampGlassOpacity(n) })}
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
    timer.current = setTimeout(() => set(null), 1500);
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
    reader.onerror = () => flash(setImp, "optImportError", false);
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
      const data = importableSettings(parsed as Record<string, unknown>);
      // Nothing recognisable (an empty or unrelated file) must not go on to treat
      // every current setting as stale and wipe it.
      if (!Object.keys(data).length || hasPresetArrayMismatch(data)) {
        flash(setImp, "optImportError", false);
        return;
      }
      STORE.get(null, (current) => {
        const stale = Object.keys(current).filter(
          (key) => Object.hasOwn(KEY_CATEGORY, key) && !(key in data),
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
          STORE.removeEverywhere(stale, (ok) => {
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
      <div className="opt-field">
        <span className="opt-field-text">
          <span className="opt-field-label">
            {msg("optSponsorLabel") || "SponsorBlock markers"}
          </span>
          <span className="opt-field-desc">{msg("optSponsorHint")}</span>
        </span>
        <SponsorSwitch />
      </div>
      <div className="opt-field opt-field-block">
        <span className="opt-field-text">
          <span className="opt-field-label">{msg("optSitesLabel") || "Disabled sites"}</span>
          <span className="opt-field-desc">{msg("optSitesHint")}</span>
        </span>
        <SiteBlacklist />
      </div>
    </Group>
  );
}
