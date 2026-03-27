import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";

const isObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === "object";

const monacoEditorPlugin = (isObject(monacoEditorPluginModule) &&
typeof monacoEditorPluginModule.default === "function"
  ? monacoEditorPluginModule.default
  : monacoEditorPluginModule) as unknown as typeof import("vite-plugin-monaco-editor").default;

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    vue(),
    VueDevTools(),
    tailwindcss(),
    monacoEditorPlugin({
      languageWorkers: ["json", "editorWorkerService"],
    }),
  ],
});
