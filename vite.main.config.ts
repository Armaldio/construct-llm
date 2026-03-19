import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import pkg from "./package.json" assert { type: "json" };

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: "main",
    },
    rollupOptions: {
      external: [
        "electron",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        "bufferutil",
        "utf-8-validate",
        "@mastra/core",
        "@mastra/core/agent",
        "@mastra/rag",
        "@mastra/libsql",
        "@ai-sdk/mistral",
        "@libsql/client",
        "chokidar",
        "lodash",
        "@xenova/transformers",
      ],
    },
    minify: false,
  },
});
