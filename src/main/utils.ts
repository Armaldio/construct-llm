import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { watch } from "chokidar";
import lodash from "lodash";
import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";

import {
  embeddingModel,
  setProjectStore,
  setAgentMemory,
  memoryStore,
  setCurrentWorkspace,
} from "./mastra";
import { appState } from "./state";

const { debounce } = lodash;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  try {
    const files = await fs.readdir(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        await getAllFiles(filePath, arrayOfFiles);
      } else {
        const ext = path.extname(file).toLowerCase();
        if ([".json", ".js", ".ts", ".md"].includes(ext)) {
          arrayOfFiles.push(filePath);
        }
      }
    }
  } catch (e) {
    // Directory might not exist
  }

  return arrayOfFiles;
}

export async function readProjectContext(projectPath: string): Promise<string | undefined> {
  try {
    const contextPath = path.join(projectPath, "llm-context.md");
    return await fs.readFile(contextPath, "utf8");
  } catch (e) {
    return undefined;
  }
}

// God Tier: Project Logic Brain
export interface ProjectBrain {
  objects: Set<string>;
  families: Set<string>;
  globalVariables: Set<string>;
  eventSheets: Record<
    string,
    {
      variables: string[];
      objectsReferenced: string[];
    }
  >;
}

export let projectBrain: ProjectBrain = {
  objects: new Set(),
  families: new Set(),
  globalVariables: new Set(),
  eventSheets: {},
};

export async function buildProjectBrain(projectPath: string) {
  console.log("[Brain] Starting structural scan...");
  const brain: ProjectBrain = {
    objects: new Set(),
    families: new Set(),
    globalVariables: new Set(),
    eventSheets: {},
  };

  try {
    // 0. Scan for project-specific instructions
    const project = appState.projects.find((p) => p.path === projectPath);
    if (project) {
      project.llmContext = await readProjectContext(projectPath);
    }

    // 1. Scan project.c3proj for base metadata
    const projFile = path.join(projectPath, "project.c3proj");
    const projData = JSON.parse(await fs.readFile(projFile, "utf8"));

    // 2. Scan event sheets for variables and object references
    const eventSheetDir = path.join(projectPath, "eventSheets");
    const files = await fs.readdir(eventSheetDir);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await fs.readFile(path.join(eventSheetDir, file), "utf8");
      const data = JSON.parse(content);

      const sheetName = path.basename(file, ".json");
      brain.eventSheets[sheetName] = {
        variables: [],
        objectsReferenced: [],
      };

      // Extract local variables and search for object names
      // (Simplified: in a real God Tier we'd do deeper JSON traversal)
      if (data.variables) {
        brain.eventSheets[sheetName].variables = data.variables.map((v: any) => v.name);
      }

      // Quick scan of the entire content string for known objects
      // We'll populate objects/families later from the project file
    }

    // 3. Populate Objects and Families from project data
    const extractNames = (node: any, set: Set<string>) => {
      if (!node) return;
      if (Array.isArray(node.items)) {
        node.items.forEach((i: any) => set.add(i));
      }
      if (Array.isArray(node.subfolders)) {
        node.subfolders.forEach((s: any) => extractNames(s, set));
      }
    };

    extractNames(projData.objectTypes, brain.objects);
    extractNames(projData.families, brain.families);

    projectBrain = brain;
    console.log(
      `[Brain] Scan complete. Found ${brain.objects.size} objects, ${brain.families.size} families.`,
    );
  } catch (e: any) {
    console.error("[Brain] Error building project brain:", e.message);
  }
}

export const debouncedSync = debounce((projectPath: string) => {
  buildProjectBrain(projectPath).catch(() => {});
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
  buildProjectBrain(projectPath); // God Tier: Initial scan on load

  if (projectWatcher) projectWatcher.close();
  projectWatcher = watch([path.join(projectPath, "**/*.json")], {
    persistent: true,
    ignoreInitial: true,
  });
  projectWatcher.on("all", () => debouncedSync(projectPath));
}
