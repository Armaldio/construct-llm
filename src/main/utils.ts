import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { watch } from "chokidar";
import lodash from "lodash";
import { MDocument } from "@mastra/rag";
import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";

import {
  getProjectStore,
  embeddingModel,
  setProjectStore,
  setAgentMemory,
  memoryStore,
  getGlobalMainWindow,
  setCurrentWorkspace,
} from "./mastra";
import { appState } from "./state";

const { debounce } = lodash;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
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

export let indexCache: Record<string, number> = {};
export const indexCachePath = path.join(app.getPath("userData"), "index-cache.json");

export async function loadIndexCache() {
  try {
    const data = await fs.readFile(indexCachePath, "utf8");
    indexCache = JSON.parse(data);
  } catch (e) {
    indexCache = {};
  }
}

export async function saveIndexCache() {
  try {
    await fs.writeFile(indexCachePath, JSON.stringify(indexCache, null, 2));
  } catch (e) {
    console.error("Failed to save index cache:", e);
  }
}

export async function syncProjectToVectorStore(projectPath: string, force = false) {
  const mainWindow = getGlobalMainWindow();
  try {
    await getProjectStore().createIndex({
      indexName: "project_content",
      dimension: 384,
    });
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
    await loadIndexCache();
    const allFiles = await getAllFiles(projectPath);

    let filesProcessed = 0;
    let filesActuallyIndexed = 0;
    for (const filePath of allFiles) {
      filesProcessed++;
      try {
        const stat = await fs.stat(filePath);
        const mtimeMs = stat.mtimeMs;
        const relativePath = path.relative(projectPath, filePath);

        if (!force && indexCache[filePath] === mtimeMs) {
          continue;
        }

        filesActuallyIndexed++;

        if (mainWindow) {
          mainWindow.webContents.send("indexing-status", {
            status: "indexing",
            projectPath,
            file: relativePath,
            progress: Math.round((filesProcessed / allFiles.length) * 100),
          });
        }

        const content = await fs.readFile(filePath, "utf8");
        if (!content || content.trim().length === 0) {
          indexCache[filePath] = mtimeMs;
          continue;
        }

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
            await getProjectStore().upsert({
              indexName: "project_content",
              vectors,
              ids,
              metadata,
            });
          }

          await sleep(5);
        }

        indexCache[filePath] = mtimeMs;
      } catch (err: any) {
        console.error(`Failed to index file ${filePath}:`, err.message);
      }
      await sleep(10);
    }

    await saveIndexCache();

    if (mainWindow) {
      mainWindow.webContents.send("indexing-status", {
        status: "complete",
        projectPath,
      });
    }
  } catch (error: any) {
    console.error("Error in syncProjectToVectorStore:", error.message);
    if (mainWindow) {
      mainWindow.webContents.send("indexing-status", {
        status: "error",
        error: error.message,
      });
    }
  }
}

export const debouncedSync = debounce((projectPath: string) => {
  syncProjectToVectorStore(projectPath).catch(() => {});
}, 2000);

export let projectWatcher: ReturnType<typeof watch> | null = null;

export function updateWorkspace(projectPath: string, projectId: string) {
  const projectDbPath = path.join(app.getPath("userData"), `project-${projectId}.db`);
  const projectStore = new LibSQLVector({
    id: `project-store-${projectId}`,
    url: `file:${projectDbPath}`,
  });
  setProjectStore(projectStore);

  const agentMemory = new Memory({
    storage: memoryStore,
    vector: projectStore,
    embedder: embeddingModel,
  });
  setAgentMemory(agentMemory);

  const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath: projectPath }),
    sandbox: new LocalSandbox({ workingDirectory: projectPath }),
    bm25: true,
    lsp: { packageRunner: "npx --yes" },
    tools: {
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { enabled: false },
      [WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT]: { enabled: false },
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { enabled: false },
    },
  });

  setCurrentWorkspace(workspace);

  workspace.init().catch((err) => {
    console.error("[Workspace Init Error]:", err);
  });
}

export function startWatchingProject(projectId: string, projectPath: string) {
  updateWorkspace(projectPath, projectId);
  if (projectWatcher) projectWatcher.close();
  projectWatcher = watch([path.join(projectPath, "**/*.json")], {
    persistent: true,
    ignoreInitial: true,
  });
  projectWatcher.on("all", () => debouncedSync(projectPath));
}
