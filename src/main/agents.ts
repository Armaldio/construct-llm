import { Agent } from "@mastra/core/agent";
import { createWorkspaceTools } from "@mastra/core/workspace";

import { getAgentMemory, getCurrentWorkspace } from "./mastra";
import { AGENT_METADATA, getDynamicModel } from "./config";
import * as tools from "./tools";

export const AGENT_CONFIGS: Record<string, any> = {
  "architect-agent": {
    ...AGENT_METADATA["architect-agent"],
    tools: {
      search_project: tools.search_project,
      list_project_files: tools.list_project_files,
      list_project_addons: tools.list_project_addons,
    },
  },
  "logic-expert-agent": {
    ...AGENT_METADATA["logic-expert-agent"],
    tools: {
      search_project: tools.search_project,
      search_manual: tools.search_manual,
      get_object_schema: tools.get_object_schema,
      generate_c3_clipboard: tools.generate_c3_clipboard,
    },
  },
  "generator-agent": {
    ...AGENT_METADATA["generator-agent"],
    tools: {
      search_snippets: tools.search_snippets,
      generate_c3_clipboard: tools.generate_c3_clipboard,
    },
  },
  "construct-llm-agent": {
    ...AGENT_METADATA["construct-llm-agent"],
    tools: {
      search_project: tools.search_project,
      search_manual: tools.search_manual,
      search_snippets: tools.search_snippets,
      generate_c3_clipboard: tools.generate_c3_clipboard,
      list_project_addons: tools.list_project_addons,
      list_project_files: tools.list_project_files,
      get_object_schema: tools.get_object_schema,
    },
  },
};

export const architectAgent = new Agent({
  id: "architect-agent",
  name: AGENT_METADATA["architect-agent"].name,
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_METADATA["architect-agent"];
    let inst = `${config.instructions}\n\nYou MUST use your tools to query the project state.`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    const llmContext = requestContext?.get("llmContext");
    if (llmContext) inst += `\n\n### PROJECT CONTEXT INSTRUCTIONS:\n${llmContext}`;
    return inst;
  },
  memory: getAgentMemory,
  workspace: getCurrentWorkspace,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["architect-agent"].tools;
    const ws = getCurrentWorkspace();
    if (ws) {
      return { ...baseTools, ...createWorkspaceTools(ws) };
    }
    return baseTools;
  },
});

export const logicExpertAgent = new Agent({
  id: "logic-expert-agent",
  name: AGENT_METADATA["logic-expert-agent"].name,
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_METADATA["logic-expert-agent"];
    let inst = `${config.instructions}\n\nYou MUST use your tools to query project state.`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    const llmContext = requestContext?.get("llmContext");
    if (llmContext) inst += `\n\n### PROJECT CONTEXT INSTRUCTIONS:\n${llmContext}`;
    return inst;
  },
  memory: getAgentMemory,
  workspace: getCurrentWorkspace,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["logic-expert-agent"].tools;
    const ws = getCurrentWorkspace();
    if (ws) {
      return { ...baseTools, ...createWorkspaceTools(ws) };
    }
    return baseTools;
  },
});

export const generatorAgent = new Agent({
  id: "generator-agent",
  name: AGENT_METADATA["generator-agent"].name,
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_METADATA["generator-agent"];
    let inst = `${config.instructions}`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    const llmContext = requestContext?.get("llmContext");
    if (llmContext) inst += `\n\n### PROJECT CONTEXT INSTRUCTIONS:\n${llmContext}`;
    return inst;
  },
  memory: getAgentMemory,
  workspace: getCurrentWorkspace,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["generator-agent"].tools;
    const ws = getCurrentWorkspace();
    if (ws) {
      return { ...baseTools, ...createWorkspaceTools(ws) };
    }
    return baseTools;
  },
});

export const constructExpertAgent = new Agent({
  id: "construct-llm-agent",
  name: AGENT_METADATA["construct-llm-agent"].name,
  model: ({ requestContext }: any) => getDynamicModel(requestContext?.get("modelConfig")),
  instructions: ({ requestContext }: any) => {
    const config = AGENT_METADATA["construct-llm-agent"];
    let inst = `${config.instructions}`;
    const custom = requestContext?.get("customPrompt");
    if (custom) inst += `\n\n### USER CUSTOM INSTRUCTIONS:\n${custom}`;
    const llmContext = requestContext?.get("llmContext");
    if (llmContext) inst += `\n\n### PROJECT CONTEXT INSTRUCTIONS:\n${llmContext}`;
    return inst;
  },
  memory: getAgentMemory,
  workspace: getCurrentWorkspace,
  tools: ({ requestContext }: any) => {
    const baseTools = AGENT_CONFIGS["construct-llm-agent"].tools;
    const ws = getCurrentWorkspace();
    if (ws) {
      return { ...baseTools, ...createWorkspaceTools(ws) };
    }
    return baseTools;
  },
});

export const AGENTS_MAP: Record<string, Agent> = {
  "logic-expert-agent": logicExpertAgent,
  "architect-agent": architectAgent,
  "generator-agent": generatorAgent,
  "construct-llm-agent": constructExpertAgent,
};
