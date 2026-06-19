// General card: theme (applies live), language (saves + reloads), and JSON
// backup export/import. Mirrors the old appearance.ts + backup.ts behaviour.
import { useEffect, useRef, useState } from "react";
import { STORE } from "../../shared/store.js";
import { THEMES, type Theme, setTheme } from "../../shared/theme.js";
import { LOCALES, LOCALE_NAMES, getLang, setLang, type Lang } from "../../shared/i18n-config.js";
import { SYNC_META_KEY } from "../../shared/sync-config.js";
import { msg } from "../../popup/i18n.js";
import { StoredToggle } from "../../popup/components/StoredToggle.js";

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
    <div className="seg" id="themeSeg">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className={"seg-btn" + (t === theme ? " is-active" : "")}
          onClick={() => pick(t)}
        >
          {msg(THEME_LABEL[t]) || t}
        </button>
      ))}
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
    <div className="lang-grid" id="langGrid">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={"seg-btn" + (value === lang ? " is-active" : "")}
          onClick={() => setLang(value, () => location.reload())}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Briefly turn a button green/red with a confirming label, then restore it.
type Flash = { key: string; ok: boolean } | null;

function Backup() {
  const [exp, setExp] = useState<Flash>(null);
  const [imp, setImp] = useState<Flash>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
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
      <button
        type="button"
        id="exportBtn"
        className={cls("btn-action btn-default", exp)}
        onClick={doExport}
      >
        {exp ? msg(exp.key) || exp.key : msg("optExport") || "Export…"}
      </button>
      <button
        type="button"
        id="importBtn"
        className={cls("btn-action btn-reset", imp)}
        onClick={() => fileRef.current?.click()}
      >
        {imp ? msg(imp.key) || imp.key : msg("optImport") || "Import…"}
      </button>
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
        <span className="opt-field-label">{msg("optLangLabel") || "Language"}</span>
        <LangGrid />
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
