import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import {
  getProjectStore,
  embeddingModel,
  globalStore,
  getCurrentWorkspace,
} from "./mastra";
import { getAllFiles } from "./utils";
import { C3ClipboardSchema, ModelConfig } from "./types";
import { getDynamicModel } from "./config";
import { appState } from "./state";

// State variable for tool context
export let lastUsedModelConfig: ModelConfig | null = null;
export function setLastUsedModelConfig(config: ModelConfig) {
  lastUsedModelConfig = config;
}

export const search_project = {
  id: "search_project",
  description:
    "Search the current project for specific logic, layouts, or event sheets using semantic vector search. Use this for general concepts. CRITICAL: If you are searching for a specific Object Type (e.g., Player_Base), DO NOT use this tool. Use the 'get_object_schema' tool instead, as vector search is poor at exact matches.",
  inputSchema: z.object({
    queryText: z.string().describe("The search query."),
  }),
  execute: async ({ queryText }: { queryText: string }) => {
    const sanitizedQuery = queryText.replace(/^[#@]/, "");
    const activeProject = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project loaded.";

    try {
      // 1. Semantic Search
      const { embeddings } = await embeddingModel.doEmbed({ values: [sanitizedQuery] });
      const queryVector = embeddings[0];

      const results = await getProjectStore().query({
        indexName: "project_content",
        queryVector,
        topK: 10, // Increased for better coverage
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

      // 2. Exact Match & Keyword Fallback
      const allFiles = await getAllFiles(activeProject.path);
      const exactMatches = [];
      const keywordMatches: Record<string, string[]> = {};

      const words = sanitizedQuery
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .map((w) => w.toLowerCase());

      for (const file of allFiles) {
        const content = await fs.readFile(file, "utf8");
        const lowerContent = content.toLowerCase();
        const relPath = path.relative(activeProject.path, file).replace(/\\/g, "/");

        if (lowerContent.includes(sanitizedQuery.toLowerCase())) {
          exactMatches.push(relPath);
        } else {
          for (const word of words) {
            if (lowerContent.includes(word)) {
              if (!keywordMatches[word]) keywordMatches[word] = [];
              if (keywordMatches[word].length < 5) keywordMatches[word].push(relPath);
            }
          }
        }
      }

      if (exactMatches.length > 0) {
        response += "\n\n### Exact Text Matches Found In ###\n" + exactMatches.join("\n");
      }

      const foundKeywords = Object.keys(keywordMatches);
      if (foundKeywords.length > 0 && !response) {
        response += "\n\n### Keyword Matches Found In ###\n";
        for (const kw of foundKeywords) {
          response += `Keyword "${kw}": ${keywordMatches[kw].join(", ")}\n`;
        }
      }

      if (!response) return "No relevant project context found. Try searching for specific object names or shorter keywords.";

      return response;
    } catch (e: any) {
      console.error("[DEBUG] Error in search_project tool:", e.message);
      return `Error searching project: ${e.message}`;
    }
  },
};

export const search_manual = {
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

export const search_snippets = {
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

export const generate_c3_clipboard = {
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

export const list_project_addons = {
  id: "list_project_addons",
  description: "Lists plugins and behaviors used in the project.",
  inputSchema: z.object({}),
  execute: async () => {
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project.";
    const content = await fs.readFile(path.join(activeProject.path, "project.c3proj"), "utf8");
    const data = JSON.parse(content);
    return JSON.stringify(data.usedAddons || []);
  },
};

export const list_project_files = {
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
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project.";
    const dirPath = path.join(activeProject.path, directory);
    try {
      const files = await getAllFiles(dirPath);
      return JSON.stringify(files.map((f) => path.relative(dirPath, f).replace(/\\/g, "/")));
    } catch (e) {
      return "Not found.";
    }
  },
};

export const get_object_schema = {
  id: "get_object_schema",
  description: "Returns JSON schema for an object type.",
  inputSchema: z.object({
    objectName: z.string().describe("Object type name."),
  }),
  execute: async ({ objectName }: { objectName: string }) => {
    const activeProject = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project loaded.";

    const sanitizedName = objectName.replace(/^[#@]/, "");
    const lowerName = sanitizedName.toLowerCase();

    try {
      // 1. Recursive project-wide search for filename match
      const allFiles = await getAllFiles(activeProject.path);

      // Priority 1: Exact filename match (with or without .json)
      let targetPath = allFiles.find((f) => {
        const base = path.basename(f).toLowerCase();
        return base === `${lowerName}.json` || base === lowerName;
      });

      // Priority 2: Full path contains the name (to handle nested objects correctly)
      if (!targetPath) {
        targetPath = allFiles.find((f) => {
          const rel = path.relative(activeProject.path, f).toLowerCase();
          return rel.includes(`/${lowerName}.json`) || rel.startsWith(`${lowerName}.json`);
        });
      }

      // Priority 3: Fuzzy filename match (starts with or includes)
      if (!targetPath) {
        targetPath = allFiles.find((f) => {
          const base = path.basename(f).toLowerCase();
          return base.startsWith(lowerName) || base.includes(lowerName);
        });
      }

      if (targetPath) {
        return await fs.readFile(targetPath, "utf8");
      }

      return `Object or Family "${sanitizedName}" not found. Try listing files in 'objectTypes' or 'families' to find the exact name.`;
    } catch (e) {
      return "Error searching for object schema.";
    }
  },
};

export const search_events = {
  id: "search_events",
  description: "Search across all event sheets.",
  inputSchema: z.object({ query: z.string().describe("Keyword.") }),
  execute: async ({ query }: { query: string }) => {
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project.";
    const sanitizedQuery = query.replace(/^[#@]/, "");
    const dir = path.join(activeProject.path, "eventSheets");
    try {
      const files = await getAllFiles(dir);
      const res = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        if ((await fs.readFile(f, "utf8")).toLowerCase().includes(sanitizedQuery.toLowerCase()))
          res.push(path.relative(activeProject.path, f).replace(/\\/g, "/"));
      }
      return res.length > 0 ? res.join(", ") : "No matches.";
    } catch (e) {
      return "Error.";
    }
  },
};

export const get_project_summary = {
  id: "get_project_summary",
  description:
    "Get a high-level summary of the Construct 3 project including its name, layouts, and event sheets. Use this tool at the start of a conversation to understand the project's identity.",
  inputSchema: z.object({}),
  execute: async () => {
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!activeProject?.path)
      return "No project loaded. Please ask the user to select a project folder.";
    try {
      const projFilePath = path.join(activeProject.path, "project.c3proj");
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

export const audit_project = {
  id: "audit_project",
  description: "Audits for performance.",
  inputSchema: z.object({}),
  execute: async () => {
    return "Audit logic active.";
  },
};

export const record_thought = {
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
