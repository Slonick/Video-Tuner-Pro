// Keyboard-shortcut editor: click an action's key, then press the new one.
// Stores KeyboardEvent.code values under "keymap"; the content listener picks it
// up live. Mirrors the old keys.ts behaviour.
import { useCallback, useEffect, useRef, useState } from "react";
import { STORE, subscribe } from "../../shared/store.js";
import {
  normalizeKeymap,
  DEFAULT_KEYMAP,
  isBindableCode,
  codeLabel,
  ACTIONS,
  actionConflictsWithSpec,
  type Action,
  type Keymap,
} from "../../shared/keymap.js";
import { msg } from "../../popup/i18n.js";
import { Group } from "../Group.js";
import { Button } from "../../ui/Button.js";
import { Switch } from "../../ui/Switch.js";
import { ConfirmButton } from "../../ui/ConfirmButton.js";

const ROWS: Array<{ action: Action; labelKey: string }> = [
  { action: "slower", labelKey: "tipSlower" },
  { action: "faster", labelKey: "tipFaster" },
  { action: "reset", labelKey: "optKeyReset" },
  { action: "toggle", labelKey: "optKeyToggle" },
  { action: "hold", labelKey: "optKeyHold" },
  { action: "overlay", labelKey: "optKeyOverlay" },
  { action: "viewer", labelKey: "optKeyViewer" },
  { action: "theater", labelKey: "optKeyTheater" },
];

export function Keys() {
  const [keymap, setKeymap] = useState<Keymap>({ ...DEFAULT_KEYMAP });
  const [capturing, setCapturing] = useState<Action | null>(null);
  const [dupe, setDupe] = useState<Action | null>(null);
  // Live refs so the global keydown handler (bound once) sees current state.
  const capRef = useRef<Action | null>(null);
  const mapRef = useRef<Keymap>(keymap);
  const presetKeysRef = useRef<Array<string | null>>([]);
  const dupeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The key each action had before it was switched off, so flipping it back on
  // restores it (within the session) instead of jumping to the default.
  const lastKey = useRef<Partial<Record<Action, string>>>({});
  capRef.current = capturing;
  mapRef.current = keymap;

  const loadKeys = useCallback(() => {
    STORE.get(["keymap", "presetKeys"], (r) => {
      const km = normalizeKeymap(r.keymap);
      for (const a of ACTIONS) if (km[a]) lastKey.current[a] = km[a];
      setKeymap(km);
      presetKeysRef.current = Array.isArray(r.presetKeys) ? r.presetKeys : [];
    });
  }, []);

  useEffect(loadKeys, [loadKeys]);

  useEffect(() => subscribe(["keymap", "presetKeys"], loadKeys), [loadKeys]);

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
      // Backspace/Delete unbinds the action (it then does nothing).
      if (e.code === "Backspace" || e.code === "Delete") {
        const next = { ...mapRef.current, [cap]: "" };
        setKeymap(next);
        setCapturing(null);
        STORE.set({ keymap: next });
        return;
      }
      if (!isBindableCode(e.code)) {
        reject(cap);
        return;
      }
      if (
        ACTIONS.some((a) => a !== cap && mapRef.current[a] === e.code) ||
        presetKeysRef.current.some((spec) => actionConflictsWithSpec(cap, e.code, spec))
      ) {
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

  // Enable/disable an action via its switch. Off → remember the key, then unbind it
  // (the content listener ignores ""). On → restore the remembered key (or default).
  const toggleEnabled = (a: Action, on: boolean) => {
    let code = "";
    if (on) {
      const want = lastKey.current[a] || DEFAULT_KEYMAP[a];
      // Don't resurrect a key another action now holds — fall back to unbound.
      code =
        ACTIONS.some((o) => o !== a && keymap[o] === want) ||
        presetKeysRef.current.some((spec) => actionConflictsWithSpec(a, want, spec))
          ? ""
          : want;
    } else if (keymap[a]) {
      lastKey.current[a] = keymap[a];
    }
    const next = { ...keymap, [a]: code };
    setKeymap(next);
    setCapturing(null);
    STORE.set({ keymap: next });
  };

  return (
    <Group head={<h2 className="opt-group-title">{msg("kbdLabel") || "Keyboard shortcuts"}</h2>}>
      <div className="key-rows" id="keyRows">
        {ROWS.map(({ action, labelKey }) => (
          <div className="key-row" key={action}>
            <span className="key-label">{msg(labelKey)}</span>
            <span className="key-ctrl">
              <Button
                id={"key" + action[0].toUpperCase() + action.slice(1)}
                className={
                  "key-cap" +
                  (capturing === action ? " capturing" : "") +
                  (dupe === action ? " dupe" : "") +
                  (capturing !== action && !keymap[action] ? " is-off" : "")
                }
                data-action={action}
                onClick={() => setCapturing(action)}
              >
                {capturing === action
                  ? msg("optKeyPress") || "Press a key…"
                  : keymap[action]
                    ? codeLabel(keymap[action])
                    : msg("optKeyOff") || "Off"}
              </Button>
              <Switch
                checked={!!keymap[action]}
                onChange={(on) => toggleEnabled(action, on)}
                ariaLabel={msg(labelKey)}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="card-actions">
        <ConfirmButton
          className="btn-action btn-danger"
          onConfirm={resetDefaults}
          confirmChildren={msg("optConfirm") || "Click again to confirm"}
          confirmTitle={msg("optConfirm") || "Click again to confirm"}
        >
          {msg("optResetDefaults") || "Reset to defaults"}
        </ConfirmButton>
      </div>
    </Group>
  );
}
