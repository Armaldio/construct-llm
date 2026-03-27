import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import started from "electron-squirrel-startup";

import { Agent } from "@mastra/core/agent";
import { Workspace, LocalFilesystem, LocalSandbox, createWorkspaceTools, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { LibSQLVector, LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
import { RequestContext } from "@mastra/core/request-context";

import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { watch } from "chokidar";
import lodash from "lodash";
import { z } from "zod";
const { debounce } = lodash;

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

// --- Interfaces ---

interface ModelConfig {
  provider: string;
  modelId?: string;
  apiKey?: string;
}

interface Reflection {
  id: number;
  content: string;
  type: "info" | "tool" | "result" | "thought";
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  argsText?: string;
  result?: unknown;
  transient?: boolean;
}

interface ChatMessagePart {
  type: "text" | "reflection" | "c3-clipboard" | "thought";
  content: string;
  metadata?: Record<string, unknown>;
  reflections?: Reflection[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reflections?: Reflection[];
  parts?: ChatMessagePart[];
}

interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  modelConfig: ModelConfig;
  agentId?: string;
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
  apiKeys?: Record<string, string>;
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
let lastUsedModelConfig: ModelConfig | null = null;
let currentWorkspace: Workspace | null = null;

const storagePath = path.join(app.getPath("userData"), "storage.json");
const keysPath = path.join(app.getPath("userData"), "keys.bin");
const globalDbPath = app.isPackaged
  ? path.join(process.resourcesPath, "prebuilt-assets.db")
  : path.join(process.cwd(), "prebuilt-assets.db");

// --- Persistence ---

async function saveState() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKeys, ...stateToSave } = appState;
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
        startWatchingProject(project.id, project.path);
      }
    }
  } catch (e) {
    appState = { projects: [], activeProjectId: null };
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = await fs.readFile(keysPath);
      try {
        encryptedApiKeys = JSON.parse(safeStorage.decryptString(buffer));
        console.log("[DEBUG] API keys loaded successfully using safeStorage.");
      } catch (e) {
        // Maybe it was saved as plain text before safeStorage was available or vice-versa?
        const text = buffer.toString();
        encryptedApiKeys = JSON.parse(text);
        console.log("[DEBUG] API keys loaded as plain text (safeStorage decryption failed).");
      }
    } else {
      console.warn(
        "[WARNING] safeStorage is not available. Attempting to load API keys as plain text.",
      );
      const data = await fs.readFile(keysPath, "utf8");
      encryptedApiKeys = JSON.parse(data);
    }
  } catch (e) {
    encryptedApiKeys = {};
  }
}

async function saveKeys(keys: Record<string, string>) {
  // Trim keys to avoid whitespace issues
  const trimmedKeys: Record<string, string> = {};
  Object.keys(keys).forEach((k) => {
    trimmedKeys[k] = keys[k].trim();
  });

  encryptedApiKeys = { ...encryptedApiKeys, ...trimmedKeys };
  if (safeStorage.isEncryptionAvailable()) {
    try {
      await fs.writeFile(keysPath, safeStorage.encryptString(JSON.stringify(encryptedApiKeys)));
      console.log("[DEBUG] API keys saved successfully using safeStorage.");
    } catch (e: unknown) {
      const err = e as Error;
      console.error("[ERROR] Failed to save API keys with safeStorage:", err.message);
    }
  } else {
    console.error("[ERROR] safeStorage not available. Saving API keys as plain text.");
    await fs.writeFile(keysPath, JSON.stringify(encryptedApiKeys));
  }
}

// --- Mastra Configuration ---

const globalStore = new LibSQLVector({
  id: "construct-projects",
  url: `file:${globalDbPath}`,
});

const memoryStore = new LibSQLStore({
  id: "construct-memory",
  url: `file:${path.join(app.getPath("userData"), "construct-memory.db")}`,
});

let projectStore: LibSQLVector | undefined;
let agentMemory: Memory | undefined;

function getProjectStore() {
  if (!projectStore) {
    throw new Error("No project store initialized. Please load a project first.");
  }
  return projectStore;
}

function getAgentMemory() {
  if (!agentMemory) {
    throw new Error("No agent memory initialized. Please load a project first.");
  }
  return agentMemory;
}

const pendingEmbeddings = new Map<
  number,
  { resolve: (val: { embeddings: number[][] }) => void; reject: (err: Error) => void }
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

let embeddingRequestId = 0;

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

// --- Tools ---

const search_project = {
  id: "search_project",
  description:
    "Search the current project for specific logic, layouts, or event sheets using semantic vector search. Use this for general concepts. CRITICAL: If you are searching for a specific Object Type (e.g., Player_Base), DO NOT use this tool. Use the 'get_object_schema' tool instead, as vector search is poor at exact matches.",
  inputSchema: z.object({
    queryText: z.string().describe("The search query."),
  }),
  execute: async ({ queryText }: { queryText: string }) => {
    const sanitizedQuery = queryText.replace(/^[#@]/, "");
    try {
      const { embeddings } = await embeddingModel.doEmbed({ values: [sanitizedQuery] });
      const queryVector = embeddings[0];

      const results = await getProjectStore().query({
        indexName: "project_content",
        queryVector,
        topK: 3,
      });

      let response = "";

      if (results.length > 0) {
        response +=
          "### Semantic Search Results ###\n" +
          results
            .map((r: any, i: number) => {
              const text = r.metadata?.text || "";
              const truncated = text.length > 2500 ? text.substring(0, 2500) + "..." : text;
              return `--- Result ${i + 1} (${r.metadata?.path}) ---\n${truncated}`;
            })
            .join("\n\n");
      }

      // Add a fallback exact text search across all project files
      if (currentProjectPath) {
        const allFiles = await getAllFiles(currentProjectPath);
        const exactMatches = [];
        for (const file of allFiles) {
          const content = await fs.readFile(file, "utf8");
          if (content.toLowerCase().includes(sanitizedQuery.toLowerCase())) {
            exactMatches.push(path.relative(currentProjectPath, file));
          }
        }

        if (exactMatches.length > 0) {
          response += "\n\n### Exact Text Matches Found In ###\n" + exactMatches.join("\n");
        }
      }

      if (!response) return "No relevant project context found.";

      return response;
    } catch (e: any) {
      console.error("[DEBUG] Error in search_project tool:", e.message);
      return `Error searching project: ${e.message}`;
    }
  },
};

const search_manual = {
  id: "search_manual",
  description:
    "Search the official Construct 3 manual for engine rules, behavior details, or syntax. Use this to verify how Construct 3 features work.",
  inputSchema: z.object({
    queryText: z.string().describe("The search query."),
  }),
  execute: async ({ queryText }: { queryText: string }) => {
    const sanitizedQuery = queryText.replace(/^[#@]/, "");
    try {
      const { embeddings } = await embeddingModel.doEmbed({ values: [sanitizedQuery] });
      const queryVector = embeddings[0];

      const results = await globalStore.query({
        indexName: "manual_content",
        queryVector,
        topK: 3,
      });

      if (results.length === 0) return "No relevant manual entries found.";

      return results
        .map((r: any, i: number) => {
          const text = r.metadata?.text || "";
          const truncated = text.length > 2500 ? text.substring(0, 2500) + "..." : text;
          return `--- Manual Section ${i + 1}: ${r.metadata?.title} ---\nSource: ${r.metadata?.url}\n\n${truncated}`;
        })
        .join("\n\n");
    } catch (e: any) {
      console.error("[DEBUG] Error in search_manual tool:", e.message);
      return `Error searching manual: ${e.message}`;
    }
  },
};

const search_snippets = {
  id: "search_snippets",
  description:
    "Search for gold-standard Construct 3 event JSON snippets. Use this to find correct JSON structures to show to the user or when generating logic.",
  inputSchema: z.object({
    queryText: z.string().describe("The search query."),
  }),
  execute: async ({ queryText }: { queryText: string }) => {
    const sanitizedQuery = queryText.replace(/^[#@]/, "");
    try {
      const { embeddings } = await embeddingModel.doEmbed({ values: [sanitizedQuery] });
      const queryVector = embeddings[0];

      const results = await globalStore.query({
        indexName: "snippet_content",
        queryVector,
        topK: 3,
      });

      if (results.length === 0) return "No relevant snippets found.";

      return results
        .map((r: any, i: number) => {
          const text = r.metadata?.text || "";
          const truncated = text.length > 2500 ? text.substring(0, 2500) + "..." : text;
          return `--- Snippet ${i + 1} (${r.metadata?.path}) ---\n${truncated}`;
        })
        .join("\n\n");
    } catch (e: any) {
      console.error("[DEBUG] Error in search_snippets tool:", e.message);
      return `Error searching snippets: ${e.message}`;
    }
  },
};

// Base item for recursion
const C3EventItemBaseSchema = z.object({
  eventType: z.enum(["block", "group", "comment"]),
  conditions: z
    .array(
      z.object({
        id: z.string(),
        objectClass: z.string(),
        parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    )
    .optional(),
  actions: z
    .array(
      z.object({
        id: z.string(),
        objectClass: z.string(),
        parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    )
    .optional(),
  title: z.string().optional(),
  text: z.string().optional(),
});

// Full item with recursion
type C3EventItem = z.infer<typeof C3EventItemBaseSchema> & {
  children?: C3EventItem[];
};

const C3EventItemSchema: z.ZodType<C3EventItem> = C3EventItemBaseSchema.extend({
  children: z.lazy(() => z.array(C3EventItemSchema)).optional(),
});

const C3ClipboardSchema = z.object({
  "is-c3-clipboard-data": z.literal(true),
  type: z.literal("events"),
  items: z.array(C3EventItemSchema),
});

const generate_c3_clipboard = {
  id: "generate_c3_clipboard",
  description:
    "Generates Construct 3 clipboard JSON from logic. Use this when the user asks to generate events, code, or logic. CRITICAL: The results of this tool are automatically displayed in a dedicated UI block. DO NOT repeat the JSON in your final text response. Simply confirm the logic is ready.",
  inputSchema: z.object({
    logic: z.string().describe("The logical flow to generate."),
    objects: z.array(z.string()).describe("List of object names to use."),
    contextSnippets: z
      .string()
      .optional()
      .describe("Optional snippet templates to use as reference."),
  }),
  execute: async ({
    logic,
    objects,
    contextSnippets,
  }: {
    logic: string;
    objects: string[];
    contextSnippets?: string;
  }) => {
    try {
      const config = lastUsedModelConfig || { provider: "mistral" };
      const model = getDynamicModel(config);

      const prompt = `You are a Construct 3 JSON generator.
Convert the following logic into a valid Construct 3 clipboard JSON object.

### LOGIC TO CONVERT:
${logic}

### OBJECTS TO USE:
${objects.join(", ")}

${contextSnippets ? `### REFERENCE SNIPPETS:\n${contextSnippets}` : ""}

Output ONLY the JSON object following the schema. Do not include any other text, Markdown blocks, or preamble. This JSON will be parsed directly by the system.`;

      // Use the base generator agent but WITHOUT tools to prevent recursion
      const simpleGenerator = new Agent({
        id: "simple-generator",
        name: "Generator",
        instructions:
          "You are a Construct 3 JSON generator. You MUST output ONLY valid JSON that conforms to the provided schema. No markdown, no explanations, no text before or after the JSON.",
        model,
      });

      const result = await simpleGenerator.generate(prompt, {
        structuredOutput: { schema: C3ClipboardSchema },
      });

      // Return a wrapper that contains the data for the UI and a message for the LLM
      return {
        "is-c3-clipboard-data": true,
        data: result.object,
        ___CRITICAL_INSTRUCTION_DO_NOT_IGNORE___:
          "The events have been successfully rendered in a separate UI block above your message. DO NOT repeat the JSON in your response. Simply explain the logic or confirm it's ready. If you include JSON code blocks, the user's view will be cluttered and they will be frustrated.",
      };
    } catch (e: any) {
      console.error("[DEBUG] Error in generate_c3_clipboard tool:", e.message);
      return `Error generating clipboard JSON: ${e.message}`;
    }
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
      const files = await getAllFiles(dirPath);
      return JSON.stringify(files.map((f) => path.relative(dirPath, f).replace(/\\/g, "/")));
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
    const sanitizedName = objectName.replace(/^[#@]/, "");
    try {
      const dirPath = path.join(currentProjectPath, "objectTypes");
      const files = await getAllFiles(dirPath);
      const targetPath = files.find(
        (f) => path.basename(f).toLowerCase() === `${sanitizedName.toLowerCase()}.json`,
      );
      if (targetPath) {
        return await fs.readFile(targetPath, "utf8");
      }
      return "Not found.";
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
    const sanitizedQuery = query.replace(/^[#@]/, "");
    const dir = path.join(currentProjectPath, "eventSheets");
    try {
      const files = await getAllFiles(dir);
      const res = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        if ((await fs.readFile(f, "utf8")).toLowerCase().includes(sanitizedQuery.toLowerCase()))
          res.push(path.relative(currentProjectPath, f).replace(/\\/g, "/"));
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

const record_thought = {
  id: "record_thought",
  description:
    "Record your internal reasoning, plan, or progress. Use this to keep the user informed during complex multi-step tasks. CRITICAL: If you are about to generate events, remind yourself here that you MUST use the 'generate_c3_clipboard' tool and you MUST NOT repeat the JSON in the final answer.",
  inputSchema: z.object({
    thought: z.string().describe("Your internal reasoning or plan."),
  }),
  execute: async ({ thought }: { thought: string }) => {
    return "Thought recorded. REMINDER: Do not repeat JSON in the final answer.";
  },
};

// --- Agents ---

const AGENT_CONFIGS: Record<string, any> = {
  "architect-agent": {
    name: "Architect",
    instructions:
      "You are a Construct 3 Architect. Use tools to research the project structure, layouts, and families. Always gather current project context before answering.\n\nREASONING RULE: Before using any tool or giving a final answer, you MUST use the 'record_thought' tool to document your plan and reasoning. Think step-by-step about what you need to know and how you will find it.\n\nTONE AND STYLE: Speak naturally and conversationally in paragraphs, like a human expert. Keep your final answers concise and flowing. DO NOT use rigid structures, bullet points, or bolded labels (e.g., avoid 'Appearance:', 'Behavior:'). Write cohesive sentences instead of lists.",
    tools: {
      search_project,
      list_project_files,
      list_project_addons,
      get_project_summary,
      record_thought,
    },
  },
  "logic-expert-agent": {
    name: "Logic Expert",
    instructions:
      "You are a Construct 3 Logic Expert. Use tools to research event sheets and manual documentation. \n\nCRITICAL: When using the 'generate_c3_clipboard' tool, DO NOT repeat the generated JSON in your response. The UI will automatically render the clipboard data. Simply confirm the logic is ready. NEVER output raw JSON blocks in your final answer.\n\nTONE AND STYLE: Speak naturally and conversationally in paragraphs, like a human expert. Keep your final answers concise and flowing. DO NOT use rigid structures, bullet points, or bolded labels (e.g., avoid 'Appearance:', 'Behavior:'). Write cohesive sentences instead of lists.",
    tools: {
      search_events,
      search_manual,
      audit_project,
      get_object_schema,
      get_project_summary,
      generate_c3_clipboard,
      record_thought,
    },
  },
  "generator-agent": {
    name: "Generator",
    instructions:
      "You are a Construct 3 Code/Logic Generator. Use tools to search snippets and generate valid C3 clipboard JSON. \n\nCRITICAL: When using the 'generate_c3_clipboard' tool, DO NOT repeat the generated JSON in your response. The UI will automatically render the clipboard data. Simply confirm the events have been generated and explain the logic without showing raw JSON. NEVER output raw JSON blocks in your final answer.\n\nTONE AND STYLE: Speak naturally and conversationally in paragraphs, like a human expert. Keep your final answers concise and flowing. DO NOT use rigid structures, bullet points, or bolded labels (e.g., avoid 'Appearance:', 'Behavior:'). Write cohesive sentences instead of lists.",
    tools: { search_snippets, generate_c3_clipboard, record_thought },
  },
  "construct-llm-agent": {
    name: "Construct 3 Expert",
    instructions:
      "You are a Construct 3 Expert. Use all provided tools to research project context and generate logic. \n\nCRITICAL: When using the 'generate_c3_clipboard' tool, DO NOT repeat the generated JSON in your response. The UI will automatically render the clipboard data. Simply confirm the events have been generated and provide a brief explanation. NEVER output raw JSON in your final answer.\n\nTONE AND STYLE: Speak naturally and conversationally in paragraphs, like a human expert. Keep your final answers concise and flowing. DO NOT use rigid structures, bullet points, or bolded labels (e.g., avoid 'Appearance:', 'Behavior:'). Write cohesive sentences instead of lists.",
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
      record_thought,
    },
  },
};

// --- Model and Agent Initialization ---

const getDynamicModel = (config: ModelConfig & { jsonMode?: boolean }) => {
  const provider = config?.provider || "mistral";
  const apiKey = config?.apiKey || encryptedApiKeys[provider];

  if (!apiKey) {
    throw new Error(`Missing API Key for provider: ${provider}. Please set it in Settings.`);
  }

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(config.modelId || "gpt-4o");
    case "anthropic":
      return createAnthropic({ apiKey })(config.modelId || "claude-3-7-sonnet-latest");
    case "google":
      return createGoogleGenerativeAI({ apiKey })(config.modelId || "gemini-2.0-flash");
    case "openrouter":
      return createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      })(config.modelId || "deepseek/deepseek-chat");
    default:
      return createMistral({ apiKey })(config.modelId || "mistral-large-latest");
  }
};

const architectAgent = new Agent({
  id: "architect-agent",
  name: "Architect",
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_CONFIGS["architect-agent"];
    let inst = `${config.instructions}\n\nYou MUST use your tools to query the project state.`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    return inst;
  },
  memory: getAgentMemory,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["architect-agent"].tools;
    if (currentWorkspace) {
      return { ...baseTools, ...createWorkspaceTools(currentWorkspace) };
    }
    return baseTools;
  },
});

const logicExpertAgent = new Agent({
  id: "logic-expert-agent",
  name: "Logic Expert",
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_CONFIGS["logic-expert-agent"];
    let inst = `${config.instructions}\n\nYou MUST use your tools to query project state.`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    return inst;
  },
  memory: getAgentMemory,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["logic-expert-agent"].tools;
    if (currentWorkspace) {
      return { ...baseTools, ...createWorkspaceTools(currentWorkspace) };
    }
    return baseTools;
  },
});

const generatorAgent = new Agent({
  id: "generator-agent",
  name: "Generator",
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_CONFIGS["generator-agent"];
    let inst = `${config.instructions}`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    return inst;
  },
  memory: getAgentMemory,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["generator-agent"].tools;
    if (currentWorkspace) {
      return { ...baseTools, ...createWorkspaceTools(currentWorkspace) };
    }
    return baseTools;
  },
});

const constructExpertAgent = new Agent({
  id: "construct-llm-agent",
  name: "Construct 3 Expert",
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_CONFIGS["construct-llm-agent"];
    let inst = `${config.instructions}`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    return inst;
  },
  memory: getAgentMemory,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["construct-llm-agent"].tools;
    if (currentWorkspace) {
      return { ...baseTools, ...createWorkspaceTools(currentWorkspace) };
    }
    return baseTools;
  },
});

const AGENTS_MAP: Record<string, Agent> = {
  "logic-expert-agent": logicExpertAgent,
  "architect-agent": architectAgent,
  "generator-agent": generatorAgent,
  "construct-llm-agent": constructExpertAgent,
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

let indexCache: Record<string, number> = {};
const indexCachePath = path.join(app.getPath("userData"), "index-cache.json");

async function loadIndexCache() {
  try {
    const data = await fs.readFile(indexCachePath, "utf8");
    indexCache = JSON.parse(data);
  } catch (e) {
    indexCache = {};
  }
}

async function saveIndexCache() {
  try {
    await fs.writeFile(indexCachePath, JSON.stringify(indexCache, null, 2));
  } catch (e) {
    console.error("Failed to save index cache:", e);
  }
}

async function syncProjectToVectorStore(projectPath: string, force = false) {
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

        // Skip file if it hasn't been modified since last index (unless forced)
        if (!force && indexCache[filePath] === mtimeMs) {
          continue;
        }

        filesActuallyIndexed++;

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
            await getProjectStore().upsert({
              indexName: "project_content",
              vectors,
              ids,
              metadata,
            });
          }

          // Minimal yield to process incoming IPC messages
          await sleep(5);
        }

        // Successfully indexed, update cache
        indexCache[filePath] = mtimeMs;
      } catch (err: any) {
        console.error(`Failed to index file ${filePath}:`, err.message);
      }
      // Minimal yield between files
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

async function syncGlobalAssetsToVectorStore() {}

const debouncedSync = debounce((projectPath: string) => {
  syncProjectToVectorStore(projectPath).catch(() => {});
}, 2000);

function updateWorkspace(projectPath: string, projectId: string) {
  // --- Project Specific Store Initialization ---
  const projectDbPath = path.join(app.getPath("userData"), `project-${projectId}.db`);
  projectStore = new LibSQLVector({
    id: `project-store-${projectId}`,
    url: `file:${projectDbPath}`,
  });

  // Re-initialize memory for the new project store
  agentMemory = new Memory({
    storage: memoryStore,
    vector: projectStore,
    embedder: embeddingModel,
  });

  // --- Workspace Initialization ---
  currentWorkspace = new Workspace({
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

  // Non-blocking init
  currentWorkspace.init().catch((err) => {
    console.error("[Workspace Init Error]:", err);
  });
}

function startWatchingProject(projectId: string, projectPath: string) {
  updateWorkspace(projectPath, projectId);
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
  // Quick check if global DB exists and has rows
  // (We use a simple non-zero vector to avoid division by zero in cosine similarity)
  try {
    const dummyVector = new Array(384).fill(0.1);
    const manualResults = await globalStore.query({
      indexName: "manual_content",
      queryVector: dummyVector,
      topK: 1,
    });
  } catch (e: any) {
    console.warn(`Initial manual DB check failed: ${e.message}`);
  }

  await loadState();
  createWindow();
  await sleep(500);
  if (appState.activeProjectId) {
    const p = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (p) {
      await syncProjectToVectorStore(p.path);
    }
  }
  isStartupComplete = true;
  if (mainWindow) {
    mainWindow.webContents.send("startup-complete");
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
    currentProjectPath = res.filePaths[0];
    const id = path.basename(currentProjectPath);
    let p = appState.projects.find((pr) => pr.id === id);
    if (!p) {
      p = { id, name: id, path: currentProjectPath, threads: [] };
      appState.projects.push(p);
      appState.activeProjectId = id;
      await saveState();
    }
    if (currentProjectPath && appState.activeProjectId) {
      startWatchingProject(appState.activeProjectId, currentProjectPath);
    }
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
      // Ensure sync
      currentProjectPath = p.path;

      const targetAgentId = agentId && agentId !== "auto" ? agentId : "construct-llm-agent";

      // Store the model config for tool use
      const provider = modelConfig?.provider || "mistral";
      const currentModelConfig: ModelConfig = {
        provider,
        modelId: modelConfig?.modelId || "mistral-large-latest",
        apiKey: encryptedApiKeys[provider],
      };
      lastUsedModelConfig = currentModelConfig;

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

