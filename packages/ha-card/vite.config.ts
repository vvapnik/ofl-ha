import { defineConfig } from "vite";

// Builds one self-contained ES module straight into the integration, which
// serves it and registers it on every dashboard (custom_components/ofl/__init__.py)
// — no manual Lovelace resource needed.
export default defineConfig({
  build: {
    lib: {
      entry: "src/ofl-garden-card.ts",
      formats: ["es"],
      fileName: () => "ofl-garden-card.js",
    },
    outDir: "../../custom_components/ofl/frontend",
    emptyOutDir: false,
    target: "es2021",
    minify: true,
  },
});
