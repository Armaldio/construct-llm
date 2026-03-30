<script setup lang="ts">
import { onMounted } from "vue";
import { store } from "./store";
import { loadState, loadProject } from "./actions";

import AppSidebar from "./components/layout/AppSidebar.vue";
import AppRightSidebar from "./components/layout/AppRightSidebar.vue";
import ChatContainer from "./components/chat/ChatContainer.vue";
import ChatEmptyState from "./components/chat/ChatEmptyState.vue";
import GlobalSettings from "./components/settings/GlobalSettings.vue";
import ProjectSettings from "./components/settings/ProjectSettings.vue";
import NewChatDialog from "./components/settings/NewChatDialog.vue";
import { ref } from "vue";

const showSettingsDialog = ref(false);
const showProjectSettingsDialog = ref(false);
const showNewChatDialog = ref(false);

onMounted(async () => {
  const checkStartup = setInterval(async () => {
    const isComplete = await (window as any).api.isStartupComplete();
    if (isComplete) {
      clearInterval(checkStartup);
      store.isStartingUp = false;
      await loadState();

      if (!store.currentProject && store.appState.projects.length === 0) {
        // Automatically ask to open a project if none exist
      }
    }
  }, 100);

  // Streaming event listener
  (window as any).api.onAgentChunk((data: string | { text: string; metadata?: any }) => {
    if (store.activeThread) {
      const messages = store.activeThread.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        const chunk = typeof data === "string" ? data : data.text;
        const metadata = typeof data === "object" ? data.metadata : undefined;

        if (!lastMsg.parts) lastMsg.parts = [];

        // Remove any transient placeholders
        lastMsg.parts.forEach((p) => {
          if (p.type === "reflection" && p.reflections) {
            p.reflections = p.reflections.filter((r) => !r.transient);
          }
        });

        const targetType = metadata?.type === "c3-clipboard" ? "c3-clipboard" : "text";

        let lastPart = lastMsg.parts[lastMsg.parts.length - 1];
        if (!lastPart || lastPart.type !== targetType) {
          lastPart = { type: targetType, content: "", metadata };
          if (targetType === "c3-clipboard") {
            lastPart.isStreaming = true;
          }
          lastMsg.parts.push(lastPart);
        }

        lastPart.content += chunk;
        lastMsg.content += chunk;
      }
    }
  });

  // Tool / Reflection event listener
  (window as any).api.onAgentReflection((data: any) => {
    if (store.activeThread) {
      const messages = store.activeThread.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        if (!lastMsg.parts) lastMsg.parts = [];

        // Handle regular (non-transient) thoughts by adding a new thought part
        if (data.type === "thought" && !data.transient) {
          // If the last part was also a thought, append to it for consolidation
          const lastPart = lastMsg.parts[lastMsg.parts.length - 1];
          if (lastPart && lastPart.type === "thought") {
            lastPart.content += data.content || "";
          } else {
            lastMsg.parts.push({
              type: "thought",
              content: data.content || "",
            });
          }
          return;
        }

        // --- Handle tool-related reflections (tool-call-delta, tool-call, tool-result) ---
        // These will each create/update a ChatMessagePart of type 'reflection' with a single Reflection inside

        if (data.type === "tool-call-delta") {
          let partForToolCall = lastMsg.parts
            .filter((p) => p.type === "reflection" && p.reflections && p.reflections.length === 1)
            .find((p) => p.reflections![0].toolCallId === data.toolCallId);

          const isRecordThought = data.toolName === "record_thought";

          if (partForToolCall) {
            // Update existing reflection within the part
            let reflectionToUpdate = partForToolCall.reflections![0];
            if (!reflectionToUpdate.argsText) reflectionToUpdate.argsText = "";
            reflectionToUpdate.argsText += data.argsTextDelta || "";

            if (isRecordThought) {
              const key = '"thought":';
              const kIdx = reflectionToUpdate.argsText.indexOf(key);
              if (kIdx !== -1) {
                const sIdx = reflectionToUpdate.argsText.indexOf('"', kIdx + key.length);
                if (sIdx !== -1) {
                  let val = reflectionToUpdate.argsText.substring(sIdx + 1);
                  if (val.endsWith('"')) val = val.slice(0, -1);
                  const cleanText = val
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"')
                    .replace(/\\t/g, "\t");
                  reflectionToUpdate.content = `Reasoning: ${cleanText}`;
                }
              }
            } else {
              reflectionToUpdate.content = `Preparing tool: ${data.toolName}... (args: ${reflectionToUpdate.argsText})`;
            }
          } else {
            // First delta for this tool call, create a new 'reflection' part
            lastMsg.parts.push({
              type: "reflection",
              content: "", // Content not used for reflection parts
              reflections: [
                {
                  id: Date.now(),
                  content: isRecordThought
                    ? "Reasoning: ..."
                    : `Preparing tool: ${data.toolName}...`,
                  type: "tool",
                  toolName: data.toolName,
                  toolCallId: data.toolCallId,
                  argsText: data.argsTextDelta || "",
                },
              ],
            });
          }
        } else if (data.type === "tool-call") {
          let partForToolCall = lastMsg.parts
            .filter((p) => p.type === "reflection" && p.reflections && p.reflections.length === 1)
            .find((p) => p.reflections![0].toolCallId === data.toolCallId);

          if (partForToolCall) {
            let reflectionToUpdate = partForToolCall.reflections![0];
            reflectionToUpdate.argsText = JSON.stringify(data.args, null, 2);
            reflectionToUpdate.content =
              data.toolName === "record_thought"
                ? "Reasoning complete"
                : `Called tool: ${data.toolName}`;
            reflectionToUpdate.args = data.args;
          } else {
            // Fallback: if tool-call-delta was somehow missed
            lastMsg.parts.push({
              type: "reflection",
              content: "",
              reflections: [
                {
                  id: Date.now(),
                  content: `Called tool: ${data.toolName}`,
                  type: "tool",
                  toolName: data.toolName,
                  toolCallId: data.toolCallId,
                  args: data.args,
                },
              ],
            });
          }
        } else if (data.type === "tool-result") {
          let partForToolCall = lastMsg.parts
            .filter((p) => p.type === "reflection" && p.reflections && p.reflections.length === 1)
            .find((p) => p.reflections![0].toolCallId === data.toolCallId);

          if (partForToolCall) {
            let reflectionToUpdate = partForToolCall.reflections![0];
            reflectionToUpdate.result = data.result;
            reflectionToUpdate.content = `Completed: ${data.toolName}`;

            // Special Case: Detect C3 Clipboard JSON from tool results and push as a separate part
            let toolRes = data.result;
            if (typeof toolRes === "string") {
              try {
                toolRes = JSON.parse(toolRes);
              } catch (e) {
                // Not JSON
              }
            }

            if (
              toolRes &&
              typeof toolRes === "object" &&
              (toolRes["is-c3-clipboard-data"] || (toolRes as any).data?.["is-c3-clipboard-data"])
            ) {
              const clipboardData = (toolRes as any).data || toolRes;
              lastMsg.parts.push({
                type: "c3-clipboard",
                content: JSON.stringify(clipboardData),
                isStreaming: false, // Result is complete
              });
            }
          } else {
            // Fallback: if previous tool parts were somehow missed
            lastMsg.parts.push({
              type: "reflection",
              content: "",
              reflections: [
                {
                  id: Date.now(),
                  content: `Tool result: ${data.toolName}`,
                  type: "result",
                  toolName: data.toolName,
                  toolCallId: data.toolCallId,
                  result: data.result,
                },
              ],
            });
          }
        }
      }
    }
  });

  // Startup progress listener
  (window as any).api.onStartupProgress((data: any) => {
    store.startupStatus.step = data.message || "Loading...";
    store.startupStatus.detail = data.detail || "";
    store.startupStatus.percent = data.percent || 0;
    store.startupStatus.error = !!data.error;
  });

  (window as any).api.onStartupComplete(() => {
    store.isStartingUp = false;
    loadState();
  });
});
</script>

<template>
  <div v-if="store.isStartingUp" class="startup-overlay">
    <div class="startup-content">
      <div class="startup-logo">
        <i class="pi pi-bolt text-blue-500" style="font-size: 3rem"></i>
      </div>
      <h1 class="startup-title">Construct LLM</h1>
      <div class="startup-status">
        <div class="status-step" :class="{ 'text-red-500': store.startupStatus.error }">
          {{ store.startupStatus.step }}
        </div>
        <div class="status-detail" v-if="store.startupStatus.detail">
          {{ store.startupStatus.detail }}
        </div>
      </div>
      <div class="startup-loader">
        <div
          class="loader-bar"
          :class="{ 'loader-animated': store.startupStatus.percent === 0 }"
          :style="{ width: store.startupStatus.percent > 0 ? store.startupStatus.percent + '%' : '30%' }"
        ></div>
      </div>
    </div>
  </div>

  <div class="app-container" v-else>
    <AppSidebar
      @openSettings="showSettingsDialog = true"
      @openProjectSettings="showProjectSettingsDialog = true"
    />

    <ChatContainer v-if="store.activeThread" />
    <ChatEmptyState v-else />

    <AppRightSidebar @openProjectSettings="showProjectSettingsDialog = true" />

    <!-- Global Modals -->
    <GlobalSettings v-model:visible="showSettingsDialog" />
    <ProjectSettings v-model:visible="showProjectSettingsDialog" />
    <NewChatDialog v-model:visible="showNewChatDialog" />
  </div>
</template>

<style>
/* App Shell Layout */
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-chat, #ffffff);
}

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
  animation: pulseLogo 2s infinite ease-in-out;
}

@keyframes pulseLogo {
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
  width: 100%;
  height: 4px;
  background: #f1f3f5;
  border-radius: 2px;
  overflow: hidden;
}

.loader-bar {
  height: 100%;
  background: var(--primary-color, #3b82f6);
  width: 0%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.loader-animated {
  animation: loading 1.5s infinite ease-in-out;
}

@keyframes loading {
  0% {
    width: 0;
    margin-left: 0;
  }
  50% {
    width: 70%;
    margin-left: 15%;
  }
  100% {
    width: 0;
    margin-left: 100%;
  }
}
</style>
