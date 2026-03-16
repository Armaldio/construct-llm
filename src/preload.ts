import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  updateAppState: (state: any) => ipcRenderer.invoke('update-app-state', state),
  selectProject: () => ipcRenderer.invoke('select-project'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),
  askQuestion: (question: string) => ipcRenderer.invoke('ask-question', question),
  onIndexingStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('indexing-status', (_event, data) => callback(data));
  },
  onAgentReflection: (callback: (data: any) => void) => {
    ipcRenderer.on('agent-reflection', (_event, data) => callback(data));
  },
  onAgentChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('agent-chunk', (_event, chunk) => callback(chunk));
  },
});