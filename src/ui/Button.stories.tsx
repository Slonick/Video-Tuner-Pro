import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";

const meta = {
  title: "Base/Button",
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: { variant: "neutral", children: "Reset" },
};

export const Primary: Story = {
  args: { variant: "primary", children: "Save" },
};
