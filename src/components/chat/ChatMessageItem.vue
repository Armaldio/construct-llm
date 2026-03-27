<script setup lang="ts">
import { PropType } from "vue";
import MarkdownIt from "markdown-it";
import Button from "primevue/button";
import C3EventPreview from "../../C3EventPreview.vue";
import { ChatMessage, ChatMessagePart } from "../../store";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

md.renderer.rules.text = function (tokens, idx, options, env, self) {
  const content = tokens[idx].content;
  const escaped = md.utils.escapeHtml(content);
  return escaped
    .replace(/(@[a-zA-Z0-9_/.-]+)/g, '<span class="text-blue-500 font-bold">$1</span>')
    .replace(/(#[a-zA-Z0-9_/.-]+)/g, '<span class="text-emerald-500 font-bold">$1</span>');
};

const formatUserMessage = (text: string) => {
  if (!text) return "";
  const escaped = md.utils.escapeHtml(text);
  return escaped
    .replace(/(@[a-zA-Z0-9_/.-]+)/g, '<span class="text-blue-500 font-bold">$1</span>')
    .replace(/(#[a-zA-Z0-9_/.-]+)/g, '<span class="text-emerald-500 font-bold">$1</span>');
};

const props = defineProps({
  msg: {
    type: Object as PropType<ChatMessage>,
    required: true,
  },
});

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

const safeParsedC3 = (part: ChatMessagePart) => {
  if (part.isStreaming || !part.content) {
    return null; // Don't try to parse if still streaming or no content
  }
  try {
    const parsed = JSON.parse(part.content);
    // Basic check for C3 clipboard data structure
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed["is-c3-clipboard-data"] || (parsed as any).data?.["is-c3-clipboard-data"])
    ) {
      return (parsed as any).data || parsed;
    }
    return null; // Not valid C3 data
  } catch (e) {
    console.error("Failed to parse C3 clipboard JSON:", e);
    return null; // Malformed JSON
  }
};
</script>

<template>
  <div :class="['message-row', msg.role]">
    <!-- Assistant Avatar -->
    <div v-if="msg.role === 'assistant'" class="avatar assistant">
      <i class="pi pi-bolt"></i>
    </div>

    <div class="message-bubble-container group">
      <div
        v-if="(msg.parts && msg.parts.length > 0) || msg.content || msg.role === 'user'"
        class="message-bubble"
      >
        <div class="message-content">
          <div v-if="msg.role === 'assistant'" class="assistant-content p-1">
            <template
              v-for="(part, pIndex) in msg.parts && msg.parts.length > 0
                ? msg.parts
                : ([
                    { type: 'text', content: msg.content },
                  ] as import('../../store').ChatMessagePart[])"
              :key="pIndex"
            >
              <!-- C3 Clipboard Part (Directly from Generator) -->
              <div
                v-if="part.type === 'c3-clipboard'"
                class="c3-clipboard-card mb-6 mt-2 border border-gray-200"
              >
                <div
                  class="card-header px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between"
                >
                  <div class="flex items-center gap-2 font-bold text-xs">
                    <i class="pi pi-clone text-blue-500"></i>
                    <span>Construct 3 Events</span>
                  </div>
                  <Button
                    label="Copy Events"
                    icon="pi pi-copy"
                    size="small"
                    class="h-7 text-[10px]"
                    @click="copyToClipboard(part.content)"
                  />
                </div>
                <div class="card-body bg-white max-h-[400px] overflow-auto">
                  <div v-if="part.isStreaming" class="p-4 text-center text-gray-500">
                    <i class="pi pi-spin pi-spinner"></i>
                    <span class="ml-2">Generating Events...</span>
                  </div>
                  <C3EventPreview v-else :data="safeParsedC3(part)" />
                </div>
              </div>

              <!-- Native Thinking -->
              <div v-if="part.type === 'thought'" class="thought-block mb-4 border border-gray-100">
                <details open>
                  <summary class="thought-summary">
                    <i class="pi pi-sparkles mr-2 text-blue-400"></i>
                    <span>Deep Thinking</span>
                  </summary>
                  <div
                    class="thought-content p-4 text-sm leading-relaxed whitespace-pre-wrap border-t border-gray-100"
                  >
                    {{ part.content }}
                  </div>
                </details>
              </div>

              <!-- Legacy Reflection Part -->
              <div
                v-if="part.type === 'reflection' && part.reflections && part.reflections.length > 0"
                class="flex flex-col gap-2 mb-4"
              >
                <details
                  v-for="step in part.reflections"
                  :key="step.id"
                  class="research-step bg-white border border-gray-200 rounded text-xs"
                  :class="step.type"
                >
                  <summary
                    class="step-summary flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50"
                  >
                    <i
                      :class="
                        step.type === 'tool' || step.type === 'result'
                          ? 'pi pi-cog spin-slow'
                          : 'pi pi-search'
                      "
                    ></i>
                    <span class="font-medium">{{ step.content }}</span>
                  </summary>
                  <div class="step-details p-3 bg-gray-50 border-t border-gray-200">
                    <div v-if="step.toolName" class="mb-2 text-gray-500 font-semibold">
                      Tool: <span class="font-mono text-gray-700">{{ step.toolName }}</span>
                    </div>
                    <div v-if="step.argsText || step.args" class="mb-3">
                      <div class="text-gray-500 font-semibold mb-1">Arguments:</div>
                      <pre
                        class="bg-gray-100 p-2 rounded text-[10px] whitespace-pre-wrap font-mono text-gray-800 border border-gray-200"
                        >{{ step.argsText || JSON.stringify(step.args, null, 2) }}</pre
                      >
                    </div>
                    <div v-if="step.result" class="mb-1">
                      <div class="text-gray-500 font-semibold mb-1">Result:</div>
                      <pre
                        class="bg-gray-100 p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap max-h-60 font-mono text-gray-800 border border-gray-200"
                        >{{
                          typeof step.result === "object"
                            ? JSON.stringify(step.result, null, 2)
                            : step.result
                        }}</pre
                      >
                    </div>
                  </div>
                </details>
              </div>

              <!-- Text Part -->
              <div v-else-if="part.type === 'text'" class="markdown-body text-base leading-relaxed">
                <div v-html="md.render(part.content || '')"></div>
              </div>
            </template>
          </div>
          <div
            v-else
            class="user-content whitespace-pre-wrap leading-relaxed"
            v-html="formatUserMessage(msg.content)"
          ></div>
        </div>

        <div
          class="message-footer mt-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity h-6"
        >
          <Button
            icon="pi pi-copy"
            text
            rounded
            size="small"
            class="h-6 w-6 opacity-50 hover:opacity-100"
            @click="copyToClipboard(msg.content)"
            v-tooltip="'Copy'"
          />
        </div>
      </div>
    </div>

    <!-- User Avatar -->
    <div v-if="msg.role === 'user'" class="avatar user">
      <i class="pi pi-user"></i>
    </div>
  </div>
</template>

<style scoped>
.message-bubble {
  padding: 0.25rem 0;
}

.assistant-content {
  color: #1a1a1a;
}

.user-content {
  background: #f3f4f6;
  padding: 0.75rem 1.25rem;
  border-radius: 18px;
  font-size: 0.95rem;
  color: #111827;
}

/* Thinking/Thought Blocks */
.thought-block {
  background: #fcfcfc;
  border: 1px solid #f1f5f9;
  border-radius: 14px;
  margin: 1rem 0;
}

.thought-summary {
  padding: 0.75rem 1.25rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  color: #94a3b8;
  list-style: none;
  display: flex;
  align-items: center;
  transition: color 0.2s;
}

.thought-summary::-webkit-details-marker {
  display: none;
}
.thought-summary:hover {
  color: var(--blue-color, #3b82f6);
}

.thought-content {
  border-top: 1px solid #f1f5f9;
  font-family: "SF Mono", "Roboto Mono", monospace;
  line-height: 1.6;
}

/* C3 Clipboard Card */
.c3-clipboard-card {
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
}

/* Markdown Polish */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  font-weight: 700;
}

.markdown-body :deep(p) {
  margin-bottom: 1.25rem;
}

.markdown-body :deep(code) {
  padding: 0.2em 0.4em;
  background: #f1f5f9;
  border-radius: 4px;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  padding: 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 1.25rem;
  overflow-x: auto;
}

.spin-slow {
  animation: spin 3s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
