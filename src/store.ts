import { reactive } from "vue";

export interface ModelConfig {
  provider: string;
  modelId: string;
}

export interface Reflection {
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

export interface ChatMessagePart {
  type: "text" | "reflection" | "c3-clipboard" | "thought";
  content: string;
  metadata?: Record<string, unknown>;
  reflections?: Reflection[];
  isStreaming?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reflections?: Reflection[]; // for legacy or fallback
  parts: ChatMessagePart[];
}

export interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  modelConfig: ModelConfig;
  agentId: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  threads: ChatThread[];
  customPrompt?: string;
}

export interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  apiKeys: {
    mistral?: string;
    openai?: string;
    anthropic?: string;
    google?: string;
    openrouter?: string;
  };
}

export const store = reactive({
  appState: {
    projects: [],
    activeProjectId: null,
    apiKeys: {},
  } as AppState,
  currentProject: null as Project | null,
  activeThreadId: null as string | null,
  activeThread: null as ChatThread | null,
  isIndexing: false,
  isStreaming: false,
  isStartingUp: true,
  startupStatus: { step: "Initializing...", detail: "", percent: 0, error: false },
  projectTree: [] as any[],
  allFiles: [] as any[],
  allEntities: [] as any[],
});

export const SUPPORTED_MODELS = [
  { provider: "mistral", modelId: "mistral-large-latest", label: "Mistral Large" },
  { provider: "mistral", modelId: "mistral-small-latest", label: "Mistral Small" },
  { provider: "openai", modelId: "gpt-4o", label: "GPT-4o" },
  { provider: "openai", modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
  { provider: "openai", modelId: "o1", label: "OpenAI o1" },
  { provider: "openai", modelId: "o3-mini", label: "OpenAI o3-mini" },
  { provider: "anthropic", modelId: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
  { provider: "anthropic", modelId: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { provider: "google", modelId: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { provider: "google", modelId: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite" },
  { provider: "google", modelId: "gemini-3-flash", label: "Gemini 3.0 Flash" },
  { provider: "google", modelId: "gemini-3-deep-think", label: "Gemini 3.0 Deep Think" },
  { provider: "google", modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { provider: "openrouter", modelId: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (Free)" },
  { provider: "openrouter", modelId: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  {
    provider: "openrouter",
    modelId: "anthropic/claude-3.7-sonnet",
    label: "Claude 3.7 Sonnet (OR)",
  },
  {
    provider: "openrouter",
    modelId: "google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash (OR)",
  },
  { provider: "openrouter", modelId: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
];
