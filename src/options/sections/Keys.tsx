// Keyboard-shortcut editor: click an action's key, then press the new one.
// Stores KeyboardEvent.code values under "keymap"; the content listener picks it
// up live. Mirrors the old keys.ts behaviour.
import { useEffect, useRef, useState } from "react";
import { STORE } from "../../shared/store.js";
import {
  normalizeKeymap,
  DEFAULT_KEYMAP,
  isBindableCode,
  codeLabel,
  ACTIONS,
  type Action,
  type Keymap,
} from "../../shared/keymap.js";
import { msg } from "../../popup/i18n.js";

const ROWS: Array<{ action: Action; labelKey: string }> = [
  { action: "slower", labelKey: "tipSlower" },
  { action: "faster", labelKey: "tipFaster" },
  { action: "reset", labelKey: "optKeyReset" },
];

export function Keys() {
  const [keymap, setKeymap] = useState<Keymap>({ ...DEFAULT_KEYMAP });
  const [capturing, setCapturing] = useState<Action | null>(null);
  const [dupe, setDupe] = useState<Action | null>(null);
  // Live refs so the global keydown handler (bound once) sees current state.
  const capRef = useRef<Action | null>(null);
  const mapRef = useRef<Keymap>(keymap);
  const dupeTimer = useRef<ReturnType<typeof setTimeout>>();
  capRef.current = capturing;
  mapRef.current = keymap;

  useEffect(() => {
    STORE.get(["keymap"], (r) => setKeymap(normalizeKeymap(r.keymap)));
  }, []);

  useEffect(() => {
    const reject = (a: Action) => {
      setDupe(a);
      clearTimeout(dupeTimer.current);
      dupeTimer.current = setTimeout(() => setDupe(null), 600);
    };
    const onKey = (e: KeyboardEvent) => {
      const cap = capRef.current;
      if (!cap) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(null);
        return;
      }
      if (!isBindableCode(e.code)) {
        reject(cap);
        return;
      }
      if (ACTIONS.some((a) => a !== cap && mapRef.current[a] === e.code)) {
        reject(cap);
        return;
      }
      const next = { ...mapRef.current, [cap]: e.code };
      setKeymap(next);
      setCapturing(null);
      STORE.set({ keymap: next });
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(dupeTimer.current);
    };
  }, []);

  const resetDefaults = () => {
    const next = { ...DEFAULT_KEYMAP };
    setKeymap(next);
    setCapturing(null);
    STORE.set({ keymap: next });
  };

  return (
    <section className="card">
      <h2>{msg("kbdLabel") || "Keyboard shortcuts"}</h2>
      <p className="card-desc">{msg("optKeysDesc")}</p>
      <div className="key-rows" id="keyRows">
        {ROWS.map(({ action, labelKey }) => (
          <div className="key-row" key={action}>
            <span className="key-label">{msg(labelKey)}</span>
            <button
              type="button"
              id={"key" + action[0].toUpperCase() + action.slice(1)}
              className={
                "key-cap" +
                (capturing === action ? " capturing" : "") +
                (dupe === action ? " dupe" : "")
              }
              data-action={action}
              onClick={() => setCapturing(action)}
            >
              {capturing === action
                ? msg("optKeyPress") || "Press a key…"
                : codeLabel(keymap[action])}
            </button>
          </div>
        ))}
      </div>
      <div className="card-actions">
        <button type="button" className="btn-action btn-reset" onClick={resetDefaults}>
          {msg("optResetDefaults") || "Reset to defaults"}
        </button>
      </div>
    </section>
  );
}
