import type { Plugin } from "vite";
import type { StorybookConfig } from "@storybook/react-vite";

// The source uses `.js` import suffixes that resolve to sibling `.tsx`/`.ts`
// files (the same convention esbuild handles in build.mjs). Vite doesn't do
// this out of the box, so rewrite a relative `./foo.js` import to `./foo.tsx`
// (or `.ts`) when only the TypeScript source exists.
function jsToTsResolve(): Plugin {
  return {
    name: "js-to-ts-source-resolve",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      // Only rewrite imports between our own TypeScript sources. Vite's dep
      // optimizer pre-bundles deps into .cache/.../sb-vite/deps as relative
      // `.js` chunks; rewriting those to `.tsx` points at files that don't
      // exist and breaks the dev server (build-storybook has no optimizer, so
      // it was unaffected). Skip node_modules / the cache / virtual modules.
      if (
        importer.includes("\0") ||
        importer.includes("node_modules") ||
        importer.includes("/.cache/")
      ) {
        return null;
      }
      const base = source.slice(0, -3);
      for (const ext of [".tsx", ".ts"]) {
        const resolved = await this.resolve(base + ext, importer, { skipSelf: true });
        if (resolved) return resolved;
      }
      return null;
    },
  };
}

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(tsx|ts)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(cfg) {
    cfg.plugins = [jsToTsResolve(), ...(cfg.plugins ?? [])];
    return cfg;
  },
};

export default config;
