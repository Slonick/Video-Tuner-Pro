import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlassBackdrop } from "./GlassBackdrop.js";

const meta = {
  title: "Base/GlassBackdrop",
  component: GlassBackdrop,
} satisfies Meta<typeof GlassBackdrop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
