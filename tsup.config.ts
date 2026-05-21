import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/main.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  // Copy bundled skill assets (assets/skills/...) into dist/ so the published
  // package can resolve them at runtime via paths relative to dist/cli.js.
  publicDir: "assets",
  banner: ({ format }) => (format === "esm" ? { js: "#!/usr/bin/env node" } : {}),
});
