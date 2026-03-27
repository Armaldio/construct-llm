import { z } from "zod";

export interface ModelConfig {
  provider: string;
  modelId?: string;
  apiKey?: string;
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
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reflections?: Reflection[];
  parts?: ChatMessagePart[];
}

export interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  modelConfig: ModelConfig;
  agentId?: string;
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
  apiKeys?: Record<string, string>;
}

export const C3EventItemBaseSchema = z.object({
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

export type C3EventItem = z.infer<typeof C3EventItemBaseSchema> & {
  children?: C3EventItem[];
};

export const C3EventItemSchema: z.ZodType<C3EventItem> = C3EventItemBaseSchema.extend({
  children: z.lazy(() => z.array(C3EventItemSchema)).optional(),
});

export const C3ClipboardSchema = z.object({
  "is-c3-clipboard-data": z.literal(true),
  type: z.literal("events"),
  items: z.array(C3EventItemSchema),
});
