import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import started from "electron-squirrel-startup";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { LibSQLVector } from "@mastra/libsql";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
import { mistral } from "@ai-sdk/mistral";
import { pipeline } from '@xenova/transformers';
import * as dotenv from "dotenv";
import chokidar from "chokidar";
import pkg from "lodash";
const { debounce } = pkg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;
let projectWatcher: chokidar.FSWatcher | null = null;

let appState: {
  projects: Array<{ id: string; name: string; path: string; threads: any[] }>;
  activeProjectId: string | null;
} = { projects: [], activeProjectId: null };

const storagePath = path.join(app.getPath("userData"), "storage.json");

async function loadState() {
  try {
    const data = await fs.readFile(storagePath, "utf8");
    appState = JSON.parse(data);

    if (appState.activeProjectId) {
      const project = appState.projects.find(
        (p) => p.id === appState.activeProjectId,
      );
      if (project) {
        startWatchingProject(project.path);
      }
    }
  } catch (e) {
    appState = { projects: [], activeProjectId: null };
  }
}

async function saveState() {
  try {
    await fs.writeFile(storagePath, JSON.stringify(appState, null, 2));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

// --- Mastra Configuration ---

const vectorStore = new LibSQLVector({
  id: "construct-projects",
  url: "file:construct-llm.db",
});

// Setup Xenova local embedder wrapper
class XenovaEmbedder {
  private embedder: any;

  async initialize() {
    if (!this.embedder) {
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
  }

  async embed(texts: string[]) {
    await this.initialize();
    const outputs = await this.embedder(texts, { pooling: 'mean', normalize: true });
    // Convert to flat array of arrays
    const num_texts = texts.length;
    const dim = 384;
    const result = [];
    for (let i = 0; i < num_texts; i++) {
        result.push(Array.from(outputs.data.slice(i * dim, (i + 1) * dim)));
    }
    return result;
  }
}

const xenovaModel = new XenovaEmbedder();

// Wrap for Mastra/ai SDK compatibility
const customEmbedder = {
  specificationVersion: 'v1',
  provider: 'xenova',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  maxEmbeddingsPerCall: 100,
  async doEmbed({ values }: { values: string[] }) {
    const embeddings = await xenovaModel.embed(values);
    return { embeddings }; // Return in expected format
  }
} as any;

const embeddingModel = customEmbedder;

const vectorQueryTool = createVectorQueryTool({
  vectorStoreName: "construct-projects",
  indexName: "project_content",
  model: embeddingModel,
});

const agent = new Agent({
  id: "construct-llm-agent",
  name: "Construct 3 Expert",
  instructions: `
    You are an expert in the Construct 3 game engine.
    You have access to a tool to query the contents of the currently loaded project.
    Always search the project content before answering questions about it.
    Be technical, concise, and helpful.

    When providing event logic or actions that the user can copy into Construct 3, use the Construct 3 Clipboard JSON format. 
    It must be a single line (minified) JSON object starting with {"is-c3-clipboard-data":true}.

    Example for clicking a button to go to a layout:
    {"is-c3-clipboard-data":true,"type":"events","items":[{"eventType":"block","conditions":[{"id":"on-clicked","objectClass":"MyButton"}],"actions":[{"id":"go-to-layout","objectClass":"System","parameters":{"layout":"NextLayout"}}]}]}

    The "objectClass" should match the objects in the project. If unsure, query the project content first.
  `,
  model: mistral("mistral-large-latest"),
  tools: {
    vectorQueryTool,
  },
});

const mastra = new Mastra({
  agents: { agent },
  vectors: {
    "construct-projects": vectorStore,
  },
});

// --- Helper Functions ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const headers = err.responseHeaders || {};
      const remaining = headers["x-ratelimit-remaining-req-minute"];

      if (err.statusCode === 429 && i < retries - 1) {
        let waitTime = 2000 * Math.pow(2, i); // Exponential backoff

        if (remaining === "0") {
          console.warn(
            "Mistral Rate Limit Reached (0 remaining). Waiting longer...",
          );
          waitTime = 10000; // Wait 10s if we know we are at 0
        }

        console.warn(
          `Rate limit hit (Status 429), retrying in ${waitTime}ms...`,
        );
        await sleep(waitTime);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries reached");
}

async function syncProjectToVectorStore(projectPath: string) {
  console.log("Indexing project (LOCAL EMBEDDINGS):", projectPath);
  if (mainWindow) {
    mainWindow.webContents.send("indexing-status", {
      status: "indexing",
      projectPath,
    });
  }

  try {
    await mastra.getVector("construct-projects").createIndex({
      indexName: "project_content",
      dimension: 384, // dimension for all-MiniLM-L6-v2
    });
  } catch (e) {}

  const vectorsToUpsert: number[][] = [];
  const idsToUpsert: string[] = [];
  const metadataToUpsert: Record<string, any>[] = [];

  const processFileChunks = async (chunks: { text: string; metadata: any }[], filePath: string) => {
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const res = await embeddingModel.doEmbed({ values: [chunk.text] });

        if (res && res.embeddings && res.embeddings[0]) {
          const embeddingArray = Array.from(res.embeddings[0] as number[]);
          vectorsToUpsert.push(embeddingArray);
          idsToUpsert.push(`${projectPath}-${filePath}-chunk-${i}`.replace(/[^a-zA-Z0-9-]/g, "_"));
          metadataToUpsert.push(chunk.metadata);
        }
      } catch (err) {
        console.error(`Failed to embed chunk ${i} of ${filePath}:`, err);
      }
    }
  };

  // 1. Process project.c3proj (Generic Text Chunking)
  const c3projPath = path.join(projectPath, "project.c3proj");
  try {
    const stats = await fs.stat(c3projPath);
    if (stats.isFile()) {
      const content = await fs.readFile(c3projPath, "utf8");
      const doc = MDocument.fromText(content, {
        metadata: { path: "project.c3proj", projectPath },
      });
      const docChunks = await doc.chunk({ strategy: "recursive", maxSize: 1000, overlap: 100 });
      console.log(`Processing project.c3proj - ${docChunks.length} chunks`);
      await processFileChunks(docChunks.map(c => ({ text: c.text, metadata: { text: c.text, path: "project.c3proj", projectPath } })), "project.c3proj");
    }
  } catch (e) {}

  // 2. Process Event Sheets (Semantic Chunking)
  const eventSheetsDir = path.join(projectPath, "eventSheets");
  try {
    const files = await fs.readdir(eventSheetsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `eventSheets/${file}`;
      const content = await fs.readFile(path.join(eventSheetsDir, file), "utf8");
      
      try {
        const data = JSON.parse(content);
        const sheetName = data.name;
        const chunks: { text: string; metadata: any }[] = [];

        const processEvent = (event: any, parentStr: string = "") => {
          if (event.eventType === "block" || event.eventType === "group") {
            let text = `Event Sheet: ${sheetName}\nType: ${event.eventType}\n`;
            if (parentStr) text = `${parentStr}\n` + text;
            if (event.isActive === false) text += `(Disabled)\n`;

            if (event.conditions && event.conditions.length > 0) {
              text += `Conditions:\n`;
              event.conditions.forEach((c: any) => {
                text += `- ${c.objectClass}: ${c.id} ${c.parameters ? JSON.stringify(c.parameters) : ''}\n`;
              });
            }
            if (event.actions && event.actions.length > 0) {
              text += `Actions:\n`;
              event.actions.forEach((a: any) => {
                text += `- ${a.objectClass}: ${a.id} ${a.parameters ? JSON.stringify(a.parameters) : ''}\n`;
              });
            }

            chunks.push({
              text,
              metadata: { text, path: filePath, projectPath, rawJson: JSON.stringify(event).substring(0, 500) }
            });

            if (event.children) {
              event.children.forEach((child: any) => processEvent(child, `Parent Block in ${sheetName}`));
            }
          }
        };

        if (data.events) {
          data.events.forEach((event: any) => processEvent(event));
        }

        console.log(`Processing ${filePath} - ${chunks.length} semantic chunks`);
        await processFileChunks(chunks, filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}

  // 3. Process Layouts (Semantic Chunking)
  const layoutsDir = path.join(projectPath, "layouts");
  try {
    const files = await fs.readdir(layoutsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `layouts/${file}`;
      const content = await fs.readFile(path.join(layoutsDir, file), "utf8");

      try {
        const data = JSON.parse(content);
        const layoutName = data.name;
        const chunks: { text: string; metadata: any }[] = [];

        if (data.layers) {
          data.layers.forEach((layer: any) => {
            const layerName = layer.name;
            if (layer.instances && layer.instances.length > 0) {
              layer.instances.forEach((inst: any) => {
                let text = `Layout: ${layoutName}\nLayer: ${layerName}\n`;
                text += `Instance Type: ${inst.type}\n`;
                text += `UID: ${inst.uid}\n`;
                if (inst.world) text += `Position: ${inst.world.x}, ${inst.world.y}\n`;
                if (inst.properties) text += `Properties: ${JSON.stringify(inst.properties)}\n`;

                chunks.push({
                  text,
                  metadata: { text, path: filePath, projectPath }
                });
              });
            }
          });
        }

        console.log(`Processing ${filePath} - ${chunks.length} semantic chunks`);
        await processFileChunks(chunks, filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}

  // 4. Process Object Types (Semantic Chunking)
  const objectTypesDir = path.join(projectPath, "objectTypes");
  try {
    const files = await fs.readdir(objectTypesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `objectTypes/${file}`;
      const content = await fs.readFile(path.join(objectTypesDir, file), "utf8");

      try {
        const data = JSON.parse(content);
        let text = `Object Type: ${data.name}\n`;
        text += `Plugin ID: ${data["plugin-id"]}\n`;
        text += `Is Global: ${data.isGlobal}\n`;
        if (data.instanceVariables && data.instanceVariables.length > 0) {
          text += `Instance Variables: ${data.instanceVariables.map((v: any) => v.name + " (" + v.type + ")").join(", ")}\n`;
        }
        if (data.behaviorTypes && data.behaviorTypes.length > 0) {
          text += `Behaviors: ${data.behaviorTypes.map((b: any) => b.name + " (" + b["behavior-id"] + ")").join(", ")}\n`;
        }

        const chunk = {
          text,
          metadata: { text, path: filePath, projectPath }
        };

        console.log(`Processing ${filePath} - 1 semantic chunk`);
        await processFileChunks([chunk], filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}

  // 5. Process Families (Semantic Chunking)
  const familiesDir = path.join(projectPath, "families");
  try {
    const files = await fs.readdir(familiesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `families/${file}`;
      const content = await fs.readFile(path.join(familiesDir, file), "utf8");

      try {
        const data = JSON.parse(content);
        let text = `Family: ${data.name}\n`;
        if (data.members && data.members.length > 0) {
          text += `Members: ${data.members.join(", ")}\n`;
        }
        if (data.instanceVariables && data.instanceVariables.length > 0) {
          text += `Instance Variables: ${data.instanceVariables.map((v: any) => v.name + " (" + v.type + ")").join(", ")}\n`;
        }
        if (data.behaviorTypes && data.behaviorTypes.length > 0) {
          text += `Behaviors: ${data.behaviorTypes.map((b: any) => b.name + " (" + b["behavior-id"] + ")").join(", ")}\n`;
        }

        const chunk = {
          text,
          metadata: { text, path: filePath, projectPath }
        };

        console.log(`Processing ${filePath} - 1 semantic chunk`);
        await processFileChunks([chunk], filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}

  // 6. Process Scripts (Text Chunking)
  const scriptsDir = path.join(projectPath, "scripts");
  try {
    const files = await fs.readdir(scriptsDir);
    for (const file of files) {
      if (!file.endsWith(".js") && !file.endsWith(".ts")) continue;
      const filePath = `scripts/${file}`;
      const content = await fs.readFile(path.join(scriptsDir, file), "utf8");

      const doc = MDocument.fromText(content, {
        metadata: { path: filePath, projectPath },
      });
      const docChunks = await doc.chunk({ strategy: "recursive", maxSize: 1000, overlap: 100 });
      console.log(`Processing ${filePath} - ${docChunks.length} chunks`);
      await processFileChunks(docChunks.map(c => ({ text: c.text, metadata: { text: c.text, path: filePath, projectPath } })), filePath);
    }
  } catch (e) {}

  if (vectorsToUpsert.length > 0) {
    await mastra.getVector("construct-projects").upsert({
      indexName: "project_content",
      vectors: vectorsToUpsert,
      ids: idsToUpsert,
      metadata: metadataToUpsert,
    });
  }

  console.log("Indexing complete.");
  if (mainWindow) {
    mainWindow.webContents.send("indexing-status", {
      status: "complete",
      projectPath,
    });
  }
}

const debouncedSync = debounce((projectPath: string) => {
  syncProjectToVectorStore(projectPath).catch((err) => {
    console.error("Failed to sync project:", err);
  });
}, 2000);

function startWatchingProject(projectPath: string) {
  if (projectWatcher) {
    projectWatcher.close();
  }

  console.log("Watching project for real-time changes:", projectPath);

  projectWatcher = chokidar.watch(
    [
      path.join(projectPath, "project.c3proj"),
      path.join(projectPath, "layouts", "*.json"),
      path.join(projectPath, "eventSheets", "*.json"),
      path.join(projectPath, "objectTypes", "*.json"),
      path.join(projectPath, "families", "*.json"),
      path.join(projectPath, "scripts", "*.js"),
      path.join(projectPath, "scripts", "*.ts"),
    ],
    {
      persistent: true,
      ignoreInitial: true,
    },
  );

  projectWatcher.on("change", (filePath) => {
    console.log(`File changed: ${filePath}, re-indexing...`);
    debouncedSync(projectPath);
  });

  projectWatcher.on("unlink", (filePath) => {
    console.log(`File deleted: ${filePath}, re-indexing...`);
    debouncedSync(projectPath);
  });
}

// --- Electron Window and IPC ---

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.webContents.openDevTools();
};

app.on("ready", async () => {
  await loadState();
  
  // Pre-load embedding model
  console.log("Initializing local embedding model...");
  await xenovaModel.initialize();
  console.log("Local embedding model ready.");

  createWindow();

  ipcMain.handle("get-app-state", () => {
    return appState;
  });

  ipcMain.handle("update-app-state", async (_event, newState) => {
    appState = newState;
    await saveState();
  });

  ipcMain.handle("delete-project", async (_event, projectId: string) => {
    const projectIndex = appState.projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) return false;

    const project = appState.projects[projectIndex];
    const projectPath = project.path;

    appState.projects.splice(projectIndex, 1);
    if (appState.activeProjectId === projectId) {
      appState.activeProjectId = null;
    }
    await saveState();

    try {
      await mastra.getVector("construct-projects").deleteVectors({
        indexName: "project_content",
        filter: { projectPath } as any,
      });
      console.log(`Deleted vectors for project: ${projectPath}`);
    } catch (e) {
      console.error(`Failed to delete vectors for project ${projectPath}:`, e);
    }

    return true;
  });

  ipcMain.handle("select-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Select Construct 3 Project Folder",
    });

    if (!result.canceled && result.filePaths.length > 0) {
      currentProjectPath = result.filePaths[0];
      const id = path.basename(currentProjectPath);

      let project = appState.projects.find((p) => p.id === id);
      if (!project) {
        project = { id, name: id, path: currentProjectPath, threads: [] };
        appState.projects.push(project);
      }

      appState.activeProjectId = id;
      await saveState();

      startWatchingProject(currentProjectPath);
      syncProjectToVectorStore(currentProjectPath).catch((err) => {
        console.error("Failed to initial sync project:", err);
      });

      return project;
    }
    return null;
  });

  ipcMain.handle("ask-question", async (_event, messages: any[]) => {
    try {
      if (!appState.activeProjectId) return "Please load a project first.";
      const project = appState.projects.find(
        (p) => p.id === appState.activeProjectId,
      );
      if (!project) return "Active project not found.";
      currentProjectPath = project.path;

      if (!process.env.MISTRAL_API_KEY)
        return "Error: MISTRAL_API_KEY not found.";

      let fullText = "";
      const result = await agent.stream(messages);
      const reader = result.fullStream.getReader();

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        if (chunk.type === "tool-call") {
          const toolName = chunk.payload?.toolName || "unknown tool";
          const argsStr = JSON.stringify(chunk.payload?.args || {}).substring(
            0,
            100,
          );
          console.log(
            `\n🔍 [Agent Action] Calling '${toolName}' with args: ${argsStr}...`,
          );
          if (mainWindow) {
            mainWindow.webContents.send("agent-reflection", {
              type: "tool-call",
              toolName: toolName,
            });
          }
        } else if (chunk.type === "tool-result") {
          const resultStr = JSON.stringify(
            chunk.payload?.result || {},
          ).substring(0, 100);
          console.log(
            `✅ [Tool Result] '${chunk.payload?.toolName}' returned: ${resultStr}...\n`,
          );
        } else if (chunk.type === "text-delta") {
          const text = chunk.payload?.text || "";
          fullText += text;
          if (mainWindow) {
            mainWindow.webContents.send("agent-chunk", text);
          }
        }
      }

      return fullText;
    } catch (error: any) {
      console.error("Mastra Error:", error);
      return `Error: ${error.message || "Error processing request."}`;
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
