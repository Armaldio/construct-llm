<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import Button from "primevue/button";
import AutoComplete from "primevue/autocomplete";
import Listbox from "primevue/listbox";
import Card from "primevue/card";
import Divider from "primevue/divider";
import Dialog from "primevue/dialog";
import Select from "primevue/select";
import Password from "primevue/password";
import Textarea from "primevue/textarea";
import InputText from "primevue/inputtext";
import FloatLabel from "primevue/floatlabel";
import Timeline from "primevue/timeline";
import ProgressSpinner from "primevue/progressspinner";
import Tree from "primevue/tree";
import MarkdownIt from "markdown-it";
import C3EventPreview from "./C3EventPreview.vue";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

type ReflectionType = "info" | "tool" | "result";

interface Reflection {
  id: number;
  content: string;
  type: ReflectionType;
  toolName?: string;
  args?: any;
  result?: any;
}

interface ChatMessagePart {
  type: "text" | "reflection";
  content?: string;
  reflections?: Reflection[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reflections?: Reflection[]; // for legacy or fallback
  parts: ChatMessagePart[];
}

interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  modelConfig: {
    provider: string;
    modelId: string;
  };
  agentId: string;
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
  apiKeys: {
    mistral?: string;
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

const appState = ref<AppState>({
  projects: [],
  activeProjectId: null,
  apiKeys: {},
});
const currentProject = ref<Project | null>(null);
const activeThreadId = ref<string | null>(null);
const activeThread = ref<ChatThread | null>(null);
const newMessage = ref("");
const isIndexing = ref(false);
const reflections = ref<any[]>([]);
const isStreaming = ref(false);
const inputRef = ref<any>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const isStartingUp = ref(true);
const startupStatus = ref({ step: "Initializing...", detail: "" });

const projectTree = ref<any[]>([]);
const allFiles = ref<any[]>([]);
const allEntities = ref<any[]>([]);
const filteredSuggestions = ref<any[]>([]);

const showNewChatDialog = ref(false);
const showSettingsDialog = ref(false);
const showProjectSettingsDialog = ref(false);
const newChatName = ref("");
const selectedModel = ref({
  provider: "mistral",
  modelId: "mistral-large-latest",
  label: "Mistral Large",
});
const selectedAgentId = ref("auto");

const agentOptions = [
  { label: "🤖 Automatic", id: "auto" },
  { label: "🏗️ Architect", id: "architect-agent" },
  { label: "🧠 Logic Expert", id: "logic-expert-agent" },
  { label: "🎨 Generator", id: "generator-agent" },
];

const localApiKeys = ref<Record<string, string>>({
  mistral: "",
  openai: "",
  anthropic: "",
  google: "",
});

const projectSettings = ref({
  name: "",
  customPrompt: "",
});

const openProjectSettings = () => {
  if (!currentProject.value) return;
  projectSettings.value = {
    name: currentProject.value.name,
    customPrompt: currentProject.value.customPrompt || "",
  };
  showProjectSettingsDialog.value = true;
};

const saveProjectSettings = () => {
  if (!currentProject.value) return;
  currentProject.value.name = projectSettings.value.name;
  currentProject.value.customPrompt = projectSettings.value.customPrompt;
  showProjectSettingsDialog.value = false;
};

const saveSettings = async () => {
  // Only send keys that have been touched/changed to avoid overwriting with masks
  const keysToSave: any = {};
  if (localApiKeys.value.mistral) keysToSave.mistral = localApiKeys.value.mistral;
  if (localApiKeys.value.openai) keysToSave.openai = localApiKeys.value.openai;
  if (localApiKeys.value.anthropic) keysToSave.anthropic = localApiKeys.value.anthropic;
  if (localApiKeys.value.google) keysToSave.google = localApiKeys.value.google;

  await (window as any).api.saveApiKeys(JSON.parse(JSON.stringify(localApiKeys.value)));
  showSettingsDialog.value = false;
  // Clear local state after saving for security
  Object.keys(localApiKeys.value).forEach((k) => (localApiKeys.value[k] = ""));
};

const fetchProjectTree = async () => {
  if (appState.value.activeProjectId) {
    projectTree.value = await (window as any).api.getProjectTree();

    // Flatten tree for autocomplete
    const files: any[] = [];
    const entities: any[] = [];

    const traverse = (nodes: any[]) => {
      nodes.forEach((n) => {
        if (n.children) {
          traverse(n.children);
        } else if (n.data) {
          files.push({ label: n.label, path: n.data.path });
          if (n.data.path.startsWith("objectTypes") || n.data.path.startsWith("families")) {
            entities.push({ label: n.label.replace(".json", ""), path: n.data.path });
          }
        }
      });
    };
    traverse(projectTree.value);
    allFiles.value = files;
    allEntities.value = entities;
  } else {
    projectTree.value = [];
    allFiles.value = [];
    allEntities.value = [];
  }
};

// Track original text before suggestion
let preSuggestionText = "";

const searchSuggestions = (event: any) => {
  const query = event.query;
  const lastAt = query.lastIndexOf("@");
  const lastHash = query.lastIndexOf("#");

  if (lastAt > lastHash) {
    const actualQuery = query.substring(lastAt + 1).toLowerCase();
    preSuggestionText = query.substring(0, lastAt);
    filteredSuggestions.value = allFiles.value
      .filter(
        (f) =>
          f.label.toLowerCase().includes(actualQuery) || f.path.toLowerCase().includes(actualQuery),
      )
      .map((f) => `@${f.path}`);
  } else if (lastHash > lastAt) {
    const actualQuery = query.substring(lastHash + 1).toLowerCase();
    preSuggestionText = query.substring(0, lastHash);
    filteredSuggestions.value = allEntities.value
      .filter((e) => e.label.toLowerCase().includes(actualQuery))
      .map((e) => `#${e.label}`);
  } else {
    filteredSuggestions.value = [];
  }
};

const onSelectMention = (event: any) => {
  // PrimeVue AutoComplete replaces the whole v-model.
  // We need to restore the text before the @ or #.
  newMessage.value = preSuggestionText + event.value + " ";

  // Refocus input
  nextTick(() => {
    if (inputRef.value) {
      if (typeof inputRef.value.focus === "function") {
        inputRef.value.focus();
      } else if (inputRef.value.$el) {
        const input = inputRef.value.$el.querySelector("input");
        if (input) input.focus();
      }
    }
  });
};

const models = [
  { provider: "mistral", modelId: "mistral-large-latest", label: "Mistral Large" },
  { provider: "mistral", modelId: "pixtral-large-latest", label: "Pixtral Large" },
  { provider: "openai", modelId: "gpt-4o", label: "GPT-4o" },
  { provider: "openai", modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
  { provider: "anthropic", modelId: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { provider: "google", modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { provider: "google", modelId: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
];

const isUserScrolling = ref(false);

const handleScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  if (!el) return;
  // Calculate how far we are from the bottom
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  // If we are more than 50px away from the bottom, assume the user is reading history
  isUserScrolling.value = distanceToBottom > 50;
};

const scrollToBottom = (force = false) => {
  nextTick(() => {
    if (messagesContainer.value) {
      if (force || !isUserScrolling.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      }
    }
  });
};
onMounted(async () => {
  // Listen for startup progress
  (window as any).api.onStartupProgress((data: any) => {
    startupStatus.value = data;
  });

  (window as any).api.onStartupComplete(() => {
    isStartingUp.value = false;
  });

  // Check if we already finished (useful for HMR)
  const ready = await (window as any).api.isStartupComplete();
  if (ready) {
    isStartingUp.value = false;
  }

  const state = await (window as any).api.getAppState();
  if (state) {
    // Sanitize state: Ensure all messages have parts
    if (state.projects) {
      state.projects.forEach((p: Project) => {
        if (p.threads) {
          p.threads.forEach((t: ChatThread) => {
            if (t.messages) {
              t.messages.forEach((m: ChatMessage) => {
                if (!m.parts) {
                  m.parts = [];
                  // If it's a legacy message with reflections, try to preserve them at the top
                  if (m.reflections && m.reflections.length > 0) {
                    m.parts.push({ type: "reflection", reflections: m.reflections });
                  }
                  // Add content as text part
                  if (m.content) {
                    m.parts.push({ type: "text", content: m.content });
                  }
                }
              });
            }
          });
        }
      });
    }

    appState.value = state;
    if (!appState.value.apiKeys) appState.value.apiKeys = {};

    if (appState.value.activeProjectId) {
      const project = appState.value.projects.find((p) => p.id === appState.value.activeProjectId);
      if (project) {
        currentProject.value = project;
        fetchProjectTree();
      }
    }
  }

  (window as any).api.onIndexingStatus((data: any) => {
    if (data.status === "indexing") {
      isIndexing.value = true;
    } else {
      isIndexing.value = false;
    }
  });

  (window as any).api.onAgentReflection((data: any) => {
    if (activeThread.value) {
      const messages = activeThread.value.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        if (!lastMsg.parts) lastMsg.parts = [];
        if (!lastMsg.reflections) lastMsg.reflections = [];

        // Check if last part is a reflection part, or create one
        let lastPart = lastMsg.parts[lastMsg.parts.length - 1];
        if (!lastPart || lastPart.type !== "reflection") {
          lastPart = { type: "reflection", reflections: [] };
          lastMsg.parts.push(lastPart);
        }

        const reflections = lastPart.reflections!;

        if (data.type === "thought") {
          const reflection: Reflection = {
            id: Date.now(),
            content: data.content,
            type: "info",
          };
          reflections.push(reflection);
          lastMsg.reflections.push(reflection);
        } else if (data.type === "tool-call") {
          const reflection: Reflection = {
            id: Date.now(),
            content: `Using tool: ${data.toolName}...`,
            type: "tool",
            toolName: data.toolName,
            args: data.args,
          };
          reflections.push(reflection);
          lastMsg.reflections.push(reflection);
        } else if (data.type === "tool-result") {
          // Find the last tool-call reflection in ANY reflection part
          let found = false;
          for (let i = lastMsg.parts.length - 1; i >= 0; i--) {
            const part = lastMsg.parts[i];
            if (part.type === "reflection" && part.reflections) {
              const lastToolCall = [...part.reflections]
                .reverse()
                .find((r) => r.type === "tool" && r.toolName === data.toolName && !r.result);

              if (lastToolCall) {
                lastToolCall.result = data.result;
                found = true;
                break;
              }
            }
          }

          if (!found) {
            const reflection: Reflection = {
              id: Date.now(),
              content: `Tool result: ${data.toolName}`,
              type: "result",
              toolName: data.toolName,
              result: data.result,
            };
            reflections.push(reflection);
            lastMsg.reflections.push(reflection);
          }
          // Also update the legacy reflections array
          const legacyToolCall = [...lastMsg.reflections]
            .reverse()
            .find((r) => r.type === "tool" && r.toolName === data.toolName && !r.result);
          if (legacyToolCall) legacyToolCall.result = data.result;
        }
        scrollToBottom();
      }
    }
  });

  (window as any).api.onAgentChunk((chunk: string) => {
    if (activeThread.value) {
      const messages = activeThread.value.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        if (!lastMsg.parts) lastMsg.parts = [];

        let lastPart = lastMsg.parts[lastMsg.parts.length - 1];
        if (!lastPart || lastPart.type !== "text") {
          lastPart = { type: "text", content: "" };
          lastMsg.parts.push(lastPart);
        }

        lastPart.content += chunk;
        lastMsg.content += chunk;
        scrollToBottom();
      }
    }
  });
});

// Watch for changes in activeProjectId
watch(
  () => appState.value.activeProjectId,
  (newId) => {
    if (newId) {
      currentProject.value = appState.value.projects.find((p) => p.id === newId) || null;
      fetchProjectTree();
    } else {
      currentProject.value = null;
      projectTree.value = [];
      allFiles.value = [];
      allEntities.value = [];
    }
  },
);

// Watch for changes in currentProject.threads and activeThreadId
watch(
  [currentProject, activeThreadId],
  ([project, threadId]) => {
    if (project && threadId) {
      activeThread.value = project.threads.find((t) => t.id === threadId) || null;
      scrollToBottom(true);
    } else {
      activeThread.value = null;
    }
  },
  { deep: true },
);

// Sync state back to main process
watch(
  appState,
  (newState) => {
    (window as any).api.updateAppState(JSON.parse(JSON.stringify(newState)));
  },
  { deep: true },
);

const loadProject = async () => {
  const project = await (window as any).api.selectProject();
  if (project) {
    // Check if it already exists in appState.projects
    const existingIndex = appState.value.projects.findIndex((p) => p.id === project.id);
    if (existingIndex !== -1) {
      appState.value.projects[existingIndex] = project;
    } else {
      appState.value.projects.push(project);
    }
    appState.value.activeProjectId = project.id;
    currentProject.value = project;
  }
};

const forceReindex = async () => {
  if (isIndexing.value) return;
  await (window as any).api.forceReindex();
};

const onThreadChange = () => {
  if (currentProject.value && activeThreadId.value) {
    activeThread.value =
      currentProject.value.threads.find((t) => t.id === activeThreadId.value) || null;
    scrollToBottom(true);
  }
};

const selectProject = (id: string) => {
  appState.value.activeProjectId = id;
  activeThreadId.value = null;
};

const deleteProject = async (id: string) => {
  const confirmed = confirm(
    "Are you sure you want to delete this project and all its chat history? This will not delete the project files on your disk.",
  );
  if (confirmed) {
    const success = await (window as any).api.deleteProject(id);
    if (success) {
      const index = appState.value.projects.findIndex((p) => p.id === id);
      if (index !== -1) {
        appState.value.projects.splice(index, 1);
        if (appState.value.activeProjectId === id) {
          appState.value.activeProjectId = null;
          currentProject.value = null;
          activeThreadId.value = null;
        }
      }
    }
  }
};

const createNewThread = () => {
  if (!currentProject.value) return;
  newChatName.value = `Chat ${currentProject.value.threads.length + 1}`;
  showNewChatDialog.value = true;
};

const confirmCreateThread = () => {
  if (!currentProject.value) return;

  const id = Date.now().toString();
  const newThread: ChatThread = {
    id,
    name: newChatName.value || "New Chat",
    messages: [],
    modelConfig: {
      provider: selectedModel.value.provider,
      modelId: selectedModel.value.modelId,
    },
    agentId: "auto",
  };

  currentProject.value.threads.push(newThread);
  activeThreadId.value = id;
  onThreadChange();
  showNewChatDialog.value = false;
};

const deleteThread = (id: string) => {
  if (!currentProject.value) return;

  const confirmed = confirm("Are you sure you want to delete this chat thread?");
  if (confirmed) {
    const index = currentProject.value.threads.findIndex((t) => t.id === id);
    if (index !== -1) {
      currentProject.value.threads.splice(index, 1);
      if (activeThreadId.value === id) {
        activeThreadId.value = null;
      }
    }
  }
};

const sendMessage = async () => {
  console.log("[DEBUG] sendMessage called. newMessage:", newMessage.value);
  if (
    !newMessage.value.trim() ||
    !activeThreadId.value ||
    !currentProject.value ||
    isStreaming.value
  ) {
    console.log("[DEBUG] sendMessage guard blocked:", {
      trimmedLen: newMessage.value.trim().length,
      activeThreadId: activeThreadId.value,
      currentProject: !!currentProject.value,
      isStreaming: isStreaming.value,
    });
    return;
  }

  const thread = activeThread.value;
  if (!thread) {
    console.log("[DEBUG] No active thread object found for ID:", activeThreadId.value);
    return;
  }

  console.log("[DEBUG] Current thread state:", JSON.parse(JSON.stringify(thread)));

  const content = newMessage.value;
  newMessage.value = "";
  reflections.value = [];

  console.log("[DEBUG] Pushing user message:", content);
  thread.messages.push({ role: "user", content, parts: [{ type: "text", content }] });

  // Add placeholder for streaming assistant message
  thread.messages.push({
    role: "assistant",
    content: "",
    parts: [],
    reflections: [],
  });

  // Safely restore focus to the input immediately to prevent Electron from losing window focus
  // when the Send button becomes disabled.
  if (inputRef.value) {
    if (typeof inputRef.value.focus === "function") {
      inputRef.value.focus();
    } else if (inputRef.value.$el) {
      const input = inputRef.value.$el.querySelector("input");
      if (input) input.focus();
    }
  }

  isStreaming.value = true;
  scrollToBottom(true);

  try {
    console.log("[DEBUG] Starting mention detection...");
    // Detect mentions like @folder/file.json or #Entity
    const fileMentionRegex = /@([^\s]+)/g;
    const entityMentionRegex = /#([^\s]+)/g;

    const fileMatches = Array.from(content.matchAll(fileMentionRegex));
    const entityMatches = Array.from(content.matchAll(entityMentionRegex));

    console.log("[DEBUG] Found mentions:", {
      files: fileMatches.length,
      entities: entityMatches.length,
    });

    const uniqueFilePaths = new Set<string>();
    const uniqueEntities = new Set<string>();

    for (const match of fileMatches) {
      const path = match[1];
      if (allFiles.value.some((f) => f.path === path)) uniqueFilePaths.add(path);
    }

    for (const match of entityMatches) {
      const name = match[1];
      if (allEntities.value.some((e) => e.label === name)) uniqueEntities.add(name);
    }

    let finalPrompt = content;
    let contextStr = "\n\n--- CONTEXT FROM MENTIONS ---\n";
    let hasContext = false;

    if (uniqueFilePaths.size > 0) {
      hasContext = true;
      for (const filePath of uniqueFilePaths) {
        console.log("[DEBUG] Fetching file content for mention:", filePath);
        const fileContent = await (window as any).api.getFileContent(filePath);
        contextStr += `File: ${filePath}\nContent:\n${fileContent}\n\n`;
      }
    }

    if (uniqueEntities.size > 0) {
      hasContext = true;
      for (const entityName of uniqueEntities) {
        console.log("[DEBUG] Fetching entity schema for mention:", entityName);
        const entity = allEntities.value.find((e) => e.label === entityName);
        if (entity) {
          const schema = await (window as any).api.getFileContent(entity.path);
          contextStr += `Entity: ${entityName}\nDefinition:\n${schema}\n\n`;
        }
      }
    }

    if (hasContext) {
      finalPrompt = contextStr + "--- END OF MENTIONS ---\n\n" + content;
    }

    console.log("[DEBUG] finalPrompt length:", finalPrompt.length);
    console.log(
      "[DEBUG] Calling api.askQuestion with modelConfig:",
      JSON.parse(JSON.stringify(thread.modelConfig)),
    );

    const finalResponse = await (window as any).api.askQuestion(
      JSON.parse(
        JSON.stringify({
          text: finalPrompt,
          threadId: activeThreadId.value,
          modelConfig: thread.modelConfig,
          agentId: thread.agentId,
        }),
      ),
    );

    console.log("[DEBUG] api.askQuestion successfully returned:", finalResponse);

    // Only overwrite if it's an error message
    const lastMsg = thread.messages[thread.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && finalResponse.startsWith("Error:")) {
      lastMsg.content = finalResponse;
    }
  } catch (e: any) {
    console.error("[DEBUG] Chat Error in sendMessage:", e);
    // Display error in chat if possible
    const lastMsg = thread.messages[thread.messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      lastMsg.content = `ERROR: ${e.message || "Failed to get response from AI."} Check logs.`;
    }
  } finally {
    console.log("[DEBUG] sendMessage finally block entered");
    isStreaming.value = false;
    reflections.value = [];
    // Removed aggressive setTimeout focus logic as it causes Electron window focus loss bugs.
    // The input is no longer disabled during stream, so it should retain focus naturally if Enter was pressed.
  }
};

const parseMessageContent = (content: string) => {
  if (!content) return [];
  const segments: Array<{ type: "text" | "c3-clipboard"; content: string }> = [];

  // Regex to find the start of a C3 clipboard JSON block
  const startRegex = /\{[\s\n]*"is-c3-clipboard-data"[\s\n]*:[\s\n]*true/g;

  let lastIndex = 0;
  let match;

  while ((match = startRegex.exec(content)) !== null) {
    const startIndex = match.index;

    // Check if we have text before this block
    let blockStartIndex = startIndex;

    // Try to find the matching closing brace
    let depth = 0;
    let endIndex = -1;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") depth++;
        else if (char === "}") depth--;
      }

      if (depth === 0) {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      // Incomplete JSON (maybe still streaming)
      continue;
    }

    let blockEndIndex = endIndex + 1;

    // Detect if this block is wrapped in markdown code blocks
    const beforeBlock = content.substring(lastIndex, startIndex);
    const afterBlock = content.substring(blockEndIndex);

    const codeBlockStartMatch = beforeBlock.match(/```(?:json)?\s*$/);
    const codeBlockEndMatch = afterBlock.match(/^\s*```/);

    if (codeBlockStartMatch && codeBlockEndMatch) {
      // It's wrapped in backticks, let's include them in the "to be replaced" area
      blockStartIndex = startIndex - codeBlockStartMatch[0].length;
      blockEndIndex = blockEndIndex + codeBlockEndMatch[0].length;
    }

    // Push preceding text segment
    if (blockStartIndex > lastIndex) {
      segments.push({ type: "text", content: content.substring(lastIndex, blockStartIndex) });
    }

    // Push the C3 clipboard segment
    const jsonContent = content.substring(startIndex, endIndex + 1);
    segments.push({ type: "c3-clipboard", content: jsonContent });

    lastIndex = blockEndIndex;
    // Reset regex index to after our found block
    startRegex.lastIndex = lastIndex;
  }

  // Push remaining text
  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.substring(lastIndex) });
  }

  return segments;
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};
</script>

<template>
  <div v-if="isStartingUp" class="startup-overlay">
    <div class="startup-content">
      <div class="startup-logo">
        <i class="pi pi-bolt text-primary" style="font-size: 3rem"></i>
      </div>
      <h1 class="startup-title">Construct LLM</h1>
      <div class="startup-status">
        <div class="status-step">{{ startupStatus.step }}</div>
        <div class="status-detail" v-if="startupStatus.detail">{{ startupStatus.detail }}</div>
      </div>
      <div class="startup-loader">
        <div class="loader-bar"></div>
      </div>
    </div>
  </div>
  <div class="app-container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="flex items-center justify-between mb-4">
          <h2 class="m-0">Construct LLM</h2>
          <Button
            icon="pi pi-cog"
            text
            rounded
            @click="showSettingsDialog = true"
            v-tooltip.bottom="'Settings'"
          />
        </div>
        <div class="flex flex-col gap-2">
          <Button
            @click="loadProject"
            label="Open Project"
            icon="pi pi-plus"
            class="w-full"
            size="small"
          />
          <Button
            v-if="currentProject"
            @click="forceReindex"
            label="Re-index Project"
            :icon="isIndexing ? 'pi pi-spin pi-refresh' : 'pi pi-refresh'"
            class="w-full p-button-secondary"
            size="small"
            :disabled="isIndexing"
          />
        </div>
        <div v-if="isIndexing" class="indexing-indicator">
          <i class="pi pi-spin pi-spinner" style="font-size: 0.8rem"></i>
          <span>Indexing project...</span>
        </div>
      </div>

      <div class="sidebar-section" v-if="appState.projects.length > 0">
        <div class="section-header">
          <h3>Projects</h3>
        </div>
        <Listbox
          v-model="appState.activeProjectId"
          :options="appState.projects"
          optionValue="id"
          class="w-full compact-listbox"
          @change="activeThreadId = null"
        >
          <template #option="slotProps">
            <div class="project-item">
              <span class="project-name">{{ slotProps.option.name }}</span>
              <Button
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                size="small"
                @click.stop="deleteProject(slotProps.option.id)"
                class="delete-btn"
              />
            </div>
          </template>
        </Listbox>
      </div>

      <Divider v-if="currentProject" />

      <div class="sidebar-section" v-if="currentProject">
        <div class="section-header">
          <h3>Chats</h3>
          <Button icon="pi pi-plus" text rounded size="small" @click="createNewThread" />
        </div>
        <Listbox
          v-model="activeThreadId"
          :options="currentProject.threads"
          optionValue="id"
          class="w-full compact-listbox"
          @change="onThreadChange"
        >
          <template #option="slotProps">
            <div class="project-item">
              <span class="project-name">{{ slotProps.option.name }}</span>
              <Button
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                size="small"
                @click.stop="deleteThread(slotProps.option.id)"
                class="delete-btn"
              />
            </div>
          </template>
        </Listbox>
      </div>
    </aside>

    <main class="chat-main">
      <header v-if="activeThread" class="chat-header">
        <div class="flex items-center justify-between w-full">
          <h3 class="m-0">{{ activeThread.name }}</h3>
        </div>
      </header>

      <div class="chat-messages" v-if="activeThread" ref="messagesContainer" @scroll="handleScroll">
        <div class="messages-inner">
          <div
            v-for="(msg, index) in activeThread.messages"
            :key="index"
            :class="['message', msg.role]"
          >
            <Card v-if="(msg.parts && msg.parts.length > 0) || msg.content || msg.role === 'user'">
              <template #content>
                <div class="message-content">
                  <div class="message-header">
                    <strong>{{ msg.role === "user" ? "You" : "Assistant" }}:</strong>
                    <Button
                      icon="pi pi-copy"
                      text
                      rounded
                      size="small"
                      @click="copyToClipboard(msg.content)"
                      v-tooltip="'Copy message'"
                    />
                  </div>
                  <div v-if="msg.role === 'assistant'" class="assistant-content">
                    <template
                      v-for="(part, pIndex) in msg.parts && msg.parts.length > 0
                        ? msg.parts
                        : [{ type: 'text', content: msg.content }]"
                      :key="pIndex"
                    >
                      <!-- Reflection Part -->
                      <div
                        v-if="
                          part.type === 'reflection' &&
                          part.reflections &&
                          part.reflections.length > 0
                        "
                        class="research-log mb-4"
                      >
                        <div class="research-log-header">
                          <i class="pi pi-bolt mr-2"></i>
                          <span>Research Log</span>
                        </div>
                        <div class="research-log-content">
                          <div
                            v-for="step in part.reflections"
                            :key="step.id"
                            class="research-step"
                            :class="step.type"
                          >
                            <div class="step-summary">
                              <i
                                :class="
                                  step.type === 'tool' || step.type === 'result'
                                    ? 'pi pi-cog'
                                    : 'pi pi-search'
                                "
                              ></i>
                              <span>{{ step.content }}</span>
                            </div>

                            <!-- Spoiler for JSON details -->
                            <details v-if="step.args || step.result" class="json-spoiler">
                              <summary>View Details</summary>
                              <div class="json-content">
                                <div v-if="step.args">
                                  <label>Arguments:</label>
                                  <pre>{{ JSON.stringify(step.args, null, 2) }}</pre>
                                </div>
                                <div v-if="step.result" class="mt-2">
                                  <label>Result:</label>
                                  <pre>{{
                                    typeof step.result === "string"
                                      ? step.result
                                      : JSON.stringify(step.result, null, 2)
                                  }}</pre>
                                </div>
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>

                      <!-- Text Part -->
                      <div v-else-if="part.type === 'text'" class="markdown-body">
                        <template
                          v-for="(segment, sIndex) in parseMessageContent(part.content || '')"
                          :key="sIndex"
                        >
                          <div
                            v-if="segment.type === 'text'"
                            v-html="md.render(segment.content || '...')"
                          ></div>
                          <div v-else class="c3-clipboard-block">
                            <div class="c3-block-header">
                              <div class="flex items-center gap-2">
                                <i class="pi pi-clone text-primary"></i>
                                <span class="font-bold">Construct 3 Events</span>
                              </div>
                              <Button
                                label="Copy to C3"
                                icon="pi pi-copy"
                                size="small"
                                class="p-button-sm"
                                @click="copyToClipboard(segment.content)"
                              />
                            </div>
                            <div class="c3-preview-container">
                              <C3EventPreview :data="JSON.parse(segment.content)" />
                            </div>
                          </div>
                        </template>
                      </div>
                    </template>
                  </div>
                  <p v-else>{{ msg.content }}</p>
                </div>
              </template>
            </Card>
          </div>

          <!-- Thinking Placeholder (Only for current streaming message) -->
          <div
            v-if="
              isStreaming &&
              activeThread.messages[activeThread.messages.length - 1]?.role === 'assistant' &&
              (!activeThread.messages[activeThread.messages.length - 1].parts ||
                activeThread.messages[activeThread.messages.length - 1].parts.length === 0)
            "
            class="research-log"
          >
            <div class="research-log-header">
              <i class="pi pi-bolt mr-2"></i>
              <span>Research Log</span>
            </div>
            <div class="research-log-content">
              <div class="thinking-placeholder">
                <ProgressSpinner
                  style="width: 20px; height: 20px"
                  strokeWidth="8"
                  fill="transparent"
                  animationDuration=".5s"
                />
                <span>Processing context...</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-input" v-if="activeThread">
        <div class="input-group">
          <Select
            v-model="activeThread.agentId"
            :options="agentOptions"
            optionLabel="label"
            optionValue="id"
            class="agent-select"
          />
          <AutoComplete
            ref="inputRef"
            v-model="newMessage"
            :suggestions="filteredSuggestions"
            @complete="searchSuggestions"
            placeholder="Ask a question... Use @ for files, # for entities"
            @keyup.enter="sendMessage"
            fluid
            class="chat-autocomplete"
            :autoOptionFocus="true"
            @item-select="onSelectMention"
          />
          <Button
            :icon="isStreaming ? 'pi pi-spin pi-spinner' : 'pi pi-send'"
            class="send-btn"
            @click="sendMessage"
            :disabled="!newMessage.trim() || isStreaming"
          />
        </div>
      </div>

      <div v-else class="empty-state">
        <div class="empty-state-content" v-if="currentProject">
          <i
            class="pi pi-comments"
            style="font-size: 3rem; color: #dee2e6; margin-bottom: 1rem"
          ></i>
          <p>Select or create a chat thread to start.</p>
          <Button label="New Chat" icon="pi pi-plus" text @click="createNewThread" />
        </div>
        <div class="empty-state-content" v-else>
          <i
            class="pi pi-folder-open"
            style="font-size: 3rem; color: #dee2e6; margin-bottom: 1rem"
          ></i>
          <p>Open a Construct 3 project to begin.</p>
        </div>
      </div>
    </main>

    <aside class="sidebar-right" v-if="currentProject && projectTree.length > 0">
      <div class="sidebar-section">
        <div class="section-header">
          <h3>Project Explorer</h3>
          <div class="flex gap-1">
            <Button
              icon="pi pi-cog"
              text
              rounded
              size="small"
              @click="openProjectSettings"
              v-tooltip="'Project Settings'"
            />
            <Button
              icon="pi pi-refresh"
              text
              rounded
              size="small"
              @click="forceReindex"
              :loading="isIndexing"
              v-tooltip="'Force Reindex'"
            />
          </div>
        </div>
        <Tree :value="projectTree" class="project-tree w-full">
          <template #default="slotProps">
            <div class="tree-node">
              <span>{{ slotProps.node.label }}</span>
            </div>
          </template>
        </Tree>
      </div>
    </aside>

    <!-- New Chat Dialog -->
    <Dialog v-model:visible="showNewChatDialog" modal header="New Chat" :style="{ width: '25rem' }">
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <label for="chatname" class="font-semibold">Chat Name</label>
          <InputText id="chatname" v-model="newChatName" class="flex-auto" autocomplete="off" />
        </div>
        <div class="flex flex-col gap-2">
          <label for="model" class="font-semibold">AI Model</label>
          <Select
            v-model="selectedModel"
            :options="models"
            optionLabel="label"
            placeholder="Select a model"
            class="w-full"
          />
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="showNewChatDialog = false" />
        <Button label="Create" @click="confirmCreateThread" />
      </template>
    </Dialog>

    <!-- Project Settings Dialog -->
    <Dialog
      v-model:visible="showProjectSettingsDialog"
      modal
      header="Project Settings"
      :style="{ width: '35rem' }"
    >
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <label class="font-semibold">Project Name</label>
          <InputText v-model="projectSettings.name" fluid />
        </div>
        <div class="flex flex-col gap-2">
          <label class="font-semibold">Custom Instructions / Project Prompt</label>
          <p class="text-xs text-gray-500">
            Provide project-specific context, rules, or details the AI should always keep in mind.
          </p>
          <Textarea
            v-model="projectSettings.customPrompt"
            rows="10"
            autoResize
            fluid
            placeholder="e.g., This project uses a custom 'Signals' system for communication. Always prefer using the 'Enemy' family for collision checks..."
          />
        </div>
      </div>
      <template #footer>
        <Button
          label="Cancel"
          text
          severity="secondary"
          @click="showProjectSettingsDialog = false"
        />
        <Button label="Save Changes" icon="pi pi-check" @click="saveProjectSettings" />
      </template>
    </Dialog>

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="showSettingsDialog"
      modal
      header="AI Provider Settings"
      :style="{ width: '30rem' }"
    >
      <p class="text-sm text-gray-500 mb-4">
        Enter your API keys here. They will be encrypted and stored securely on your machine.
      </p>
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <label class="font-semibold">Mistral API Key</label>
          <Password
            v-model="localApiKeys.mistral"
            :feedback="false"
            toggleMask
            fluid
            placeholder="Set new key..."
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="font-semibold">OpenAI API Key</label>
          <Password
            v-model="localApiKeys.openai"
            :feedback="false"
            toggleMask
            fluid
            placeholder="Set new key..."
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="font-semibold">Anthropic API Key</label>
          <Password
            v-model="localApiKeys.anthropic"
            :feedback="false"
            toggleMask
            fluid
            placeholder="Set new key..."
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="font-semibold">Google Gemini API Key</label>
          <Password
            v-model="localApiKeys.google"
            :feedback="false"
            toggleMask
            fluid
            placeholder="Set new key..."
          />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="showSettingsDialog = false" />
        <Button label="Save Keys" icon="pi pi-lock" @click="saveSettings" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: #f8f9fa;
  font-family: var(--font-family);
}

.sidebar {
  width: 280px;
  background-color: #ffffff;
  border-right: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  overflow-y: auto;
}

.sidebar-right {
  width: 280px;
  background-color: #ffffff;
  border-left: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  overflow-y: auto;
}

.sidebar-header {
  margin-bottom: 1.5rem;
}

.indexing-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #6366f1;
  margin-top: 0.5rem;
  font-weight: 500;
}

.sidebar-section {
  margin-bottom: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.section-header h3 {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #adb5bd;
  letter-spacing: 0.05rem;
  margin: 0;
}

.compact-listbox :deep(.p-listbox-list) {
  padding: 0;
}

.compact-listbox :deep(.p-listbox-item) {
  padding: 0;
  font-size: 0.9rem;
}

.project-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.5rem;
}

.project-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 0.5rem;
}

.delete-btn {
  opacity: 0.5;
  transition: opacity 0.2s;
  width: 24px !important;
  height: 24px !important;
}

.project-item:hover .delete-btn,
.project-item.p-highlight .delete-btn {
  opacity: 1;
}

.project-tree {
  border: none;
  padding: 0;
  background: transparent;
}

.project-tree :deep(.p-tree-root-children) {
  padding: 0;
}

.project-tree :deep(.p-treenode-content) {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.tree-node {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: 0.85rem;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
}

.chat-header {
  padding: 1rem;
  background-color: #ffffff;
  border-bottom: 1px solid #dee2e6;
}

.chat-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.chat-messages {
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}

.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.message {
  max-width: 85%;
  min-width: 0;
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

/* Research Log */
.research-log {
  align-self: flex-start;
  margin-top: 0.5rem;
  margin-bottom: 1rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 100%;
  max-width: 400px;
  overflow: hidden;
}

.research-log-header {
  background: #e2e8f0;
  padding: 0.4rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #475569;
  display: flex;
  align-items: center;
  text-transform: uppercase;
}

.research-log-content {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.research-step {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.5rem;
  font-size: 0.8rem;
  color: #475569;
}

.step-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.step-summary i {
  color: #6366f1;
  font-size: 0.75rem;
}

.json-spoiler {
  margin-top: 0.5rem;
  border-top: 1px solid #f1f5f9;
  padding-top: 0.5rem;
}

.json-spoiler summary {
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  user-select: none;
}

.json-spoiler summary:hover {
  color: #6366f1;
}

.json-content {
  margin-top: 0.5rem;
  background: #f8fafc;
  padding: 0.5rem;
  border-radius: 4px;
}

.json-content label {
  display: block;
  font-size: 0.65rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  margin-bottom: 0.25rem;
}

.json-content pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  background: transparent;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #334155;
}

.customized-timeline {
  padding: 0;
}

.customized-timeline :deep(.p-timeline-event-content) {
  padding-bottom: 1rem;
}

.timeline-marker {
  display: flex;
  width: 1.5rem;
  height: 1.5rem;
  align-items: center;
  justify-content: center;
  color: #6366f1;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  z-index: 1;
}

.timeline-marker i {
  font-size: 0.7rem;
}

.timeline-text {
  font-size: 0.8rem;
  color: #475569;
}

.thinking-placeholder {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  font-size: 0.8rem;
  color: #64748b;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-header strong {
  font-size: 0.75rem;
  color: #6c757d;
  text-transform: uppercase;
  margin: 0;
}

.message-content {
  min-width: 0;
  overflow-wrap: break-word;
}

.message-content p {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

.c3-clipboard-block {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  margin: 1rem 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  min-width: 0;
}

.c3-block-header {
  background: #f8fafc;
  padding: 0.5rem 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e2e8f0;
}

.c3-block-header span {
  font-size: 0.85rem;
  color: #334155;
}

.c3-preview-container {
  padding: 0;
  margin: 0;
  max-height: 300px;
  overflow: auto;
  background: white;
}

/* Markdown Styles */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-body :deep(h1) {
  font-size: 1.5rem;
}
.markdown-body :deep(h2) {
  font-size: 1.25rem;
}
.markdown-body :deep(h3) {
  font-size: 1.1rem;
}

.markdown-body :deep(p) {
  margin-top: 0;
  margin-bottom: 1rem;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.markdown-body :deep(code) {
  padding: 0.2rem 0.4rem;
  margin: 0;
  font-size: 85%;
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

.markdown-body :deep(pre) {
  padding: 1rem;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.markdown-body :deep(pre code) {
  padding: 0;
  margin: 0;
  background-color: transparent;
  border: 0;
}

.chat-input {
  padding: 1.5rem;
  background-color: #ffffff;
  border-top: 1px solid #dee2e6;
}

.input-group {
  display: flex;
  background: #ffffff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.input-group:focus-within {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.agent-select {
  border: none !important;
  border-right: 1px solid #dee2e6 !important;
  border-radius: 0 !important;
  background: transparent !important;
  min-width: 140px !important;
  flex-shrink: 0 !important;
  font-size: 0.85rem !important;
}

.chat-autocomplete {
  flex: 1;
  min-width: 0;
}

.chat-autocomplete :deep(.p-inputtext) {
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

.send-btn {
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: #6366f1 !important;
  width: 3rem !important;
}

.send-btn:hover:not(:disabled) {
  background: #f1f5f9 !important;
}

.send-btn:disabled {
  color: #adb5bd !important;
}

.empty-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: #6c757d;
}

.empty-state-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Startup Overlay */
.startup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f8fafc;
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.startup-content {
  text-align: center;
  max-width: 400px;
  width: 100%;
  padding: 2rem;
}

.startup-logo {
  margin-bottom: 1.5rem;
  animation: pulse 2s infinite ease-in-out;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

.startup-title {
  font-size: 2rem;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 2rem;
}

.startup-status {
  margin-bottom: 2rem;
  min-height: 4rem;
}

.status-step {
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.status-detail {
  font-size: 0.85rem;
  color: #64748b;
}

.startup-loader {
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
}

.loader-bar {
  height: 100%;
  background: var(--p-primary-color);
  width: 30%;
  border-radius: 2px;
  animation: loading 1.5s infinite ease-in-out;
}

@keyframes loading {
  0% {
    transform: translateX(-100%);
    width: 30%;
  }
  50% {
    width: 60%;
  }
  100% {
    transform: translateX(400%);
    width: 30%;
  }
}
</style>
