console.log("[DEBUG] Preload script starting at:", new Date().toISOString());
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  getAppState: () => ipcRenderer.invoke("get-app-state"),
  updateAppState: (state: any) => ipcRenderer.invoke("update-app-state", state),
  isStartupComplete: () => ipcRenderer.invoke("is-startup-complete"),
  selectProject: () => ipcRenderer.invoke("select-project"),
  deleteProject: (id: string) => ipcRenderer.invoke("delete-project", id),
  forceReindex: () => ipcRenderer.invoke("force-reindex"),
  saveApiKeys: (keys: any) => ipcRenderer.invoke("save-api-keys", keys),
  getProjectTree: () => ipcRenderer.invoke("get-project-tree"),
  getFileContent: (path: string) => ipcRenderer.invoke("get-file-content", path),
  askQuestion: (data: { text: string; threadId: string; modelConfig: any; agentId: string }) =>
    ipcRenderer.invoke("ask-question", data),

  onIndexingStatus: (callback: (data: any) => void) => {
    ipcRenderer.on("indexing-status", (_event, data) => callback(data));
  },
  onAgentReflection: (callback: (data: any) => void) => {
    ipcRenderer.on("agent-reflection", (_event, data) => callback(data));
  },
  onAgentChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on("agent-chunk", (_event, chunk) => callback(chunk));
  },
  onStartupProgress: (callback: (data: any) => void) => {
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
