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
  banner: ({ format }) => (format === "esm" ? { js: "#!/usr/bin/env node" } : {}),
});
