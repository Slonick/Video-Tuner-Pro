import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch.js";
import { Slider } from "./Slider.js";

// No component file — this story showcases the frosted-glass surface itself
// (the `.sync-section` card chrome from sections.css + glass.css) using plain
// markup. It pairs the base Switch/Slider so the card reads like a real panel.
function GlassCard() {
  const [enabled, setEnabled] = useState(true);
  const [value, setValue] = useState(150);
  return (
    <div className="sync-section" style={{ width: 320 }}>
      <div className="sec-head">
        <div className="sec-text">
          <span className="sec-title-row">
            <strong>Playback speed</strong>
          </span>
          <span className="switch-sub">Frosted glass surface demo</span>
        </div>
        <Switch checked={enabled} onChange={setEnabled} />
      </div>
      <div style={{ marginTop: 12 }}>
        <Slider
          className="speed-slider"
          min={0}
          max={500}
          step={5}
          value={value}
          ariaLabel="Speed"
          onChange={setValue}
          onCommit={setValue}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Base/GlassCard",
  component: GlassCard,
} satisfies Meta<typeof GlassCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
