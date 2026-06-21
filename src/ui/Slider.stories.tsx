import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "./Slider.js";

function ControlledSlider({ animate }: { animate?: boolean }) {
  const [value, setValue] = useState(100);
  return (
    <div style={{ width: 280 }}>
      <Slider
        className="speed-slider"
        min={0}
        max={500}
        step={5}
        value={value}
        animate={animate}
        ariaLabel="Speed"
        onChange={setValue}
        onCommit={setValue}
      />
      {animate && (
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setValue(50)}>
            50%
          </button>
          <button type="button" onClick={() => setValue(100)}>
            100%
          </button>
          <button type="button" onClick={() => setValue(300)}>
            300%
          </button>
        </div>
      )}
    </div>
  );
}

const meta = {
  title: "Base/Slider",
  component: ControlledSlider,
} satisfies Meta<typeof ControlledSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { animate: false },
};

// The `animate` glide: pressing a preset button glides the thumb instead of
// snapping. Collapses to a snap under prefers-reduced-motion.
export const AnimatedGlide: Story = {
  args: { animate: true },
};
