// Saved speeds & live-sync delays manager: lists everything saved by scope
// (global / per-site / per-channel) and lets you forget any single value or a
// whole category. Mirrors the old saved.ts behaviour.
import { useCallback, useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import { Button } from "../../ui/Button.js";
import { ConfirmButton } from "../../ui/ConfirmButton.js";

type NumMap = Record<string, number>;

const pct = (v: number) => Math.round(v * 100) + "%";
const secs = (v: number) => v + " " + (msg("secondsShort") || "s");

// Channel keys are stored as a stable id/handle/login (no display name is kept).
function prettyChannel(key: string): string {
  if (key.startsWith("twitch:")) return key.slice(7) + " (Twitch)";
  if (key.startsWith("channel/")) return key.slice(8);
  return key;
}

interface Data {
  globalSpeed?: number;
  domains: NumMap;
  channels: NumMap;
  globalDelay?: number;
  siteDelays: NumMap;
  chanDelays: NumMap;
}

interface Chip {
  label: string;
  onDelete: () => void;
}
interface Row {
  name: string;
  chips: Chip[];
}

function Group({ titleKey, rows }: { titleKey: string; rows: Row[] }) {
  return (
    <div className="saved-group">
      <div className="saved-group-title">{msg(titleKey) || titleKey}</div>
      {rows.map((r, i) => (
        <div className="saved-row" key={r.name + i}>
          <span className="saved-name" title={r.name}>
            {r.name}
          </span>
          {r.chips.map((c, j) => (
            <span className="saved-val" key={j}>
              <b>{c.label}</b>
              <Button
                className="saved-del"
                aria-label={msg("optDelete") || "Remove"}
                onClick={c.onDelete}
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Category({
  titleKey,
  onReset,
  groups,
}: {
  titleKey: string;
  onReset: () => void;
  groups: Array<[string, Row[]]>;
}) {
  const filled = groups.filter(([, rows]) => rows.length);
  return (
    <div className="saved-cat">
      <div className="saved-cat-title">{msg(titleKey) || titleKey}</div>
      {filled.length ? (
        <>
          {filled.map(([k, rows]) => (
            <Group key={k} titleKey={k} rows={rows} />
          ))}
          <div className="card-actions">
            <ConfirmButton
              className="btn-action btn-danger"
              onConfirm={onReset}
              confirmChildren={msg("optConfirm") || "Click again to confirm"}
              confirmTitle={msg("optConfirm") || "Click again to confirm"}
            >
              {msg("optResetDefaults") || "Reset to defaults"}
            </ConfirmButton>
          </div>
        </>
      ) : (
        <div className="saved-empty">{msg("optSavedEmpty") || "Nothing saved yet."}</div>
      )}
    </div>
  );
}

export function Saved() {
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(() => {
    STORE.get(
      [
        "globalSpeed",
        "domains",
        "channels",
        "syncTargetGlobal",
        "liveSyncTarget",
        "syncTargets",
        "syncTargetChannels",
      ],
      (r) =>
        setData({
          globalSpeed: r.globalSpeed as number | undefined,
          domains: (r.domains || {}) as NumMap,
          channels: (r.channels || {}) as NumMap,
          globalDelay: (r.syncTargetGlobal ?? r.liveSyncTarget) as number | undefined,
          siteDelays: (r.syncTargets || {}) as NumMap,
          chanDelays: (r.syncTargetChannels || {}) as NumMap,
        }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;

  // Remove one key from a stored map (or clear a scalar) then re-render.
  const deleteFromMap = (storeKey: string, mapKey: string) => {
    STORE.get([storeKey], (r) => {
      const map = { ...(r[storeKey] as NumMap | undefined) };
      delete map[mapKey];
      STORE.set({ [storeKey]: map }, load);
    });
  };
  const removeKeys = (keys: string | string[]) => STORE.remove(keys, load);

  const globalName = msg("scopeGlobal") || "Global";
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

  const speedGlobal: Row[] =
    data.globalSpeed != null
      ? [
          {
            name: globalName,
            chips: [{ label: pct(data.globalSpeed), onDelete: () => removeKeys("globalSpeed") }],
          },
        ]
      : [];
  const speedSites: Row[] = Object.keys(data.domains)
    .map((host) => ({
      name: host,
      chips: [{ label: pct(data.domains[host]), onDelete: () => deleteFromMap("domains", host) }],
    }))
    .sort(byName);
  const speedChans: Row[] = Object.keys(data.channels)
    .map((key) => ({
      name: prettyChannel(key),
      chips: [{ label: pct(data.channels[key]), onDelete: () => deleteFromMap("channels", key) }],
    }))
    .sort(byName);

  const delayGlobal: Row[] =
    data.globalDelay != null
      ? [
          {
            name: globalName,
            chips: [
              {
                label: secs(data.globalDelay),
                onDelete: () => removeKeys(["syncTargetGlobal", "liveSyncTarget"]),
              },
            ],
          },
        ]
      : [];
  const delaySites: Row[] = Object.keys(data.siteDelays)
    .map((host) => ({
      name: host,
      chips: [
        { label: secs(data.siteDelays[host]), onDelete: () => deleteFromMap("syncTargets", host) },
      ],
    }))
    .sort(byName);
  const delayChans: Row[] = Object.keys(data.chanDelays)
    .map((key) => ({
      name: prettyChannel(key),
      chips: [
        {
          label: secs(data.chanDelays[key]),
          onDelete: () => deleteFromMap("syncTargetChannels", key),
        },
      ],
    }))
    .sort(byName);

  return (
    <section className="card">
      <h2>{msg("optSavedTitle") || "Saved speeds & delays"}</h2>
      <p className="card-desc">{msg("optSavedDesc")}</p>
      <div id="savedLists">
        <Category
          titleKey="catSpeeds"
          onReset={() => removeKeys(["globalSpeed", "domains", "channels"])}
          groups={[
            ["optSavedGlobal", speedGlobal],
            ["optSavedSites", speedSites],
            ["optSavedChannels", speedChans],
          ]}
        />
        <Category
          titleKey="catDelays"
          onReset={() =>
            removeKeys(["syncTargetGlobal", "liveSyncTarget", "syncTargets", "syncTargetChannels"])
          }
          groups={[
            ["optSavedGlobal", delayGlobal],
            ["optSavedSites", delaySites],
            ["optSavedChannels", delayChans],
          ]}
        />
      </div>
    </section>
  );
}
