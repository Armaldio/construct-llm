console.log("[DEBUG] Main process starting at:", new Date().toISOString());
import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import started from "electron-squirrel-startup";
console.log("[DEBUG] Basic imports finished at:", new Date().toISOString());

import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { LibSQLVector, LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
console.log("[DEBUG] Mastra imports finished at:", new Date().toISOString());

import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
console.log("[DEBUG] AI SDK imports finished at:", new Date().toISOString());

import * as dotenv from "dotenv";
import { watch } from "chokidar";
import lodash from "lodash";
import { z } from "zod";
const { debounce } = lodash;

console.log("[DEBUG] Before dotenv.config() at:", new Date().toISOString());
dotenv.config();
console.log("[DEBUG] After dotenv.config() at:", new Date().toISOString());

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

// --- Interfaces ---

interface ModelConfig {
  provider: string;
  modelId?: string;
  apiKey?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  modelConfig: ModelConfig;
}

interface Project {
  id: string;
  name: string;
  path: string;
  threads: ChatThread[];
  customPrompt?: string;
}

interface AppState {
  projects: Project[];
  activeProjectId: string | null;
}

// --- State ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;
let projectWatcher: ReturnType<typeof watch> | null = null;
let isStartupComplete = false;

let appState: AppState = { projects: [], activeProjectId: null };
let encryptedApiKeys: Record<string, string> = {};

const storagePath = path.join(app.getPath("userData"), "storage.json");
const keysPath = path.join(app.getPath("userData"), "keys.bin");
const projectDbPath = path.join(app.getPath("userData"), "projects.db");
const globalDbPath = app.isPackaged
  ? path.join(process.resourcesPath, "prebuilt-assets.db")
  : path.join(process.cwd(), "prebuilt-assets.db");

// --- Persistence ---

async function saveState() {
  try {
    const { ...stateToSave } = appState;
    await fs.writeFile(storagePath, JSON.stringify(stateToSave, null, 2));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

async function loadState() {
  try {
    const data = await fs.readFile(storagePath, "utf8");
    appState = JSON.parse(data);
    if (appState.activeProjectId) {
      const project = appState.projects.find((p) => p.id === appState.activeProjectId);
      if (project) {
        currentProjectPath = project.path;
        startWatchingProject(project.path);
      }
    }
  } catch (e) {
    appState = { projects: [], activeProjectId: null };
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = await fs.readFile(keysPath);
      encryptedApiKeys = JSON.parse(safeStorage.decryptString(buffer));
    }
  } catch (e) {
    encryptedApiKeys = {};
  }
}

async function saveKeys(keys: Record<string, string>) {
  if (safeStorage.isEncryptionAvailable()) {
    encryptedApiKeys = keys;
    await fs.writeFile(keysPath, safeStorage.encryptString(JSON.stringify(keys)));
  }
}

// --- Mastra Configuration ---

const projectStore = new LibSQLVector({
  id: "project-store",
  url: `file:${projectDbPath}`,
});

const globalStore = new LibSQLVector({
  id: "global-store",
  url: `file:${globalDbPath}`,
});

const memoryStore = new LibSQLStore({
  id: "construct-memory",
  url: `file:${path.join(app.getPath("userData"), "construct-memory.db")}`,
});

let embeddingRequestId = 0;
const pendingEmbeddings = new Map<
  number,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();

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

const embeddingModel = {
  specificationVersion: "v1",
  provider: "webgpu",
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxEmbeddingsPerCall: 100,
  async doEmbed({ values }: { values: string[] }) {
    if (!mainWindow) {
      throw new Error("Cannot compute embeddings: UI window is not ready.");
    }
    return new Promise((resolve, reject) => {
      const id = ++embeddingRequestId;
      pendingEmbeddings.set(id, { resolve, reject });
      mainWindow!.webContents.send("request-embedding", { id, texts: values });
    });
  },
} as any;

const agentMemory = new Memory({
  storage: memoryStore,
  vector: projectStore,
  embedder: embeddingModel,
});

// --- Tools ---

const search_project = createVectorQueryTool({
  vectorStoreName: "project-store",
  indexName: "project_content",
  model: embeddingModel,
  id: "search_project",
  description:
    "Search the current project for specific logic, layouts, or event sheets. Use this whenever you need details about how the user's project is structured.",
  reranker: {
    model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })(
      "mistral-large-latest",
    ) as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const search_manual = createVectorQueryTool({
  vectorStoreName: "global-store",
  indexName: "manual_content",
  model: embeddingModel,
  id: "search_manual",
  description:
    "Search the official Construct 3 manual for engine rules, behavior details, or syntax. Use this to verify how Construct 3 features work.",
  reranker: {
    model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })(
      "mistral-large-latest",
    ) as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const search_snippets = createVectorQueryTool({
  vectorStoreName: "global-store",
  indexName: "snippet_content",
  model: embeddingModel,
  id: "search_snippets",
  description:
    "Search for gold-standard Construct 3 event JSON snippets. Use this to find correct JSON structures to show to the user or when generating logic.",
  reranker: {
    model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })(
      "mistral-large-latest",
    ) as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const C3ClipboardSchema = z.object({
  "is-c3-clipboard-data": z.literal(true),
  type: z.literal("events"),
  items: z.array(
    z.object({
      eventType: z.string(),
      conditions: z.array(
        z.object({
          id: z.string(),
          objectClass: z.string(),
          parameters: z.record(z.any(), z.any()).optional(),
        }),
      ),
      actions: z.array(
        z.object({
          id: z.string(),
          objectClass: z.string(),
          parameters: z.record(z.any(), z.any()).optional(),
        }),
      ),
    }),
  ),
});

const generate_c3_clipboard = {
  id: "generate_c3_clipboard",
  description: "Generate valid Construct 3 clipboard JSON.",
  inputSchema: z.object({
    logic: z.string().describe("The logical flow to generate."),
    objects: z.array(z.string()).describe("List of object names to use."),
  }),
  execute: async ({ logic, objects }: { logic: string; objects: string[] }) => {
    const result = await generator.generate(
      `Generate Construct 3 clipboard JSON for: ${logic}. Use objects: ${objects.join(", ")}.`,
      { structuredOutput: { schema: C3ClipboardSchema } },
    );
    return JSON.stringify(result.object);
  },
};

const list_project_addons = {
  id: "list_project_addons",
  description: "Lists plugins and behaviors used in the project.",
  inputSchema: z.object({}),
  execute: async () => {
    if (!currentProjectPath) return "No project.";
    const content = await fs.readFile(path.join(currentProjectPath, "project.c3proj"), "utf8");
    const data = JSON.parse(content);
    return JSON.stringify(data.usedAddons || []);
  },
};

const list_project_files = {
  id: "list_project_files",
  description: "Lists all files in a project directory.",
  inputSchema: z.object({
    directory: z.enum([
      "layouts",
      "eventSheets",
      "objectTypes",
      "families",
      "timelines",
      "scripts",
    ]),
  }),
  execute: async ({ directory }: { directory: string }) => {
    if (!currentProjectPath) return "No project.";
    const dirPath = path.join(currentProjectPath, directory);
    try {
      const files = await fs.readdir(dirPath);
      return JSON.stringify(
        files.filter((f) => f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".ts")),
      );
    } catch (e) {
      return "Not found.";
    }
  },
};

const get_object_schema = {
  id: "get_object_schema",
  description: "Returns JSON schema for an object type.",
  inputSchema: z.object({
    objectName: z.string().describe("Object type name."),
  }),
  execute: async ({ objectName }: { objectName: string }) => {
    if (!currentProjectPath) return "No project.";
    try {
      return await fs.readFile(
        path.join(currentProjectPath, "objectTypes", `${objectName}.json`),
        "utf8",
      );
    } catch (e) {
      return "Not found.";
    }
  },
};

const search_events = {
  id: "search_events",
  description: "Search across all event sheets.",
  inputSchema: z.object({ query: z.string().describe("Keyword.") }),
  execute: async ({ query }: { query: string }) => {
    if (!currentProjectPath) return "No project.";
    const dir = path.join(currentProjectPath, "eventSheets");
    try {
      const files = await fs.readdir(dir);
      const res = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        if (
          (await fs.readFile(path.join(dir, f), "utf8")).toLowerCase().includes(query.toLowerCase())
        )
          res.push(f);
      }
      return res.length > 0 ? res.join(", ") : "No matches.";
    } catch (e) {
      return "Error.";
    }
  },
};

const get_project_summary = {
  id: "get_project_summary",
  description:
    "Get a high-level summary of the Construct 3 project including its name, layouts, and event sheets. Use this tool at the start of a conversation to understand the project's identity.",
  inputSchema: z.object({}),
  execute: async () => {
    console.log(
      "[DEBUG] Tool get_project_summary executed. currentProjectPath:",
      currentProjectPath,
    );
    if (!currentProjectPath)
      return "No project loaded. Please ask the user to select a project folder.";
    try {
      const projFilePath = path.join(currentProjectPath, "project.c3proj");
      console.log("[DEBUG] Reading project file at:", projFilePath);
      const data = JSON.parse(await fs.readFile(projFilePath, "utf8"));

      const extractItems = (node: any): string[] => {
        if (!node) return [];
        let items: string[] = [];
        if (Array.isArray(node.items)) items = items.concat(node.items);
        if (Array.isArray(node.subfolders)) {
          node.subfolders.forEach((sub: any) => {
            items = items.concat(extractItems(sub));
          });
        }
        return items;
      };

      const layouts = extractItems(data.layouts);
      const eventSheets = extractItems(data.eventSheets);

      const summary = `Project Name: ${data.name || "Untitled"}\nLayouts: ${layouts.join(", ") || "None"}\nEvent Sheets: ${eventSheets.join(", ") || "None"}`;
      console.log("[DEBUG] Tool get_project_summary returning:", summary);
      return summary;
    } catch (e: any) {
      console.error("[DEBUG] Tool get_project_summary failed:", e.message);
      return `Error reading project file: ${e.message}. Ensure the selected folder is a valid Construct 3 project folder.`;
    }
  },
};

const audit_project = {
  id: "audit_project",
  description: "Audits for performance.",
  inputSchema: z.object({}),
  execute: async () => {
    return "Audit logic active.";
  },
};

// --- Agents ---

const AGENT_CONFIGS: Record<string, any> = {
  "architect-agent": {
    name: "Architect",
    instructions:
      "You are a Construct 3 Architect. Use tools to research the project structure, layouts, and families. Always gather current project context before answering.",
    tools: {
      search_project,
      list_project_files,
      list_project_addons,
      get_project_summary,
    },
  },
  "logic-expert-agent": {
    name: "Logic Expert",
    instructions:
      "You are a Construct 3 Logic Expert. Use tools to research event sheets, engine rules, and manual documentation before answering.",
    tools: {
      search_events,
      search_manual,
      audit_project,
      get_object_schema,
      get_project_summary,
    },
  },
  "generator-agent": {
    name: "Generator",
    instructions:
      "You are a Construct 3 Code/Logic Generator. Use tools to search snippets and generate valid C3 clipboard JSON. Always output valid JSON blocks for clipboard use.",
    tools: { search_snippets },
  },
  "construct-llm-agent": {
    name: "Construct 3 Expert",
    instructions:
      "You are a General Construct 3 Expert. Use all provided tools to research project context, search the manual, and gather any information needed to provide accurate, project-specific help.",
    tools: {
      search_project,
      search_manual,
      search_snippets,
      generate_c3_clipboard,
      list_project_addons,
      list_project_files,
      get_object_schema,
      search_events,
      audit_project,
      get_project_summary,
    },
  },
};

const architect = new Agent({
  id: "architect-agent",
  name: AGENT_CONFIGS["architect-agent"].name,
  instructions: AGENT_CONFIGS["architect-agent"].instructions,
  model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })("mistral-large-latest"),
  memory: agentMemory,
  tools: AGENT_CONFIGS["architect-agent"].tools,
});

const logicExpert = new Agent({
  id: "logic-expert-agent",
  name: AGENT_CONFIGS["logic-expert-agent"].name,
  instructions: AGENT_CONFIGS["logic-expert-agent"].instructions,
  model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })("mistral-large-latest"),
  memory: agentMemory,
  tools: AGENT_CONFIGS["logic-expert-agent"].tools,
});

const generator = new Agent({
  id: "generator-agent",
  name: AGENT_CONFIGS["generator-agent"].name,
  instructions: AGENT_CONFIGS["generator-agent"].instructions,
  model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })("mistral-large-latest"),
  memory: agentMemory,
  tools: AGENT_CONFIGS["generator-agent"].tools,
});

const agent = new Agent({
  id: "construct-llm-agent",
  name: AGENT_CONFIGS["construct-llm-agent"].name,
  instructions: AGENT_CONFIGS["construct-llm-agent"].instructions,
  model: createMistral({ apiKey: process.env.MISTRAL_API_KEY || "" })("mistral-large-latest"),
  memory: agentMemory,
  tools: AGENT_CONFIGS["construct-llm-agent"].tools,
});

const mastra = new Mastra({
  agents: {
    "construct-llm-agent": agent,
    "architect-agent": architect,
    "logic-expert-agent": logicExpert,
    "generator-agent": generator,
  },
  vectors: { "project-store": projectStore, "global-store": globalStore },
});

// --- Dynamic Agent Factory ---

const getDynamicModel = (config: ModelConfig) => {
  const apiKey = config.apiKey || process.env.MISTRAL_API_KEY || "";
  console.log(
    `[DEBUG] getDynamicModel: provider=${config.provider}, hasKey=${!!apiKey}, keyPrefix=${apiKey ? apiKey.substring(0, 5) + "..." : "none"}`,
  );

  if (!apiKey) {
    throw new Error(`Missing API Key for provider: ${config.provider || "unknown"}`);
  }

  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey })(config.modelId || "gpt-4o");
    case "anthropic":
      return createAnthropic({ apiKey })(config.modelId || "claude-3-5-sonnet-latest");
    case "google":
      return createGoogleGenerativeAI({ apiKey })(config.modelId || "gemini-2.0-flash");
    default:
      return createMistral({ apiKey })(config.modelId || "mistral-large-latest");
  }
};

const createDynamicAgent = (
  modelConfig: ModelConfig,
  agentId = "construct-llm-agent",
  customPrompt?: string,
) => {
  console.log("[DEBUG] createDynamicAgent called for:", agentId);
  const config = AGENT_CONFIGS[agentId];
  if (!config) {
    console.error("[DEBUG] FATAL: Agent not found in AGENT_CONFIGS:", agentId);
    throw new Error(`Agent not found: ${agentId}`);
  }

  let finalInstructions = `${config.instructions}\n\nYou MUST use your tools to query the project state or the manual. Never rely on general knowledge for project-specific details.`;

  if (customPrompt) {
    finalInstructions += `\n\n### USER CUSTOM INSTRUCTIONS:\n${customPrompt}\n`;
  }

  console.log("[DEBUG] Final instructions for dynamic agent:", finalInstructions);

  return new Agent({
    id: agentId,
    name: config.name,
    instructions: finalInstructions,
    model: getDynamicModel(modelConfig),
    memory: agentMemory,
    tools: config.tools,
  });
};

// --- Helper Functions ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = await fs.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      await getAllFiles(filePath, arrayOfFiles);
    } else {
      const ext = path.extname(file).toLowerCase();
      if ([".json", ".js", ".ts"].includes(ext)) {
        arrayOfFiles.push(filePath);
      }
    }
  }

  return arrayOfFiles;
}

async function syncProjectToVectorStore(projectPath: string, force = false) {
  console.log(`[DEBUG] syncProjectToVectorStore: path=${projectPath}, force=${force}`);
  try {
    await projectStore.createIndex({
      indexName: "project_content",
      dimension: 384,
    });
    console.log("[DEBUG] Created or verified project_content index.");
  } catch (e) {
    // Index might already exist
  }

  if (mainWindow) {
    mainWindow.webContents.send("indexing-status", {
      status: "indexing",
      projectPath,
    });
  }

  try {
    const allFiles = await getAllFiles(projectPath);
    console.log(`[DEBUG] Found ${allFiles.length} files to index.`);

    let filesProcessed = 0;
    for (const filePath of allFiles) {
      filesProcessed++;
      try {
        const relativePath = path.relative(projectPath, filePath);

        // Update UI with progress
        if (mainWindow) {
          mainWindow.webContents.send("indexing-status", {
            status: "indexing",
            projectPath,
            file: relativePath,
            progress: Math.round((filesProcessed / allFiles.length) * 100),
          });
        }

        const content = await fs.readFile(filePath, "utf8");
        if (!content || content.trim().length === 0) continue;

        const doc = MDocument.fromText(content, {
          metadata: {
            path: relativePath,
            type: path.extname(filePath).substring(1),
          },
        });

        const chunks = await doc.chunk({
          strategy: "recursive",
          maxSize: 1000,
          overlap: 200,
        });

        console.log(`[DEBUG] Indexing ${relativePath} (${chunks.length} chunks)`);

        // Increased batch size since the worker handles it without blocking the main thread
        const batchSize = 50;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const chunkBatch = chunks.slice(i, i + batchSize);
          const texts = chunkBatch.map((c) => c.text);

          const embeddingResult = await embeddingModel.doEmbed({
            values: texts,
          });
          const vectors = embeddingResult.embeddings;

          const ids: string[] = [];
          const metadata: Record<string, any>[] = [];

          for (let j = 0; j < chunkBatch.length; j++) {
            const chunk = chunkBatch[j];
            const vector = vectors[j];

            if (vector) {
              const safePath = relativePath.replace(/[^a-zA-Z0-9-]/g, "_");
              ids.push(`proj-${safePath}-chunk-${i + j}`);
              metadata.push({
                ...chunk.metadata,
                text: chunk.text,
                projectId: appState.activeProjectId,
              });
            }
          }

          if (vectors.length > 0) {
            await projectStore.upsert({
              indexName: "project_content",
              vectors,
              ids,
              metadata,
            });
          }

          // Minimal yield to process incoming IPC messages
          await sleep(5);
        }
      } catch (err: any) {
        console.error(`[DEBUG] Failed to index file ${filePath}:`, err.message);
      }
      // Minimal yield between files
      await sleep(10);
    }

    console.log("[DEBUG] Project indexing complete.");
    if (mainWindow) {
      mainWindow.webContents.send("indexing-status", {
        status: "complete",
        projectPath,
      });
    }
  } catch (error: any) {
    console.error("[DEBUG] Error in syncProjectToVectorStore:", error.message);
    if (mainWindow) {
      mainWindow.webContents.send("indexing-status", {
        status: "error",
        error: error.message,
      });
    }
  }
}

async function syncGlobalAssetsToVectorStore() {}

const debouncedSync = debounce((projectPath: string) => {
  syncProjectToVectorStore(projectPath).catch(() => {});
}, 2000);

function startWatchingProject(projectPath: string) {
  if (projectWatcher) projectWatcher.close();
  projectWatcher = watch([path.join(projectPath, "**/*.json")], {
    persistent: true,
    ignoreInitial: true,
  });
  projectWatcher.on("all", () => debouncedSync(projectPath));
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on("ready", async () => {
  console.log("[DEBUG] App ready event fired at:", new Date().toISOString());
  await loadState();
  console.log("[DEBUG] App state loaded at:", new Date().toISOString());
  createWindow();
  console.log("[DEBUG] Window created at:", new Date().toISOString());
  await sleep(500);
  console.log("[DEBUG] Ready to sync projects.");
  if (appState.activeProjectId) {
    const p = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (p) {
      await syncProjectToVectorStore(p.path);
      console.log("[DEBUG] Initial project synced at:", new Date().toISOString());
    }
  }
  isStartupComplete = true;
  if (mainWindow) {
    mainWindow.webContents.send("startup-complete");
    console.log("[DEBUG] startup-complete sent at:", new Date().toISOString());
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
  appState = s;
  if (appState.activeProjectId !== oldProjectId && appState.activeProjectId) {
    const project = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (project) {
      currentProjectPath = project.path;
      startWatchingProject(project.path);
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
    currentProjectPath = res.filePaths[0];
    const id = path.basename(currentProjectPath);
    let p = appState.projects.find((pr) => pr.id === id);
    if (!p) {
      p = { id, name: id, path: currentProjectPath, threads: [] };
      appState.projects.push(p);
      appState.activeProjectId = id;
      await saveState();
    }
    startWatchingProject(currentProjectPath);
    return p;
  }
  return null;
});
ipcMain.handle("force-reindex", async () => {
  if (currentProjectPath) {
    if (mainWindow) mainWindow.webContents.send("indexing-status", { status: "indexing" });
    await syncProjectToVectorStore(currentProjectPath, true);
    return true;
  }
  return false;
});

ipcMain.handle("get-project-tree", async () => {
  if (!currentProjectPath) return [];

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
          nodes.push({
            key: itemRelPath,
            label: item.name,
            icon: "pi pi-fw pi-folder",
            children,
          });
        } else {
          nodes.push({
            key: itemRelPath,
            label: item.name,
            icon: "pi pi-fw pi-file",
            data: { path: itemRelPath },
          });
        }
      }

      // Sort: folders first, then files
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

  return await buildTree(currentProjectPath);
});
ipcMain.handle("get-file-content", async (_, relPath) => {
  if (!currentProjectPath) return "";
  return await fs.readFile(path.join(currentProjectPath, relPath), "utf8");
});
ipcMain.handle("is-startup-complete", () => isStartupComplete);
ipcMain.handle(
  "ask-question",
  async (
    _,
    {
      text,
      threadId,
      modelConfig,
      agentId,
    }: { text: string; threadId: string; modelConfig?: any; agentId?: string },
  ) => {
    console.log("[DEBUG] ask-question called with:", { threadId, agentId });
    try {
      const p = appState.projects.find((pr) => pr.id === appState.activeProjectId);
      if (!p) {
        console.log("[DEBUG] No project found for activeProjectId:", appState.activeProjectId);
        return "No project.";
      }
      // Ensure sync
      currentProjectPath = p.path;

      const targetAgentId = agentId && agentId !== "auto" ? agentId : "construct-llm-agent";
      console.log("[DEBUG] Using agent:", targetAgentId);

      const activeAgent = createDynamicAgent(
        { ...modelConfig, apiKey: encryptedApiKeys[modelConfig?.provider] },
        targetAgentId,
        p.customPrompt,
      );

      console.log("[DEBUG] Starting stream for prompt:", text.substring(0, 50) + "...");

      const result = await activeAgent.stream(text, {
        threadId,
        resourceId: p.path,
        // Ensure memory context is correctly passed down if the version requires it
        memory: {
          thread: {
            id: threadId,
          },
          resource: p.path,
        },
      });

      if (!result.fullStream) {
        console.log("[DEBUG] No fullStream returned from activeAgent.stream");
        throw new Error("No stream");
      }

      const reader = result.fullStream.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) {
          console.log("[DEBUG] Stream done");
          break;
        }
        if (chunk.type === "tool-call") {
          console.log("[DEBUG] Tool call detected:", chunk.payload?.toolName, chunk.payload?.args);
          if (mainWindow)
            mainWindow.webContents.send("agent-reflection", {
              type: "tool-call",
              toolName: chunk.payload?.toolName,
              args: chunk.payload?.args,
            });
        } else if (chunk.type === "tool-result") {
          console.log(
            "[DEBUG] Tool result detected:",
            chunk.payload?.toolName,
            chunk.payload?.result,
          );
          if (mainWindow)
            mainWindow.webContents.send("agent-reflection", {
              type: "tool-result",
              toolName: chunk.payload?.toolName,
              result: chunk.payload?.result,
            });
        } else if (chunk.type === "thought") {
          console.log("[DEBUG] Thought detected:", chunk.payload?.content);
          if (mainWindow)
            mainWindow.webContents.send("agent-reflection", {
              type: "thought",
              content: chunk.payload?.content,
            });
        } else if (chunk.type === "text-delta") {
          if (mainWindow) mainWindow.webContents.send("agent-chunk", chunk.payload?.text || "");
        }
      }
      return "Done";
    } catch (error: any) {
      console.error("[DEBUG] Error in ask-question:", error);
      return `Error: ${error.message}`;
    }
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
