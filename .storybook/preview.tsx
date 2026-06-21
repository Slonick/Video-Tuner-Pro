import type { Preview } from "@storybook/react-vite";
import { GlassBackdrop } from "../src/ui/GlassBackdrop.js";
import "../src/popup/popup.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
  decorators: [
    (Story) => (
      <>
        <GlassBackdrop />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: 24,
            color: "var(--text)",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <Story />
        </div>
      </>
    ),
  ],
};

export default preview;
