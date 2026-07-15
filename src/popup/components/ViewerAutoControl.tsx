import { memo, useEffect, useRef, useState } from "react";
import { Segmented } from "../../ui/Segmented.js";
import { Switch } from "../../ui/Switch.js";
import { Button } from "../../ui/Button.js";
import { msg } from "../i18n.js";
import { useStored } from "../hooks/useStored.js";
import { STORE } from "../platform/storage.js";
import { SaveScope } from "./SaveScope.js";
import { InfoTip } from "./InfoTip.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import type { UseViewerAuto, ViewerAutoMode } from "../hooks/useViewerAuto.js";
import type { UseViewerFit, ViewerFitMode } from "../hooks/useViewerFit.js";

interface Props {
  viewerAuto: UseViewerAuto;
  viewerFit: UseViewerFit;
  blocked?: boolean;
  blockedMessage?: string;
  forceOpen?: boolean;
}

const VIEWER_AUTO_LABEL: Record<ViewerAutoMode, string> = {
  off: "overlayBtnOff",
  normal: "viewerAutoNormal",
  theater: "viewerAutoTheater",
};
const VIEWER_FIT_MODES: ViewerFitMode[] = ["contain", "cover", "fill"];
const VIEWER_FIT_LABEL: Record<ViewerFitMode, string> = {
  contain: "viewerFitContain",
  cover: "viewerFitCover",
  fill: "viewerFitFill",
};

export const ViewerAutoControl = memo(function ViewerAutoControl({
  viewerAuto: va,
  viewerFit: fit,
  blocked = false,
  blockedMessage,
  forceOpen,
}: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [backdropVideo, setBackdropVideoState] = useState(false);
  const [playbackOnly, setPlaybackOnlyState] = useState(false);
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, !blocked && va.enabled);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);
  const label = msg("viewerModesLabel") || "Viewer modes";
  const autoLabel = msg("optViewerAutoLabel") || "Auto-open selected mode";
  const backdropLabel = msg("viewerBackdropVideo") || "Background video";
  const autoOpen = va.mode !== "off";

  useStored(["viewerBackdropVideo", "viewerAutoPlaybackOnly"], (r) => {
    setBackdropVideoState(r.viewerBackdropVideo === true);
    setPlaybackOnlyState(r.viewerAutoPlaybackOnly === true);
  });

  const setEnabled = (on: boolean) => {
    if (blocked) return;
    va.setEnabled(on);
  };

  const setBackdropVideo = (on: boolean) => {
    if (blocked) return;
    const prev = backdropVideo;
    setBackdropVideoState(on);
    STORE.set({ viewerBackdropVideo: on }, (ok) => {
      if (ok === false) setBackdropVideoState(prev);
    });
  };
  const setPlaybackOnly = (value: string) => {
    if (blocked || !va.enabled || !autoOpen) return;
    const next = value === "playing";
    const prev = playbackOnly;
    setPlaybackOnlyState(next);
    STORE.set({ viewerAutoPlaybackOnly: next }, (ok) => {
      if (ok === false) setPlaybackOnlyState(prev);
    });
  };
  const selectedAutoMode = (): ViewerAutoMode =>
    va.pageMode === "normal" || va.pageMode === "theater" ? va.pageMode : "normal";
  const setAutoOpen = (on: boolean) => {
    if (blocked || !va.enabled) return;
    va.setMode(on ? selectedAutoMode() : "off");
  };
  const setPageMode = (mode: ViewerAutoMode) => {
    if (blocked || !va.enabled) return;
    va.setPageMode(mode);
    if (autoOpen && mode !== "off") va.setMode(mode);
  };

  return (
    <div ref={slotRef} className="viewer-auto-slot card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section viewer-auto-section overlay-card" +
          (open ? " is-overlay" : "") +
          (blocked || !va.enabled ? " locked" : "")
        }
      >
        <div className="sec-head">
          <Button className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{label}</strong>
              </span>
              <span className="switch-sub">
                {va.enabled
                  ? `${msg(VIEWER_AUTO_LABEL[va.pageMode])} · ${
                      va.scope === "channel"
                        ? va.channelName || msg("scopeThisChannel")
                        : va.scope === "site"
                          ? msg("scopeThisSite")
                          : va.scope === "global"
                            ? msg("scopeEverywhere")
                            : autoOpen
                              ? autoLabel
                              : msg("viewerModesHint")
                    }`
                  : blocked
                    ? blockedMessage || msg("viewerDrmBlocked") || "Viewer unavailable"
                    : msg("viewerModesHint")}
              </span>
            </span>
          </Button>
          <Switch
            id="viewerAutoToggle"
            checked={va.enabled}
            ariaLabel={label}
            disabled={blocked}
            onChange={setEnabled}
          />
        </div>

        <div className="card-scroll">
          <div className={"sync-body viewer-auto-body" + (open ? " open" : "")}>
            <div
              id="viewerAutoVisual"
              className="viewer-auto-visual"
              role="group"
              aria-label={label}
            >
              <div className="viewer-mode-grid" role="radiogroup" aria-label={label}>
                <button
                  type="button"
                  className={
                    "viewer-auto-state is-page" + (va.pageMode === "off" ? " is-active" : "")
                  }
                  role="radio"
                  aria-checked={va.pageMode === "off"}
                  disabled={blocked || !va.enabled}
                  onClick={() => setPageMode("off")}
                >
                  <span className="viewer-auto-window">
                    <span className="viewer-auto-video" />
                    <span className="viewer-auto-lines">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="viewer-auto-choice">{msg("overlayBtnOff") || "Off"}</span>
                </button>
                <button
                  type="button"
                  className={
                    "viewer-auto-state is-viewer" + (va.pageMode === "normal" ? " is-active" : "")
                  }
                  role="radio"
                  aria-checked={va.pageMode === "normal"}
                  disabled={blocked || !va.enabled}
                  onClick={() => setPageMode("normal")}
                >
                  <span className="viewer-auto-window viewer-auto-overlay-window">
                    <span className="viewer-auto-video" />
                  </span>
                  <span className="viewer-auto-choice">{msg("viewerAutoNormal") || "Viewer"}</span>
                </button>
                <button
                  type="button"
                  className={
                    "viewer-auto-state is-theater" + (va.pageMode === "theater" ? " is-active" : "")
                  }
                  role="radio"
                  aria-checked={va.pageMode === "theater"}
                  disabled={blocked || !va.enabled}
                  onClick={() => setPageMode("theater")}
                >
                  <span className="viewer-auto-window">
                    <span className="viewer-auto-video" />
                  </span>
                  <span className="viewer-auto-choice">
                    {msg("viewerAutoTheater") || "Theater"}
                  </span>
                </button>
              </div>
              <div className="viewer-mode-option">
                <span className="viewer-mode-copy">
                  <span className="viewer-mode-title">
                    <strong>{autoLabel}</strong>
                    <InfoTip beta tip={msg("betaNote")} />
                  </span>
                  <span>{msg("optViewerAutoHint")}</span>
                </span>
                <Switch
                  id="viewerAutoModeToggle"
                  checked={autoOpen}
                  ariaLabel={autoLabel}
                  disabled={blocked || !va.enabled}
                  onChange={setAutoOpen}
                />
              </div>
              <Segmented
                id="viewerAutoPlaybackSeg"
                className="seg viewer-auto-seg viewer-auto-playback-seg"
                ariaLabel={msg("viewerAutoBehavior") || "Automatic mode behavior"}
                disabled={blocked || !va.enabled || !autoOpen}
                items={[
                  { value: "always", label: msg("viewerAutoAlways") || "Always" },
                  {
                    value: "playing",
                    label: msg("viewerAutoWhilePlaying") || "While playing",
                  },
                ]}
                value={playbackOnly ? "playing" : "always"}
                onChange={setPlaybackOnly}
              />
            </div>
            <div className="viewer-auto-save">
              <SaveScope
                scope={va.scope}
                saved={va.saved}
                savedValues={va.savedValues}
                currentValue={va.mode}
                fmtValue={(v) => msg(VIEWER_AUTO_LABEL[(v as ViewerAutoMode) || "off"])}
                hasChannel={!!va.channel}
                saveLabel={msg("rememberButton")}
                savedLabel={msg("savedFeedback")}
                onSave={va.save}
                onReset={va.resetScope}
                onPick={va.pickScope}
                saveId="viewerAutoSetBtn"
                resetId="viewerAutoResetBtn"
                disabled={blocked || !va.enabled}
              />
            </div>
            <div className="viewer-backdrop-option">
              <span className="viewer-backdrop-copy">
                <strong>{backdropLabel}</strong>
                <span>{msg("viewerBackdropVideoHint") || "Mirror it under the Viewer glass"}</span>
              </span>
              <Switch
                id="viewerBackdropVideoToggle"
                checked={backdropVideo}
                ariaLabel={backdropLabel}
                disabled={blocked || !va.enabled}
                onChange={setBackdropVideo}
              />
            </div>
            {blocked && (
              <div className="viewer-drm-note" role="status">
                {blockedMessage || msg("viewerDrmBlocked") || "Viewer unavailable"}
              </div>
            )}
            <Segmented
              id="viewerFitSeg"
              className="seg viewer-auto-seg"
              ariaLabel={msg("viewerFitAria") || "Fill mode"}
              disabled={blocked || !va.enabled}
              items={VIEWER_FIT_MODES.map((m) => ({
                value: m,
                label: msg(VIEWER_FIT_LABEL[m]) || m,
              }))}
              value={fit.mode}
              onChange={fit.setMode}
            />
            <div className="viewer-auto-save">
              <SaveScope
                scope={fit.scope}
                saved={fit.saved}
                savedValues={fit.savedValues}
                currentValue={fit.mode}
                fmtValue={(v) => msg(VIEWER_FIT_LABEL[(v as ViewerFitMode) || "contain"])}
                hasChannel={!!fit.channel}
                saveLabel={msg("rememberButton")}
                savedLabel={msg("savedFeedback")}
                onSave={fit.save}
                onReset={fit.resetScope}
                onPick={fit.pickScope}
                saveId="viewerFitSetBtn"
                resetId="viewerFitResetBtn"
                disabled={blocked || !va.enabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
