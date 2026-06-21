import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch.js";

function ControlledSwitch({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} disabled={disabled} />;
}

const meta = {
  title: "Base/Switch",
  component: ControlledSwitch,
} satisfies Meta<typeof ControlledSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  args: { initial: false },
};

export const On: Story = {
  args: { initial: true },
};

export const Disabled: Story = {
  args: { initial: true, disabled: true },
};
