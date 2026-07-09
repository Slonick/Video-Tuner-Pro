// Saved scoped settings manager: lists everything saved by scope (global /
// per-site / per-channel) and lets you forget any single value or a whole
// category. Mirrors the old saved.ts behaviour for speed/delay, plus newer
// scoped viewer settings.
import { useCallback, useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import { Group as SettingsGroup } from "../Group.js";
import { Button } from "../../ui/Button.js";
import { ConfirmButton } from "../../ui/ConfirmButton.js";
import {
  clearStoredMap,
  mutateStoredMap,
  STORED_MAP_NAMES,
  type StoredMapName,
} from "../../shared/map-mutation.js";

type NumMap = Record<string, number>;
type StrMap = Record<string, string>;
type AutoSlowMap = Record<string, AutoSlowSaved>;
type AutoSlowSaved = { on?: boolean; target?: number };

const pct = (v: number) => Math.round(v * 100) + "%";
const secs = (v: number) => v + " " + (msg("secondsShort") || "s");
const viewerAuto = (v: string) =>
  msg(
    v === "normal" ? "viewerAutoNormal" : v === "theater" ? "viewerAutoTheater" : "overlayBtnOff",
  ) || v;
const viewerFit = (v: string) =>
  msg(v === "cover" ? "viewerFitCover" : v === "fill" ? "viewerFitFill" : "viewerFitContain") || v;
const autoSlow = (v: AutoSlowSaved) => `${Number(v.target ?? 6).toFixed(1)}/s`;

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
  globalAutoSlow?: AutoSlowSaved;
  siteAutoSlow: AutoSlowMap;
  chanAutoSlow: AutoSlowMap;
  globalViewerAuto?: string;
  siteViewerAuto: StrMap;
  chanViewerAuto: StrMap;
  globalViewerFit?: string;
  siteViewerFit: StrMap;
  chanViewerFit: StrMap;
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
        "autoSlowGlobal",
        "autoSlowSites",
        "autoSlowChannels",
        "viewerAutoGlobal",
        "viewerAuto",
        "viewerAutoSites",
        "viewerAutoChannels",
        "viewerFitGlobal",
        "viewerFitSites",
        "viewerFitChannels",
      ],
      (r) =>
        setData({
          globalSpeed: r.globalSpeed as number | undefined,
          domains: (r.domains || {}) as NumMap,
          channels: (r.channels || {}) as NumMap,
          globalDelay: (r.syncTargetGlobal ?? r.liveSyncTarget) as number | undefined,
          siteDelays: (r.syncTargets || {}) as NumMap,
          chanDelays: (r.syncTargetChannels || {}) as NumMap,
          globalAutoSlow: r.autoSlowGlobal as AutoSlowSaved | undefined,
          siteAutoSlow: (r.autoSlowSites || {}) as AutoSlowMap,
          chanAutoSlow: (r.autoSlowChannels || {}) as AutoSlowMap,
          globalViewerAuto: (r.viewerAutoGlobal ?? r.viewerAuto) as string | undefined,
          siteViewerAuto: (r.viewerAutoSites || {}) as StrMap,
          chanViewerAuto: (r.viewerAutoChannels || {}) as StrMap,
          globalViewerFit: r.viewerFitGlobal as string | undefined,
          siteViewerFit: (r.viewerFitSites || {}) as StrMap,
          chanViewerFit: (r.viewerFitChannels || {}) as StrMap,
        }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;

  // Remove one key from a stored map (or clear a scalar) then re-render.
  const deleteFromMap = (storeKey: StoredMapName, mapKey: string) =>
    mutateStoredMap(storeKey, {}, [mapKey], load);
  const removeKeys = (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const maps = list.filter((key): key is StoredMapName =>
      (STORED_MAP_NAMES as readonly string[]).includes(key),
    );
    const scalars = list.filter((key) => !maps.includes(key as StoredMapName));
    let pending = maps.length + (scalars.length ? 1 : 0);
    if (!pending) {
      load();
      return;
    }
    const done = () => {
      if (--pending === 0) load();
    };
    for (const map of maps) clearStoredMap(map, done);
    if (scalars.length) STORE.remove(scalars, done);
  };

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

  const autoSlowGlobal: Row[] =
    data.globalAutoSlow != null
      ? [
          {
            name: globalName,
            chips: [
              {
                label: autoSlow(data.globalAutoSlow),
                onDelete: () => removeKeys("autoSlowGlobal"),
              },
            ],
          },
        ]
      : [];
  const autoSlowSites: Row[] = Object.keys(data.siteAutoSlow)
    .map((host) => ({
      name: host,
      chips: [
        {
          label: autoSlow(data.siteAutoSlow[host]),
          onDelete: () => deleteFromMap("autoSlowSites", host),
        },
      ],
    }))
    .sort(byName);
  const autoSlowChans: Row[] = Object.keys(data.chanAutoSlow)
    .map((key) => ({
      name: prettyChannel(key),
      chips: [
        {
          label: autoSlow(data.chanAutoSlow[key]),
          onDelete: () => deleteFromMap("autoSlowChannels", key),
        },
      ],
    }))
    .sort(byName);

  const viewerAutoGlobal: Row[] =
    data.globalViewerAuto != null
      ? [
          {
            name: globalName,
            chips: [
              {
                label: viewerAuto(data.globalViewerAuto),
                onDelete: () => removeKeys(["viewerAutoGlobal", "viewerAuto"]),
              },
            ],
          },
        ]
      : [];
  const viewerAutoSites: Row[] = Object.keys(data.siteViewerAuto)
    .map((host) => ({
      name: host,
      chips: [
        {
          label: viewerAuto(data.siteViewerAuto[host]),
          onDelete: () => deleteFromMap("viewerAutoSites", host),
        },
      ],
    }))
    .sort(byName);
  const viewerAutoChans: Row[] = Object.keys(data.chanViewerAuto)
    .map((key) => ({
      name: prettyChannel(key),
      chips: [
        {
          label: viewerAuto(data.chanViewerAuto[key]),
          onDelete: () => deleteFromMap("viewerAutoChannels", key),
        },
      ],
    }))
    .sort(byName);

  const viewerFitGlobal: Row[] =
    data.globalViewerFit != null
      ? [
          {
            name: globalName,
            chips: [
              {
                label: viewerFit(data.globalViewerFit),
                onDelete: () => removeKeys("viewerFitGlobal"),
              },
            ],
          },
        ]
      : [];
  const viewerFitSites: Row[] = Object.keys(data.siteViewerFit)
    .map((host) => ({
      name: host,
      chips: [
        {
          label: viewerFit(data.siteViewerFit[host]),
          onDelete: () => deleteFromMap("viewerFitSites", host),
        },
      ],
    }))
    .sort(byName);
  const viewerFitChans: Row[] = Object.keys(data.chanViewerFit)
    .map((key) => ({
      name: prettyChannel(key),
      chips: [
        {
          label: viewerFit(data.chanViewerFit[key]),
          onDelete: () => deleteFromMap("viewerFitChannels", key),
        },
      ],
    }))
    .sort(byName);

  return (
    <SettingsGroup
      head={<h2 className="opt-group-title">{msg("optSavedTitle") || "Saved speeds & delays"}</h2>}
    >
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
        <Category
          titleKey="autoSlowLabel"
          onReset={() => removeKeys(["autoSlowGlobal", "autoSlowSites", "autoSlowChannels"])}
          groups={[
            ["optSavedGlobal", autoSlowGlobal],
            ["optSavedSites", autoSlowSites],
            ["optSavedChannels", autoSlowChans],
          ]}
        />
        <Category
          titleKey="optViewerAutoLabel"
          onReset={() =>
            removeKeys(["viewerAutoGlobal", "viewerAuto", "viewerAutoSites", "viewerAutoChannels"])
          }
          groups={[
            ["optSavedGlobal", viewerAutoGlobal],
            ["optSavedSites", viewerAutoSites],
            ["optSavedChannels", viewerAutoChans],
          ]}
        />
        <Category
          titleKey="viewerFitAria"
          onReset={() => removeKeys(["viewerFitGlobal", "viewerFitSites", "viewerFitChannels"])}
          groups={[
            ["optSavedGlobal", viewerFitGlobal],
            ["optSavedSites", viewerFitSites],
            ["optSavedChannels", viewerFitChans],
          ]}
        />
      </div>
    </SettingsGroup>
  );
}
