// Global tuning for live-stream catch-up. The on/off and the allowed delay are set
// per site/channel from the popup; this card holds the buffer reserve — the
// stall-safe cushion catch-up won't drain the buffer below — read live by the
// content tick (via storage.onChanged), so no reload is needed.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import { Group } from "../Group.js";
import { Slider } from "../../ui/Slider.js";

const clampNum = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

export function LiveSync() {
  const [reserve, setReserve] = useState(3);

  useEffect(() => {
    STORE.get(["liveSyncBufferReserve"], (r) => {
      setReserve(clampNum(r.liveSyncBufferReserve, 1, 10, 3));
    });
  }, []);

  return (
    <Group head={<h2 className="opt-group-title">{msg("optLiveSyncTitle") || "Live sync"}</h2>}>
      <div className="opt-params-grid">
        <div className="opt-param">
          <div className="opt-param-row">
            <span>{msg("optLiveSyncReserve") || "Buffer reserve"}</span>
            <b className="opt-param-val">{`${reserve.toFixed(1)} s`}</b>
          </div>
          <Slider
            className="opt-slider"
            id="liveSyncBufferReserve"
            min={1}
            max={10}
            step={0.5}
            tickStep={1}
            value={reserve}
            ariaLabel={msg("optLiveSyncReserve") || "Buffer reserve"}
            onChange={(v) => {
              const n = clampNum(v, 1, 10, 3);
              setReserve(n);
              STORE.set({ liveSyncBufferReserve: n });
            }}
          />
          <p className="opt-param-hint">
            {msg("optLiveSyncReserveHint") ||
              "The buffer catch-up won't drain below, so playback keeps a cushion and doesn't re-buffer. Lower catches up faster but risks stalls; higher is safer but slower."}
          </p>
        </div>
      </div>
    </Group>
  );
}
