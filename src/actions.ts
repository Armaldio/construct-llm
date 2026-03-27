import { store, ChatMessage, ModelConfig } from "./store";
import { toRaw } from "vue";

const electronAPI = (window as any).api;

export async function loadState() {
  const s = await electronAPI.getAppState();
  store.appState = s;

  // Migration: Ensure all messages have parts
  store.appState.projects.forEach((p) => {
    p.threads.forEach((t) => {
      t.messages.forEach((m) => {
        if (!m.parts) m.parts = [];
      });
    });
  });

  if (s.activeProjectId) {
    store.currentProject = store.appState.projects.find((p) => p.id === s.activeProjectId) || null;
    if (store.currentProject) {
      // Synchronize activeThreadId and activeThread object
      if (store.activeThreadId) {
        store.activeThread =
          store.currentProject.threads.find((t) => t.id === store.activeThreadId) || null;
      }

      if (!store.activeThread && store.currentProject.threads.length > 0) {
        store.activeThreadId = store.currentProject.threads[0].id;
        store.activeThread = store.currentProject.threads[0];
      }
      refreshProjectTree();
    }
  }
}

export async function refreshProjectTree() {
  try {
    const tree = await electronAPI.getProjectTree();
    store.projectTree = tree;
    extractFiles(tree);
  } catch (e) {
    console.error("Failed to load project tree:", e);
  }
}

function extractFiles(nodes: any[]) {
  const files: any[] = [];
  const entities: any[] = [];
  const traverse = (node: any) => {
    if (node.data) {
      // Create a clean label without common Construct 3 extensions
      const cleanLabel = node.label.replace(/\.(json|js|ts|c3proj|c3p)$/i, "");
      const newNode = { ...node, label: cleanLabel };

      files.push(newNode);

      const path = node.data.path || "";
      if (
        path.includes("objectTypes") ||
        path.includes("eventSheets") ||
        path.includes("families") ||
        path.includes("layouts")
      ) {
        entities.push(newNode);
      }
    }
    if (node.children) {
      node.children.forEach(traverse);
    }
  };
  nodes.forEach(traverse);
  store.allFiles = files;
  store.allEntities = entities;
}

export async function loadProject() {
  const result = await electronAPI.selectProject();
  if (result) {
    await loadState();
    store.appState.activeProjectId = result.id;
    store.currentProject = result;
    if (result.threads && result.threads.length > 0) {
      store.activeThreadId = result.threads[0].id;
      store.activeThread = result.threads[0];
    } else {
      store.activeThreadId = null;
      store.activeThread = null;
    }
    refreshProjectTree();
  }
}

export async function deleteProject(id: string) {
  const res = await electronAPI.deleteProject(id);
  if (res) {
    await loadState();
    if (store.appState.activeProjectId === id) {
      store.appState.activeProjectId = null;
      store.currentProject = null;
      store.activeThreadId = null;
      store.activeThread = null;
    }
  }
}

export async function saveCurrentState() {
  // Use JSON stringify/parse to ensure a clean, deep clone without Vue proxies
  // being sent over the IPC boundary.
  const cleanState = JSON.parse(JSON.stringify(store.appState));
  await electronAPI.updateAppState(cleanState);
}

export function createNewThread(name: string, model: ModelConfig, initialMessage?: string) {
  if (!store.currentProject) return;
  const newThread = {
    id: Date.now().toString(),
    name: name,
    messages: [],
    modelConfig: {
      provider: model.provider,
      modelId: model.modelId,
    },
    agentId: "auto",
  };
  store.currentProject.threads.unshift(newThread);
  store.activeThreadId = newThread.id;
  store.activeThread = newThread;

  // Save the thread entry immediately before sending the message
  saveCurrentState();

  if (initialMessage) {
    sendMessage(initialMessage, []);
  }
}

export function deleteThread(threadId: string) {
  if (!store.currentProject) return;
  store.currentProject.threads = store.currentProject.threads.filter((t) => t.id !== threadId);
  if (store.activeThreadId === threadId) {
    if (store.currentProject.threads.length > 0) {
      store.activeThreadId = store.currentProject.threads[0].id;
      store.activeThread = store.currentProject.threads[0];
    } else {
      store.activeThreadId = null;
      store.activeThread = null;
    }
  }
  saveCurrentState();
}

export async function forceReindex() {
  if (!store.currentProject) return;
  store.isIndexing = true;
  try {
    const res = await (window as any).api.forceReindex();
    if (!res) {
      alert("Error during indexing");
    }
  } catch (e: unknown) {
    const err = e as Error;
    alert("Error: " + err.message);
  } finally {
    store.isIndexing = false;
  }
}

export async function sendMessage(text: string, reflectionsArray: unknown[]) {
  if (!text.trim() || !store.activeThread || store.isStreaming) return;

  const isFirstMessage = store.activeThread.messages.length === 0;
  const userMsg: ChatMessage = { role: "user", content: text, parts: [] };
  store.activeThread.messages.push(userMsg);

  const threadId = store.activeThread.id;
  const modelConfig = JSON.parse(JSON.stringify(store.activeThread.modelConfig));
  const agentId = store.activeThread.agentId;

  store.isStreaming = true;
  reflectionsArray.length = 0; // clear current reflections

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: "",
    reflections: [],
    parts: [],
  };
  store.activeThread.messages.push(assistantMsg);

  // Save user message and assistant placeholder immediately
  saveCurrentState();

  try {
    await (window as any).api.askQuestion({ text, threadId, modelConfig, agentId });

    // Generate title automatically if this was the first interaction
    if (isFirstMessage && store.activeThread) {
      const assistantText = assistantMsg.content || "";
      const generatedTitle = await (window as any).api.generateTitle({
        userMessage: text,
        assistantResponse: assistantText,
        modelConfig,
      });
      if (generatedTitle && store.activeThread) {
        store.activeThread.name = generatedTitle;
        // Save the updated title immediately
        saveCurrentState();
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error sending message:", err);
    assistantMsg.content = "Error: " + err.message;
  } finally {
    store.isStreaming = false;
    saveCurrentState();
  }
}
