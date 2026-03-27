import { app } from "electron";
import path from "node:path";
import { LibSQLVector, LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { Workspace } from "@mastra/core/workspace";

export const globalDbPath = app.isPackaged
  ? path.join(process.resourcesPath, "prebuilt-assets.db")
  : path.join(process.cwd(), "prebuilt-assets.db");

export const globalStore = new LibSQLVector({
  id: "construct-projects",
  url: `file:${globalDbPath}`,
});

export const memoryStore = new LibSQLStore({
  id: "construct-memory",
  url: `file:${path.join(app.getPath("userData"), "construct-memory.db")}`,
});

export let projectStore: LibSQLVector | undefined;
export let agentMemory: Memory | undefined;
export let currentWorkspace: Workspace | null = null;

export function getProjectStore() {
  if (!projectStore) {
    throw new Error("No project store initialized. Please load a project first.");
  }
  return projectStore;
}

export function getAgentMemory() {
  if (!agentMemory) {
    throw new Error("No agent memory initialized. Please load a project first.");
  }
  return agentMemory;
}

export function setProjectStore(store: LibSQLVector) {
  projectStore = store;
}

export function setAgentMemory(memory: Memory) {
  agentMemory = memory;
}

export function setCurrentWorkspace(workspace: Workspace | null) {
  currentWorkspace = workspace;
}

export function getCurrentWorkspace() {
  return currentWorkspace;
}

// Embedding Model Logic
export const pendingEmbeddings = new Map<
  number,
  { resolve: (val: { embeddings: number[][] }) => void; reject: (err: Error) => void }
>();

let embeddingRequestId = 0;

export const embeddingModel = {
  specificationVersion: "v1",
  provider: "webgpu",
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxEmbeddingsPerCall: 100,
  async doEmbed({ values }: { values: string[] }) {
    if (!globalMainWindow) {
      throw new Error("Cannot compute embeddings: UI window is not ready.");
    }
    return new Promise((resolve, reject) => {
      const id = ++embeddingRequestId;
      pendingEmbeddings.set(id, { resolve, reject });
      globalMainWindow!.webContents.send("request-embedding", { id, texts: values });
    });
  },
} as any;

// A global reference to be set by the main index
let globalMainWindow: any = null;
export function setGlobalMainWindow(window: any) {
  globalMainWindow = window;
}
export function getGlobalMainWindow() {
  return globalMainWindow;
}
