import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import started from "electron-squirrel-startup";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { LibSQLVector, LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
import { mistral } from "@ai-sdk/mistral";
import { pipeline } from "@xenova/transformers";
import * as dotenv from "dotenv";
import chokidar from "chokidar";
import pkg from "lodash";
import { z } from "zod";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
const { debounce } = pkg;

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
          parameters: z.record(z.any()).optional(),
        }),
      ),
      actions: z.array(
        z.object({
          id: z.string(),
          objectClass: z.string(),
          parameters: z.record(z.any()).optional(),
        }),
      ),
    }),
  ),
});

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

const memoryStore = new LibSQLStore({
  id: "construct-memory",
  url: "file:construct-memory.db",
});

// Setup Xenova local embedder wrapper
class XenovaEmbedder {
  private embedder: any;

  async initialize() {
    if (!this.embedder) {
      this.embedder = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    }
  }

  async embed(texts: string[]) {
    await this.initialize();
    const outputs = await this.embedder(texts, {
      pooling: "mean",
      normalize: true,
    });
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

const customEmbedder = {
  specificationVersion: "v1",
  provider: "xenova",
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxEmbeddingsPerCall: 100,
  async doEmbed({ values }: { values: string[] }) {
    const embeddings = await xenovaModel.embed(values);
    return { embeddings };
  },
} as any;

const embeddingModel = customEmbedder;

const agentMemory = new Memory({
  storage: memoryStore,
  vector: vectorStore,
  embedder: embeddingModel,
  options: {
    lastMessages: 15,
    semanticRecall: {
      topK: 5,
      messageRange: { before: 2, after: 1 },
    },
    workingMemory: {
      enabled: true,
    },
  },
});

// --- Specialized Tools ---

const search_project = createVectorQueryTool({
  vectorStoreName: "construct-projects",
  indexName: "project_content",
  model: embeddingModel,
  id: "search_project",
  description:
    "Search the current project's event sheets, layouts, scripts, and object types.",
  reranker: {
    model: mistral("mistral-large-latest") as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const search_manual = createVectorQueryTool({
  vectorStoreName: "construct-projects",
  indexName: "manual_content",
  model: embeddingModel,
  id: "search_manual",
  description:
    "Search the official Construct 3 manual for condition/action IDs and engine rules.",
  reranker: {
    model: mistral("mistral-large-latest") as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const search_snippets = createVectorQueryTool({
  vectorStoreName: "construct-projects",
  indexName: "snippet_content",
  model: embeddingModel,
  id: "search_snippets",
  description:
    "Search the library of gold-standard Construct 3 JSON snippets and patterns.",
  reranker: {
    model: mistral("mistral-large-latest") as any,
    options: {
      weights: { semantic: 0.5, vector: 0.3, position: 0.2 },
      topK: 5,
    },
  },
});

const generate_c3_clipboard = {
  id: "generate_c3_clipboard",
  description:
    "Master tool to generate valid Construct 3 clipboard JSON. Use this when the user asks for pastable events/code.",
  inputSchema: z.object({
    logic: z.string().describe("The logical flow to generate."),
    objects: z
      .array(z.string())
      .describe(
        "List of actual object names from the project skeleton to use.",
      ),
  }),
  execute: async (
    { logic, objects }: { logic: string; objects: string[] },
    { mastra }: { mastra: any },
  ) => {
    const agent = mastra.getAgent("generator-agent");
    const result = await agent.generate(
      `Generate a Construct 3 clipboard JSON object for the following logic: ${logic}.
      Use these project objects: ${objects.join(", ")}.

      CRITICAL INSTRUCTIONS:
      1. Strictly follow the internal condition/action IDs found in the manual or snippets.
      2. The output MUST be a valid JSON object starting with {"is-c3-clipboard-data":true}.
      3. Do not include any conversational text, only the JSON.`,
      { output: C3ClipboardSchema },
    );
    return JSON.stringify(result.object);
  },
};

const list_project_addons = {
  id: "list_project_addons",
  description:
    "Lists all plugins and behaviors (addons) used in the current project.",
  inputSchema: z.object({}),
  execute: async () => {
    if (!currentProjectPath) return "No project loaded.";
    const c3projPath = path.join(currentProjectPath, "project.c3proj");
    try {
      const content = await fs.readFile(c3projPath, "utf8");
      const data = JSON.parse(content);
      if (!data.usedAddons) return "No addons found.";
      return JSON.stringify(
        data.usedAddons.map((a: any) => ({
          type: a.type,
          id: a.id,
          name: a.name,
        })),
      );
    } catch (e) {
      return "Error reading project file.";
    }
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
    if (!currentProjectPath) return "No project loaded.";
    const dirPath = path.join(currentProjectPath, directory);
    try {
      const files = await fs.readdir(dirPath);
      return JSON.stringify(
        files.filter(
          (f) => f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".ts"),
        ),
      );
    } catch (e) {
      return `Directory '${directory}' not found or empty.`;
    }
  },
};

const get_object_schema = {
  id: "get_object_schema",
  description: "Returns the detailed JSON schema for a specific object type.",
  inputSchema: z.object({
    objectName: z.string().describe("The name of the object type to look up."),
  }),
  execute: async ({ objectName }: { objectName: string }) => {
    if (!currentProjectPath) return "No project loaded.";
    const filePath = path.join(
      currentProjectPath,
      "objectTypes",
      `${objectName}.json`,
    );
    try {
      const content = await fs.readFile(filePath, "utf8");
      return content;
    } catch (e) {
      return `Object type '${objectName}' not found.`;
    }
  },
};

const search_events = {
  id: "search_events",
  description: "Performs a deterministic search across all event sheets.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The object name or keyword to search for in event sheets."),
  }),
  execute: async ({ query }: { query: string }) => {
    if (!currentProjectPath) return "No project loaded.";
    const eventSheetsDir = path.join(currentProjectPath, "eventSheets");
    try {
      const files = await fs.readdir(eventSheetsDir);
      const results = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await fs.readFile(
          path.join(eventSheetsDir, file),
          "utf8",
        );
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push(`Found match in ${file}`);
        }
      }
      return results.length > 0
        ? results.join("\n")
        : "No deterministic matches found in event sheets.";
    } catch (e) {
      return "Error searching event sheets.";
    }
  },
};

const audit_project = {
  id: "audit_project",
  description:
    "Audits the current Construct 3 project for performance and bloat.",
  inputSchema: z.object({}),
  execute: async () => {
    if (!currentProjectPath) return "No project loaded.";
    const eventSheetsDir = path.join(currentProjectPath, "eventSheets");
    const layoutsDir = path.join(currentProjectPath, "layouts");
    const c3projPath = path.join(currentProjectPath, "project.c3proj");
    let report = "## Project Audit Report\n\n";
    const usedObjectTypes = new Set<string>();
    const allObjectTypes = new Set<string>();
    const layoutStats: Record<string, number> = {};
    let globalEveryTick = 0;
    let globalDisabled = 0;
    let globalBlocks = 0;
    let globalEveryTickWithLoop = 0;
    let globalMissingTriggerOnce = 0;
    try {
      const projectContent = await fs.readFile(c3projPath, "utf8");
      const projectData = JSON.parse(projectContent);
      if (projectData.objectTypes?.items) {
        projectData.objectTypes.items.forEach((item: string) =>
          allObjectTypes.add(item),
        );
      }
      const layoutFiles = await fs.readdir(layoutsDir);
      for (const file of layoutFiles) {
        if (!file.endsWith(".json")) continue;
        const content = await fs.readFile(path.join(layoutsDir, file), "utf8");
        const data = JSON.parse(content);
        let instanceCount = 0;
        if (data.layers) {
          data.layers.forEach((layer: any) => {
            if (layer.instances) {
              instanceCount += layer.instances.length;
              layer.instances.forEach((inst: any) =>
                usedObjectTypes.add(inst.type),
              );
            }
          });
        }
        layoutStats[data.name] = instanceCount;
      }
      const sheetFiles = await fs.readdir(eventSheetsDir);
      for (const file of sheetFiles) {
        if (!file.endsWith(".json")) continue;
        const content = await fs.readFile(
          path.join(eventSheetsDir, file),
          "utf8",
        );
        try {
          const data = JSON.parse(content);
          let sheetEveryTick = 0;
          let sheetBlocks = 0;
          let maxDepth = 0;
          let sheetMissingTriggerOnce = 0;
          const traverse = (
            events: any[],
            depth: number,
            isInsideEveryTick: boolean,
          ) => {
            if (!events) return;
            maxDepth = Math.max(maxDepth, depth);
            for (const ev of events) {
              if (ev.eventType === "block" || ev.eventType === "group") {
                sheetBlocks++;
                globalBlocks++;
                if (ev.isActive === false) globalDisabled++;
                let hasEveryTick = false;
                let hasTriggerOnce = false;
                let hasComparison = false;
                if (ev.conditions) {
                  for (const cond of ev.conditions) {
                    usedObjectTypes.add(cond.objectClass);
                    if (
                      cond.id === "every-tick" &&
                      cond.objectClass === "System"
                    ) {
                      hasEveryTick = true;
                      sheetEveryTick++;
                      globalEveryTick++;
                    }
                    if (cond.id === "trigger-once") hasTriggerOnce = true;
                    if (
                      cond.id.startsWith("compare") ||
                      cond.id.startsWith("is-")
                    )
                      hasComparison = true;
                  }
                }
                if (hasComparison && !hasTriggerOnce && !hasEveryTick) {
                  sheetMissingTriggerOnce++;
                  globalMissingTriggerOnce++;
                }
                if (ev.actions) {
                  ev.actions.forEach((a: any) =>
                    usedObjectTypes.add(a.objectClass),
                  );
                }
                if (
                  isInsideEveryTick &&
                  ev.conditions?.some((c: any) => c.id === "for-each")
                ) {
                  globalEveryTickWithLoop++;
                }
                if (ev.children)
                  traverse(
                    ev.children,
                    depth + 1,
                    isInsideEveryTick || hasEveryTick,
                  );
              }
            }
          };
          traverse(data.events, 0, false);
          report += `### Sheet: ${data.name}\n- Total Blocks: ${sheetBlocks}\n- Max Nesting Depth: ${maxDepth}\n- "Every Tick" count: ${sheetEveryTick}\n`;
          if (sheetMissingTriggerOnce > 0)
            report += `- **Warning**: ${sheetMissingTriggerOnce} blocks might need "Trigger Once".\n`;
          report += `\n`;
        } catch (err) {
          report += `Error parsing sheet ${file}\n\n`;
        }
      }
      report += `## Global Summary\n\n`;
      const unusedObjects = Array.from(allObjectTypes).filter(
        (obj) => !usedObjectTypes.has(obj),
      );
      if (unusedObjects.length > 0) {
        report += `### Project Bloat\n- **Unused Object Types**: Found ${unusedObjects.length} objects never used. Consider deleting them.\n`;
        if (unusedObjects.length < 20)
          report += `  - *List*: ${unusedObjects.join(", ")}\n`;
      }
      report += `### Performance\n- **Total Blocks**: ${globalBlocks}\n- **Every Tick Conditions**: ${globalEveryTick}\n`;
      if (globalEveryTickWithLoop > 0)
        report += `- **Critical**: Found ${globalEveryTickWithLoop} loops inside an "Every Tick" block.\n`;
      if (globalDisabled > 10)
        report += `- **Note**: ${globalDisabled} disabled blocks found.\n`;
      report += `### Layout Heaviness\n`;
      for (const [name, count] of Object.entries(layoutStats))
        report += `- **${name}**: ${count} instances\n`;
      return report;
    } catch (e) {
      return "Error performing project audit.";
    }
  },
};

// --- Specialized Instructions ---

const baseInstructions = `
    You are an expert in the Construct 3 game engine.
    You have direct access to a wide suite of tools to analyze the current project and generate logic:
    - search_project, search_manual, search_snippets: For searching different context sources.
    - list_project_files, list_project_addons: To see exactly what's in the project.
    - get_object_schema, search_events: To dive deep into specific object or event logic.
    - audit_project: To perform performance checks.
    - generate_c3_clipboard: Use this specialized tool whenever the user asks for pastable events or logic.

    Always search the knowledge base before answering.

    STYLE RULES:
    - Be extremely concise. Go straight to the point.
    - Avoid conversational filler (e.g., "Certainly!", "I've analyzed your project", "Here is the logic you requested").
    - Do not explain technical details unless they are critical or specifically asked for.
    - If you are providing a logic block, just provide the block and a brief 1-sentence description.

    CRITICAL: Never use uncertain language like "likely", "probably", "inferred", or "I think".
    If a tool confirms a fact, state it as True. If a tool contradicts it, state it as False.
    If you cannot find the information after searching, state that the information is "Missing from the project files".
`;

const architectInstructions = `
    You are an Architect specialist for Construct 3 projects.
    Your expertise is in the overall project structure, layouts, object definitions, and family hierarchies.
    Use your tools to discover layouts, object types, and project configuration.
    Provide structural insights and list assets when requested.
`;

const logicExpertInstructions = `
    You are a Logic Expert for Construct 3 projects.
    Your expertise is in event sheets, conditions, actions, and general engine behavior.
    You know the internal IDs for system actions and standard plugin logic.
    Use your tools to search through existing event logic and the official manual.
    Provide performance advice and explain how specific logic blocks work.
`;

const scriptingInstructions = `
    You are a Scripting Specialist for Construct 3.
    Your expertise is in using JavaScript and TypeScript within the Construct 3 environment.
    You understand the C3 Scripting API (runtime, objects, instances).
    Provide code examples and explain how to bridge event logic with scripts.
`;

const generatorInstructions = `
    You are a Generator specialist for Construct 3.
    Your SOLE purpose is to generate perfectly valid Construct 3 clipboard JSON.
    --- GENERATION RULES ---
    - Use the Construct 3 Clipboard JSON format.
    - It must be a single line (minified) JSON object starting with {"is-c3-clipboard-data":true}.
    - ALWAYS use the exact "id" for conditions and actions as found in the manual or snippets.
    - ALWAYS use the exact "objectClass" names matching the current project skeleton.
`;

// --- Agents ---

const architect = new Agent({
  id: "architect-agent",
  name: "Architect",
  instructions: architectInstructions,
  model: mistral("mistral-large-latest"),
  memory: agentMemory,
  tools: {
    search_project,
    list_project_files,
    list_project_addons,
  },
});

const logicExpert = new Agent({
  id: "logic-expert-agent",
  name: "Logic Expert",
  instructions: logicExpertInstructions,
  model: mistral("mistral-large-latest"),
  memory: agentMemory,
  tools: {
    search_events,
    search_manual,
    audit_project,
    get_object_schema,
  },
});

const scriptingSpecialist = new Agent({
  id: "scripting-specialist-agent",
  name: "Scripting Specialist",
  instructions: scriptingInstructions,
  model: mistral("mistral-large-latest"),
  memory: agentMemory,
  tools: {
    search_project,
    search_manual,
  },
});

const generator = new Agent({
  id: "generator-agent",
  name: "Generator",
  instructions: generatorInstructions,
  model: mistral("mistral-large-latest"),
  memory: agentMemory,
  tools: {
    generate_c3_clipboard,
    search_snippets,
  },
});

const agent = new Agent({
  id: "construct-llm-agent",
  name: "Construct 3 Expert",
  instructions: baseInstructions,
  model: mistral("mistral-large-latest"),
  memory: agentMemory,
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
  },
});

const mastra = new Mastra({
  agents: { agent, architect, logicExpert, scriptingSpecialist, generator },
  vectors: {
    "construct-projects": vectorStore,
  },
});

async function updateAgentInstructions(projectPath: string) {
  const skeleton = await getProjectSkeleton(projectPath);
  (agent as any).instructions = baseInstructions + skeleton;
  console.log("Agent instructions updated with project skeleton.");
}

// --- Helper Functions ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getProjectSkeleton(projectPath: string): Promise<string> {
  const c3projPath = path.join(projectPath, "project.c3proj");
  try {
    const content = await fs.readFile(c3projPath, "utf8");
    const data = JSON.parse(content);
    let skeleton = `\n\n### CURRENT PROJECT STRUCTURE: ${data.name || "Untitled"}\n`;
    if (data.layouts?.items)
      skeleton += `**Layouts:** ${data.layouts.items.join(", ")}\n`;
    if (data.eventSheets?.items)
      skeleton += `**Event Sheets:** ${data.eventSheets.items.join(", ")}\n`;
    if (data.objectTypes?.items)
      skeleton += `**Object Types:** ${data.objectTypes.items.join(", ")}\n`;
    if (data.families?.items) {
      const families = data.families.items.map(
        (f: any) => `${f.name} (members: ${f.members.join(", ")})`,
      );
      skeleton += `**Families:** ${families.join("; ")}\n`;
    }
    if (data.timelines?.items)
      skeleton += `**Timelines:** ${data.timelines.items.join(", ")}\n`;
    if (data.usedAddons) {
      const addons = data.usedAddons.map(
        (a: any) => `${a.name} (${a.type}: ${a.id})`,
      );
      skeleton += `**Used Addons:** ${addons.join(", ")}\n`;
    }
    return skeleton;
  } catch (e) {
    return "";
  }
}

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
        let waitTime = 2000 * Math.pow(2, i);
        if (remaining === "0") {
          console.warn("Mistral Rate Limit Reached. Waiting longer...");
          waitTime = 10000;
        }
        console.warn(`Rate limit hit, retrying in ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries reached");
}

async function syncProjectToVectorStore(projectPath: string, force = false) {
  const vStore = mastra.getVector("construct-projects");

  if (!force) {
    try {
      const stats = await vStore.describeIndex({
        indexName: "project_content",
      });
      // @ts-ignore
      const count = stats?.count || stats?.vectorCount || 0;
      if (count > 50) {
        console.log("Project already indexed, skipping.");
        return;
      }
    } catch (e) {}
  } else {
    console.log("Force re-indexing project, clearing old vectors...");
    try {
      await vStore.deleteVectors({
        indexName: "project_content",
        filter: { projectPath } as any,
      });
    } catch (e) {
      console.error("Failed to clear old vectors:", e);
    }
  }

  console.log("Indexing project:", projectPath);
  if (mainWindow) {
    mainWindow.webContents.send("indexing-status", {
      status: "indexing",
      projectPath,
    });
  }
  try {
    await vStore.createIndex({ indexName: "project_content", dimension: 384 });
  } catch (e) {}
  const vectorsToUpsert: number[][] = [];
  const idsToUpsert: string[] = [];
  const metadataToUpsert: Record<string, any>[] = [];
  const processFileChunks = async (
    chunks: { text: string; metadata: any }[],
    filePath: string,
  ) => {
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const res = await embeddingModel.doEmbed({ values: [chunk.text] });
        if (res && res.embeddings && res.embeddings[0]) {
          vectorsToUpsert.push(Array.from(res.embeddings[0] as number[]));
          idsToUpsert.push(
            `project-${projectPath}-${filePath}-chunk-${i}`.replace(
              /[^a-zA-Z0-9-]/g,
              "_",
            ),
          );
          metadataToUpsert.push(chunk.metadata);
        }
      } catch (err) {
        console.error(`Failed to embed chunk ${i} of ${filePath}:`, err);
      }
    }
  };
  const c3projPath = path.join(projectPath, "project.c3proj");
  try {
    const stats = await fs.stat(c3projPath);
    if (stats.isFile()) {
      const content = await fs.readFile(c3projPath, "utf8");
      const doc = MDocument.fromText(content, {
        metadata: { path: "project.c3proj", projectPath },
      });
      const docChunks = await doc.chunk({
        strategy: "recursive",
        maxSize: 1000,
        overlap: 100,
      });
      await processFileChunks(
        docChunks.map((c) => ({
          text: c.text,
          metadata: { text: c.text, path: "project.c3proj", projectPath },
        })),
        "project.c3proj",
      );
    }
  } catch (e) {}
  const eventSheetsDir = path.join(projectPath, "eventSheets");
  try {
    const files = await fs.readdir(eventSheetsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `eventSheets/${file}`;
      const content = await fs.readFile(
        path.join(eventSheetsDir, file),
        "utf8",
      );
      try {
        const data = JSON.parse(content);
        const sheetName = data.name;
        const chunks: { text: string; metadata: any }[] = [];
        const processEvent = (event: any, parentStr: string = "") => {
          if (event.eventType === "block" || event.eventType === "group") {
            let text = `Event Sheet: ${sheetName}\nType: ${event.eventType}\n`;
            if (parentStr) text = `${parentStr}\n` + text;
            if (event.isActive === false) text += `(Disabled)\n`;
            if (event.conditions) {
              text += `Conditions:\n`;
              event.conditions.forEach((c: any) => {
                text += `- ${c.objectClass}: ${c.id} ${c.parameters ? JSON.stringify(c.parameters) : ""}\n`;
              });
            }
            if (event.actions) {
              text += `Actions:\n`;
              event.actions.forEach((a: any) => {
                text += `- ${a.objectClass}: ${a.id} ${a.parameters ? JSON.stringify(a.parameters) : ""}\n`;
              });
            }
            chunks.push({
              text,
              metadata: {
                text,
                path: filePath,
                projectPath,
                rawJson: JSON.stringify(event).substring(0, 500),
              },
            });
            if (event.children)
              event.children.forEach((child: any) =>
                processEvent(child, `Parent Block in ${sheetName}`),
              );
          }
        };
        if (data.events)
          data.events.forEach((event: any) => processEvent(event));
        await processFileChunks(chunks, filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}
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
            if (layer.instances) {
              layer.instances.forEach((inst: any) => {
                let text = `Layout: ${layoutName}\nLayer: ${layerName}\nInstance Type: ${inst.type}\nUID: ${inst.uid}\n`;
                if (inst.world)
                  text += `Position: ${inst.world.x}, ${inst.world.y}\n`;
                if (inst.properties)
                  text += `Properties: ${JSON.stringify(inst.properties)}\n`;
                chunks.push({
                  text,
                  metadata: { text, path: filePath, projectPath },
                });
              });
            }
          });
        }
        await processFileChunks(chunks, filePath);
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}
  const objectTypesDir = path.join(projectPath, "objectTypes");
  try {
    const files = await fs.readdir(objectTypesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `objectTypes/${file}`;
      const content = await fs.readFile(
        path.join(objectTypesDir, file),
        "utf8",
      );
      try {
        const data = JSON.parse(content);
        let text = `Object Type: ${data.name}\nPlugin ID: ${data["plugin-id"]}\nIs Global: ${data.isGlobal}\n`;
        if (data.instanceVariables)
          text += `Instance Variables: ${data.instanceVariables.map((v: any) => v.name + " (" + v.type + ")").join(", ")}\n`;
        if (data.behaviorTypes)
          text += `Behaviors: ${data.behaviorTypes.map((b: any) => b.name + " (" + b["behavior-id"] + ")").join(", ")}\n`;
        await processFileChunks(
          [{ text, metadata: { text, path: filePath, projectPath } }],
          filePath,
        );
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}
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
        if (data.members) text += `Members: ${data.members.join(", ")}\n`;
        if (data.instanceVariables)
          text += `Instance Variables: ${data.instanceVariables.map((v: any) => v.name + " (" + v.type + ")").join(", ")}\n`;
        if (data.behaviorTypes)
          text += `Behaviors: ${data.behaviorTypes.map((b: any) => b.name + " (" + b["behavior-id"] + ")").join(", ")}\n`;
        await processFileChunks(
          [{ text, metadata: { text, path: filePath, projectPath } }],
          filePath,
        );
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}
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
      const docChunks = await doc.chunk({
        strategy: "recursive",
        maxSize: 1000,
        overlap: 100,
      });
      await processFileChunks(
        docChunks.map((c) => ({
          text: c.text,
          metadata: { text: c.text, path: filePath, projectPath },
        })),
        filePath,
      );
    }
  } catch (e) {}
  const timelinesDir = path.join(projectPath, "timelines");
  try {
    const files = await fs.readdir(timelinesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = `timelines/${file}`;
      const content = await fs.readFile(path.join(timelinesDir, file), "utf8");
      try {
        const data = JSON.parse(content);
        let text = `Timeline: ${data.name}\n`;
        if (data.tracks) text += `Tracks: ${data.tracks.length}\n`;
        await processFileChunks(
          [{ text, metadata: { text, path: filePath, projectPath } }],
          filePath,
        );
      } catch (err) {
        console.error(`Error parsing JSON for ${filePath}:`, err);
      }
    }
  } catch (e) {}
  if (vectorsToUpsert.length > 0) {
    await vStore.upsert({
      indexName: "project_content",
      vectors: vectorsToUpsert,
      ids: idsToUpsert,
      metadata: metadataToUpsert,
    });
  }
  if (mainWindow)
    mainWindow.webContents.send("indexing-status", {
      status: "complete",
      projectPath,
    });
}

async function syncGlobalAssetsToVectorStore() {
  const vStore = mastra.getVector("construct-projects");
  try {
    await vStore.createIndex({ indexName: "manual_content", dimension: 384 });
    await vStore.createIndex({ indexName: "snippet_content", dimension: 384 });
  } catch (e) {}
  const processAndUpsert = async (
    chunks: { text: string; metadata: any }[],
    prefix: string,
    indexName: string,
  ) => {
    const vectors: number[][] = [];
    const ids: string[] = [];
    const metadata: Record<string, any>[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const res = await embeddingModel.doEmbed({ values: [chunk.text] });
        if (res && res.embeddings && res.embeddings[0]) {
          vectors.push(Array.from(res.embeddings[0] as number[]));
          ids.push(
            `global-${prefix}-chunk-${i}`.replace(/[^a-zA-Z0-9-]/g, "_"),
          );
          metadata.push(chunk.metadata);
        }
      } catch (err) {
        console.error(`Failed to embed chunk ${i} of ${prefix}:`, err);
      }
    }
    if (vectors.length > 0)
      await vStore.upsert({ indexName, vectors, ids, metadata });
  };
  try {
    const stats = await vStore.describeIndex({ indexName: "manual_content" });
    // @ts-ignore
    const count = stats?.count || stats?.vectorCount || 0;
    if (count === 0) {
      const pdfPath = path.join(process.cwd(), "assets", "construct-3.pdf");
      const dataBuffer = await fs.readFile(pdfPath);
      // @ts-ignore
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      const doc = MDocument.fromText(result.text, {
        metadata: { path: "assets/construct-3.pdf", type: "manual" },
      });
      const docChunks = await doc.chunk({
        strategy: "recursive",
        maxSize: 1000,
        overlap: 100,
      });
      await processAndUpsert(
        docChunks.map((c) => ({
          text: c.text,
          metadata: {
            text: c.text,
            path: "assets/construct-3.pdf",
            type: "manual",
          },
        })),
        "manual",
        "manual_content",
      );
    }
  } catch (e) {}
  try {
    const stats = await vStore.describeIndex({ indexName: "snippet_content" });
    // @ts-ignore
    const count = stats?.count || stats?.vectorCount || 0;
    if (count === 0) {
      const snippetsDir = path.join(process.cwd(), "snippets");
      const files = await fs.readdir(snippetsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await fs.readFile(path.join(snippetsDir, file), "utf8");
        const text = `Snippet: ${file}\nDescription: Example of valid Construct 3 JSON.\nContent:\n${content}`;
        await processAndUpsert(
          [
            {
              text,
              metadata: { text, path: `snippets/${file}`, type: "snippet" },
            },
          ],
          `snippet-${file}`,
          "snippet_content",
        );
      }
    }
  } catch (e) {}
}

const debouncedSync = debounce((projectPath: string) => {
  updateAgentInstructions(projectPath).catch(() => {});
  syncProjectToVectorStore(projectPath).catch((err) => {
    console.error("Failed to sync project:", err);
  });
}, 2000);

function startWatchingProject(projectPath: string) {
  if (projectWatcher) projectWatcher.close();
  projectWatcher = chokidar.watch(
    [
      path.join(projectPath, "project.c3proj"),
      path.join(projectPath, "layouts", "*.json"),
      path.join(projectPath, "eventSheets", "*.json"),
      path.join(projectPath, "objectTypes", "*.json"),
      path.join(projectPath, "families", "*.json"),
      path.join(projectPath, "timelines", "*.json"),
      path.join(projectPath, "scripts", "*.js"),
      path.join(projectPath, "scripts", "*.ts"),
    ],
    { persistent: true, ignoreInitial: true },
  );
  projectWatcher.on("all", (event, p) => {
    console.log(`Watcher Event: ${event} on ${p}`);
    debouncedSync(projectPath);
  });
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
};

app.on("ready", async () => {
  const sendProgress = (step: string, detail?: string) => {
    if (mainWindow)
      mainWindow.webContents.send("startup-progress", { step, detail });
    console.log(`Startup: ${step} ${detail || ""}`);
  };
  await loadState();
  createWindow();
  await sleep(1000);
  sendProgress("Loading state...");
  sendProgress("Initializing embeddings...");
  await xenovaModel.initialize();
  sendProgress("Syncing assets...");
  await syncGlobalAssetsToVectorStore();
  if (appState.activeProjectId) {
    const p = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (p) {
      sendProgress("Syncing project...", p.name);
      await updateAgentInstructions(p.path);
      await syncProjectToVectorStore(p.path);
    }
  }
  sendProgress("Ready!");
  isStartupComplete = true;
  if (mainWindow) mainWindow.webContents.send("startup-complete");
});

let isStartupComplete = false;

ipcMain.handle("is-startup-complete", () => isStartupComplete);

ipcMain.handle("get-app-state", () => appState);
ipcMain.handle("update-app-state", async (_, s) => {
  appState = s;
  await saveState();
});
ipcMain.handle("delete-project", async (_, id) => {
  const idx = appState.projects.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  const pPath = appState.projects[idx].path;
  appState.projects.splice(idx, 1);
  if (appState.activeProjectId === id) appState.activeProjectId = null;
  await saveState();
  try {
    await mastra
      .getVector("construct-projects")
      .deleteVectors({
        indexName: "project_content",
        filter: { projectPath: pPath } as any,
      });
  } catch (e) {}
  return true;
});

ipcMain.handle("force-reindex", async () => {
  if (!appState.activeProjectId) return false;
  const project = appState.projects.find(
    (p) => p.id === appState.activeProjectId,
  );
  if (!project) return false;

  await updateAgentInstructions(project.path);
  await syncProjectToVectorStore(project.path, true);
  return true;
});

ipcMain.handle("select-project", async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "Select Construct 3 Project Folder",
  });
  if (!res.canceled && res.filePaths.length > 0) {
    currentProjectPath = res.filePaths[0];
    const id = path.basename(currentProjectPath);
    let p = appState.projects.find((p) => p.id === id);
    if (!p) {
      p = { id, name: id, path: currentProjectPath, threads: [] };
      appState.projects.push(p);
    }
    appState.activeProjectId = id;
    await saveState();
    await updateAgentInstructions(currentProjectPath);
    startWatchingProject(currentProjectPath);
    syncProjectToVectorStore(currentProjectPath).catch(() => {});
    return p;
  }
  return null;
});
ipcMain.handle(
  "ask-question",
  async (_, { text, threadId }: { text: string; threadId: string }) => {
    try {
      if (!appState.activeProjectId) return "No project loaded.";
      const p = appState.projects.find(
        (p) => p.id === appState.activeProjectId,
      );
      if (!p) return "Project not found.";
      currentProjectPath = p.path;
      if (!process.env.MISTRAL_API_KEY) return "No API Key.";
      let fullText = "";
      const result = await agent.stream(text, {
        threadId,
        resourceId: currentProjectPath,
      });

      if (!result || !result.fullStream) {
        throw new Error("Failed to initialize stream from agent.");
      }

      const reader = result.fullStream.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (chunk.type === "tool-call") {
          const tName = chunk.payload?.toolName || "unknown";
          if (mainWindow)
            mainWindow.webContents.send("agent-reflection", {
              type: "thought",
              content: `Tool: ${tName}`,
            });
        } else if (chunk.type === "text-delta") {
          const text = chunk.payload?.text || "";
          fullText += text;
          if (mainWindow) mainWindow.webContents.send("agent-chunk", text);
        }
      }
      return fullText;
    } catch (error: any) {
      console.error("Mastra Error:", error);
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
