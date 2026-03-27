import { ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { RequestContext } from "@mastra/core/request-context";
import { generateText } from "ai";

import {
  appState,
  encryptedApiKeys,
  saveState,
  saveKeys,
  setAppState,
} from "./state";
import {
  getGlobalMainWindow,
  pendingEmbeddings,
  getProjectStore,
} from "./mastra";
import {
  startWatchingProject,
  syncProjectToVectorStore,
} from "./utils";
import { AGENTS_MAP } from "./agents";
import { setLastUsedModelConfig } from "./tools";
import { ModelConfig } from "./types";
import { getDynamicModel } from "./config";

export function setupIpcHandlers() {
  const mainWindow = getGlobalMainWindow();

  ipcMain.on("embedding-result", (event, { id, embeddings, error }) => {
    const promiseHandlers = pendingEmbeddings.get(id);
    if (promiseHandlers) {
      if (error) {
        promiseHandlers.reject(new Error(error));
      } else {
        promiseHandlers.resolve({ embeddings });
      }
      pendingEmbeddings.delete(id);
    }
  });

  ipcMain.handle("get-app-state", () => {
    const masked: Record<string, string> = {};
    Object.keys(encryptedApiKeys).forEach((k) => {
      if (encryptedApiKeys[k]) masked[k] = "********";
    });
    return { ...appState, apiKeys: masked };
  });

  ipcMain.handle("update-app-state", async (_, s) => {
    const oldProjectId = appState.activeProjectId;
    setAppState(s);
    if (appState.activeProjectId !== oldProjectId && appState.activeProjectId) {
      const project = appState.projects.find((p) => p.id === appState.activeProjectId);
      if (project) {
        startWatchingProject(project.id, project.path);
        await saveState();
      }
    }
    await saveState();
  });

  ipcMain.handle("save-api-keys", async (_, keys) => {
    await saveKeys(keys);
    return true;
  });

  ipcMain.handle("delete-project", async (_, id) => {
    const idx = appState.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    appState.projects.splice(idx, 1);
    if (appState.activeProjectId === id) appState.activeProjectId = null;
    await saveState();
    return true;
  });

  ipcMain.handle("select-project", async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const projectPath = res.filePaths[0];
      const id = path.basename(projectPath);
      let p = appState.projects.find((pr) => pr.id === id);
      if (!p) {
        p = { id, name: id, path: projectPath, threads: [] };
        appState.projects.push(p);
        appState.activeProjectId = id;
        await saveState();
      }
      if (projectPath && appState.activeProjectId) {
        startWatchingProject(appState.activeProjectId, projectPath);
      }
      return p;
    }
    return null;
  });

  ipcMain.handle("force-reindex", async () => {
    const project = appState.projects.find(p => p.id === appState.activeProjectId);
    if (project?.path) {
      if (mainWindow) mainWindow.webContents.send("indexing-status", { status: "indexing" });
      await syncProjectToVectorStore(project.path, true);
      return true;
    }
    return false;
  });

  ipcMain.handle("get-project-tree", async () => {
    const project = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!project?.path) return [];

    const buildTree = async (dir: string, relPath = ""): Promise<any[]> => {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        const nodes = [];

        for (const item of items) {
          if (item.name.startsWith(".")) continue;

          const itemPath = path.join(dir, item.name);
          const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;

          if (item.isDirectory()) {
            const children = await buildTree(itemPath, itemRelPath);
            let icon = "pi pi-fw pi-folder";
            if (item.name === "layouts") icon = "pi pi-fw pi-map";
            else if (item.name === "eventSheets") icon = "pi pi-fw pi-list";
            else if (item.name === "objectTypes") icon = "pi pi-fw pi-box";
            else if (item.name === "families") icon = "pi pi-fw pi-users";
            else if (item.name === "scripts") icon = "pi pi-fw pi-code";

            nodes.push({
              key: itemRelPath,
              label: item.name,
              icon,
              children,
            });
          } else {
            let icon = "pi pi-fw pi-file";
            const lowerName = item.name.toLowerCase();
            if (lowerName.endsWith(".js") || lowerName.endsWith(".ts")) icon = "pi pi-fw pi-code";
            else if (itemRelPath.includes("layouts")) icon = "pi pi-fw pi-image";
            else if (itemRelPath.includes("eventSheets")) icon = "pi pi-fw pi-align-left";

            nodes.push({
              key: itemRelPath,
              label: item.name,
              icon,
              data: { path: itemRelPath },
            });
          }
        }

        nodes.sort((a, b) => {
          if (a.children && !b.children) return -1;
          if (!a.children && b.children) return 1;
          return a.label.localeCompare(b.label);
        });

        return nodes;
      } catch (e) {
        console.error("[DEBUG] Error building project tree:", e);
        return [];
      }
    };

    return await buildTree(project.path);
  });

  ipcMain.handle("get-file-content", async (_, relPath) => {
    const project = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!project?.path) return "";
    return await fs.readFile(path.join(project.path, relPath), "utf8");
  });

  ipcMain.handle(
    "generate-title",
    async (
      _,
      {
        userMessage,
        assistantResponse,
        modelConfig,
      }: { userMessage: string; assistantResponse: string; modelConfig: ModelConfig },
    ) => {
      try {
        const model = getDynamicModel({
          ...modelConfig,
          apiKey: encryptedApiKeys[modelConfig.provider],
        });
        const { text } = await generateText({
          model,
          prompt: `Generate a very short, concise title (max 5 words) for a conversation that started with:
User: "${userMessage}"
Assistant: "${assistantResponse.substring(0, 200)}..."
Return ONLY the title text, no quotes or punctuation.`,
        });
        return text.replace(/["']/g, "").trim();
      } catch (e) {
        console.error("[DEBUG] Error generating title:", e);
        return null;
      }
    },
  );

  ipcMain.handle(
    "ask-question",
    async (
      _,
      {
        text,
        threadId,
        modelConfig,
        agentId,
      }: { text: string; threadId: string; modelConfig?: ModelConfig; agentId?: string },
    ) => {
      try {
        const p = appState.projects.find((pr) => pr.id === appState.activeProjectId);
        if (!p) {
          return "No project.";
        }

        const targetAgentId = agentId && agentId !== "auto" ? agentId : "construct-llm-agent";

        const provider = modelConfig?.provider || "mistral";
        const currentModelConfig: ModelConfig = {
          provider,
          modelId: modelConfig?.modelId || "mistral-large-latest",
          apiKey: encryptedApiKeys[provider],
        };
        setLastUsedModelConfig(currentModelConfig);

        const activeAgent = AGENTS_MAP[targetAgentId];
        if (!activeAgent) {
          throw new Error(`Agent not found: ${targetAgentId}`);
        }

        const requestContext = new RequestContext();
        requestContext.set("modelConfig", currentModelConfig);
        requestContext.set("customPrompt", p.customPrompt);

        const result = await activeAgent.stream(text, {
          maxSteps: 10,
          requestContext,
          memory: {
            thread: { id: threadId },
            resource: appState.activeProjectId || "default-project",
          },
        });

        if (!result.fullStream) {
          throw new Error("No stream");
        }

        const reader = result.fullStream.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) {
            break;
          }

          const chunkAny = chunk as any;

          if (chunk.type === "tool-call") {
            if (mainWindow)
              mainWindow.webContents.send("agent-reflection", {
                type: "tool-call",
                toolName: chunkAny.payload?.toolName,
                args: chunkAny.payload?.args,
                toolCallId: chunkAny.payload?.toolCallId,
              });
          } else if (chunk.type === "tool-result") {
            if (mainWindow)
              mainWindow.webContents.send("agent-reflection", {
                type: "tool-result",
                toolName: chunkAny.payload?.toolName,
                result: chunkAny.payload?.result,
                toolCallId: chunkAny.payload?.toolCallId,
              });
          } else if (
            chunk.type === "reasoning-delta" ||
            chunk.type === "reasoning-start" ||
            chunk.type === ("thought" as any)
          ) {
            if (mainWindow)
              mainWindow.webContents.send("agent-reflection", {
                type: "thought",
                content:
                  chunkAny.payload?.content ||
                  chunkAny.payload?.textDelta ||
                  chunkAny.payload?.text ||
                  chunkAny.textDelta,
              });
          } else if (chunk.type === "text-delta") {
            const text =
              chunkAny.payload?.textDelta || chunkAny.payload?.text || chunkAny.textDelta || "";
            if (mainWindow)
              mainWindow.webContents.send("agent-chunk", {
                text,
                metadata: targetAgentId === "generator-agent" ? { type: "c3-clipboard" } : undefined,
              });
          } else if (chunk.type === "tool-call-delta") {
            if (mainWindow)
              mainWindow.webContents.send("agent-reflection", {
                type: "tool-call-delta",
                toolName: chunkAny.payload?.toolName,
                argsTextDelta: chunkAny.payload?.argsTextDelta || chunkAny.argsTextDelta,
                toolCallId: chunkAny.payload?.toolCallId || chunkAny.toolCallId,
              });
          } else if (chunk.type === ("step-start" as any)) {
            if (mainWindow)
              mainWindow.webContents.send("agent-reflection", {
                type: "thought",
                content: "Agent is starting a new reasoning step...",
                transient: true,
              });
          } else if (chunk.type === "error") {
            console.error("[DEBUG] Agent error chunk:", chunkAny.payload || chunkAny.error);
          }
        }
        return "Done";
      } catch (error: any) {
        console.error("[DEBUG] Error in ask-question:", error);
        let userFriendlyError = `Error: ${error.message}`;

        if (error.message.includes("quota") || error.statusCode === 429) {
          if (error.message.includes("limit: 0")) {
            userFriendlyError =
              "Gemini Quota Error (Limit: 0). This usually means the Free Tier is restricted in your region (e.g., Europe/UK). You must enable 'Pay-as-you-go' in Google AI Studio to use the API, even if you stay within the free usage limits.";
          } else {
            userFriendlyError =
              "Gemini Rate Limit Exceeded. If you are on the Free Tier, wait 1 minute or enable 'Pay-as-you-go' in Google AI Studio to increase your TPM/RPM limits.";
          }
        } else if (error.message.includes("API Key")) {
          userFriendlyError = error.message;
        }

        if (mainWindow) {
          mainWindow.webContents.send("agent-chunk", {
            text: `\n\n> ⚠️ **${userFriendlyError}**`,
          });
        }
        return `Error: ${error.message}`;
      }
    },
  );
}
