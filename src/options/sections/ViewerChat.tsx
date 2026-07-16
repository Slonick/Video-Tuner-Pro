// Stream-chat overlay panel tuning (the floating popout chat over the video in
// the pop-out viewer): background tint, message input on/off and panel size.
// The chat mode itself (off / side / overlay) is switched from the on-video
// button or the C hotkey. Values apply live — the content script re-styles a
// mounted panel and its skinned chat frame on change.
import { useEffect, useState } from "react";
import { STORE, subscribe } from "../../shared/store.js";
import {
  CHAT_PANEL_HEIGHT,
  CHAT_PANEL_HEIGHT_MAX,
  CHAT_PANEL_HEIGHT_MIN,
  CHAT_PANEL_WIDTH,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_MIN,
} from "../../shared/chat-bounds.js";
import { msg } from "../../popup/i18n.js";
import { Group } from "../Group.js";
import { Slider } from "../../ui/Slider.js";
import { Switch } from "../../ui/Switch.js";

interface ScalarSpec {
  key: "viewerChatOpacity" | "viewerChatWidth" | "viewerChatHeight";
  min: number;
  max: number;
  step: number;
  def: number;
  labelKey: string;
  labelFallback: string;
  fmt: (v: number) => string;
}

const SCALARS: ScalarSpec[] = [
  {
    key: "viewerChatOpacity",
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.4,
    labelKey: "optChatOpacityLabel",
    labelFallback: "Background opacity",
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "viewerChatWidth",
    min: CHAT_PANEL_WIDTH_MIN,
    max: CHAT_PANEL_WIDTH_MAX,
    step: 10,
    def: CHAT_PANEL_WIDTH,
    labelKey: "optChatWidthLabel",
    labelFallback: "Panel width",
    fmt: (v) => `${v}px`,
  },
  {
    key: "viewerChatHeight",
    min: CHAT_PANEL_HEIGHT_MIN,
    max: CHAT_PANEL_HEIGHT_MAX,
    step: 10,
    def: CHAT_PANEL_HEIGHT,
    labelKey: "optChatHeightLabel",
    labelFallback: "Panel height",
    fmt: (v) => `${v}px`,
  },
];

function clampSpec(spec: ScalarSpec, raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : spec.def;
  return Math.min(spec.max, Math.max(spec.min, n));
}

function ChatScalar({ spec }: { spec: ScalarSpec }) {
  const [v, setV] = useState(spec.def);
  useEffect(() => {
    const read = () => STORE.get([spec.key], (r) => setV(clampSpec(spec, r[spec.key])));
    read();
    // The panel's own resize handle writes width/height back — mirror it here.
    return subscribe([spec.key], read);
  }, [spec]);
  const label = msg(spec.labelKey) || spec.labelFallback;
  const onChange = (n: number) => {
    const c = clampSpec(spec, n);
    setV(c);
    STORE.set({ [spec.key]: c });
  };
  return (
    <div className="opt-field opt-field-block">
      <span className="opt-field-label">{label}</span>
      <div className="opt-glass-slider">
        <Slider
          className="opt-slider"
          id={spec.key}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={v}
          ariaLabel={label}
          onChange={onChange}
        />
        <b className="opt-param-val">{spec.fmt(v)}</b>
      </div>
    </div>
  );
}

function ChatInputSwitch() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    STORE.get(["viewerChatInput"], (r) => setOn(r.viewerChatInput !== false));
  }, []);
  const label = msg("optChatInputLabel") || "Message input";
  const toggle = (next: boolean) => {
    setOn(next);
    STORE.set({ viewerChatInput: next });
  };
  return (
    <div className="opt-field">
      <span className="opt-field-text">
        <span className="opt-field-label">{label}</span>
        <span className="opt-field-desc">
          {msg("optChatInputHint") || "Show the send box in the overlay chat."}
        </span>
      </span>
      <Switch id="viewerChatInput" checked={on} ariaLabel={label} onChange={toggle} />
    </div>
  );
}

export function ViewerChat() {
  return (
    <Group
      head={<h2 className="opt-group-title">{msg("optChatTitle") || "Stream chat overlay"}</h2>}
    >
      <p className="opt-param-hint">
        {msg("optChatHint") || "Size and look of the floating chat panel in the pop-out viewer."}
      </p>
      {SCALARS.map((spec) => (
        <ChatScalar key={spec.key} spec={spec} />
      ))}
      <ChatInputSwitch />
    </Group>
  );
}
