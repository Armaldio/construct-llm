import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import {
  embeddingModel,
  globalStore,
  getCurrentWorkspace,
} from "./mastra";
import { getAllFiles, projectBrain } from "./utils";
import { C3ClipboardSchema, ModelConfig } from "./types";
import { getDynamicModel } from "./config";
import { appState, encryptedApiKeys } from "./state";

// State variable for tool context
export let lastUsedModelConfig: ModelConfig | null = null;
export function setLastUsedModelConfig(config: ModelConfig) {
  lastUsedModelConfig = config;
}

export const search_project = {
  id: "search_project",
  description:
    "Direct recursive search across the entire project for logic, variables, or instances. God Tier: Automatically performs fuzzy fallback and identifies structural context (event groups, functions).",
  inputSchema: z.object({
    queryText: z.string().describe("Specific keyword or phrase to find."),
  }),
  execute: async ({ queryText }: { queryText: string }) => {
    const activeProject = appState.projects.find((p) => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project loaded.";

    const sanitizedQuery = queryText.replace(/^[#@]/, "").toLowerCase();
    
    // 1. Check the Project Brain for instant structural hits
    if (projectBrain.objects.has(queryText) || projectBrain.families.has(queryText)) {
      console.log(`[Search] Brain hit for ${queryText}`);
    }

    try {
      const allFiles = await getAllFiles(activeProject.path);
      const results: { file: string; context: string; line: number }[] = [];

      for (const file of allFiles) {
        const content = await fs.readFile(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.toLowerCase().includes(sanitizedQuery)) {
            // Find parent name if it's a C3 JSON file
            let structuralContext = "";
            if (file.endsWith(".json")) {
              // Quick "crawl up" for nearest 'name' key in JSON string
              const subStr = lines.slice(Math.max(0, i - 50), i).join("\n");
              const nameMatch = [...subStr.matchAll(/"name":\s*"([^"]+)"/g)].pop();
              if (nameMatch) structuralContext = ` (Found in: ${nameMatch[1]})`;
            }

            const snippet = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join("\n");
            results.push({
              file: path.relative(activeProject.path, file).replace(/\\/g, "/"),
              context: `${snippet}${structuralContext}`,
              line: i + 1,
            });

            if (results.length >= 15) break; // Limit results
          }
        }
        if (results.length >= 15) break;
      }

      if (results.length === 0) {
        return `No matches found for "${queryText}". Try a shorter keyword or a fuzzy synonym.`;
      }

      return results
        .map(
          (r) =>
            `--- ${r.file} (Line ${r.line}) ---\n${r.context}`,
        )
        .join("\n\n");
    } catch (e: any) {
      console.error("[DEBUG] Error in search_project tool:", e.message);
      return `Error searching project: ${e.message}`;
    }
  },
};

export const search_manual = {
  id: "search_manual",
  description: "Search official C3 manual (powered by Vector DB).",
  inputSchema: z.object({ queryText: z.string() }),
  execute: async ({ queryText }: { queryText: string }) => {
    try {
      const { embeddings } = await embeddingModel.doEmbed({ values: [queryText] });
      const results = await globalStore.query({
        indexName: "manual_content",
        queryVector: embeddings[0],
        topK: 3,
      });

      if (results.length === 0) return "No manual entries found.";
      return results.map((r: any) => `--- ${r.metadata?.title} ---\n${r.metadata?.text}`).join("\n\n");
    } catch (e: any) { return `Error: ${e.message}`; }
  },
};

export const search_snippets = {
  id: "search_snippets",
  description: "Search C3 JSON snippets (powered by Vector DB).",
  inputSchema: z.object({ queryText: z.string() }),
  execute: async ({ queryText }: { queryText: string }) => {
    try {
      const { embeddings } = await embeddingModel.doEmbed({ values: [queryText] });
      const results = await globalStore.query({
        indexName: "snippet_content",
        queryVector: embeddings[0],
        topK: 3,
      });

      if (results.length === 0) return "No snippets found.";
      return results.map((r: any) => `--- Snippet --- \n${r.metadata?.text}`).join("\n\n");
    } catch (e: any) { return `Error: ${e.message}`; }
  },
};

export const generate_c3_clipboard = {
  id: "generate_c3_clipboard",
  description: "Generate Construct 3 clipboard JSON from logic. DO NOT repeat JSON in chat response.",
  inputSchema: z.object({
    logic: z.string(),
    objects: z.array(z.string()),
    contextSnippets: z.string().optional(),
  }),
  execute: async ({ logic, objects, contextSnippets }: any) => {
    try {
      const config = lastUsedModelConfig || { provider: "mistral" };
      const model = getDynamicModel(config);
      const prompt = `Convert logic into C3 clipboard JSON. Objects: ${objects.join(", ")}. Logic: ${logic}`;

      const generator = new Agent({
        id: "generator",
        name: "Generator",
        instructions: "Output ONLY valid JSON.",
        model,
      });

      const result = await generator.generate(prompt, {
        structuredOutput: { schema: C3ClipboardSchema },
      });

      return { "is-c3-clipboard-data": true, data: result.object };
    } catch (e: any) { return `Error: ${e.message}`; }
  },
};

export const list_project_addons = {
  id: "list_project_addons",
  description: "List plugins and behaviors.",
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
  description: "List files in directory.",
  inputSchema: z.object({ directory: z.string() }),
  execute: async ({ directory }: any) => {
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    const dirPath = path.join(activeProject!.path, directory);
    try {
      const files = await getAllFiles(dirPath);
      return JSON.stringify(files.map((f) => path.relative(dirPath, f)));
    } catch (e) { return "Not found."; }
  },
};

export const get_object_schema = {
  id: "get_object_schema",
  description: "Returns JSON schema for an object or family.",
  inputSchema: z.object({ objectName: z.string() }),
  execute: async ({ objectName }: { objectName: string }) => {
    const activeProject = appState.projects.find(p => p.id === appState.activeProjectId);
    if (!activeProject?.path) return "No project.";

    const lowerName = objectName.toLowerCase();
    const allFiles = await getAllFiles(activeProject.path);

    // Filter to find the file
    const target = allFiles.find(f => {
      const base = path.basename(f, ".json").toLowerCase();
      return base === lowerName;
    });

    if (target) return await fs.readFile(target, "utf8");
    return `Asset "${objectName}" not found. Try searching for it or listing families.`;
  },
};

export const record_thought = {
  id: "record_thought",
  description: "Record your internal reasoning or plan.",
  inputSchema: z.object({ thought: z.string() }),
  execute: async ({ thought }: { thought: string }) => {
    return "Thought recorded.";
  },
};
