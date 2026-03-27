console.log("[DEBUG] Preload script starting at:", new Date().toISOString());
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  getAppState: () => ipcRenderer.invoke("get-app-state"),
  updateAppState: (state: unknown) => ipcRenderer.invoke("update-app-state", state),
  isStartupComplete: () => ipcRenderer.invoke("is-startup-complete"),
  selectProject: () => ipcRenderer.invoke("select-project"),
  deleteProject: (id: string) => ipcRenderer.invoke("delete-project", id),
  forceReindex: () => ipcRenderer.invoke("force-reindex"),
  saveApiKeys: (keys: Record<string, string>) => ipcRenderer.invoke("save-api-keys", keys),
  getProjectTree: () => ipcRenderer.invoke("get-project-tree"),
  getFileContent: (path: string) => ipcRenderer.invoke("get-file-content", path),
  askQuestion: (data: { text: string; threadId: string; modelConfig: unknown; agentId: string }) =>
    ipcRenderer.invoke("ask-question", data),
  generateTitle: (data: { userMessage: string; assistantResponse: string; modelConfig: unknown }) =>
    ipcRenderer.invoke("generate-title", data),

  onIndexingStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on("indexing-status", (_event, data) => callback(data));
  },
  onAgentReflection: (callback: (data: unknown) => void) => {
    ipcRenderer.on("agent-reflection", (_event, data) => callback(data));
  },
  onAgentChunk: (callback: (chunk: string | { text: string; metadata?: unknown }) => void) => {
    ipcRenderer.on("agent-chunk", (_event, chunk) => callback(chunk as any)); // callback expects string in some places, object in others. using cast for bridge compatibility
  },
  onStartupProgress: (callback: (data: unknown) => void) => {
    ipcRenderer.on("startup-progress", (_event, data) => callback(data));
  },
  onStartupComplete: (callback: () => void) => {
    ipcRenderer.on("startup-complete", (_event) => callback());
  },
  onEmbeddingRequest: (callback: (data: { id: number; texts: string[] }) => void) => {
    ipcRenderer.on("request-embedding", (_event, data) => callback(data));
  },
  sendEmbeddingResult: (data: { id: number; embeddings?: number[][]; error?: string }) => {
    ipcRenderer.send("embedding-result", data);
  },
});
