import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton.js";

// A minus glyph stands in for the card icons (which live in the popup bundle).
const Glyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="3" y="7" width="10" height="2" rx="1" />
  </svg>
);

const meta = {
  title: "Base/IconButton",
  component: IconButton,
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Spin: Story = {
  args: { className: "spin", "aria-label": "Slower", children: <Glyph /> },
};
