<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import ChatMessageItem from "./ChatMessageItem.vue";
import ChatInput from "./ChatInput.vue";
import { store } from "../../store";

const messagesContainer = ref<HTMLElement | null>(null);

const handleScroll = () => {
  // Can add auto-scroll logic toggles here
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

watch(
  () => store.activeThread?.messages.length,
  () => {
    scrollToBottom();
  },
);
</script>

<template>
  <main class="chat-main" v-if="store.activeThread">
    <header class="chat-header sticky top-0 z-10">
      <div
        class="chat-header-content max-w-4xl mx-auto flex items-center justify-between w-full px-4"
      >
        <div class="flex flex-col">
          <h3 class="m-0 text-base font-semibold">{{ store.activeThread.name }}</h3>
          <span class="text-[10px] opacity-50 uppercase tracking-wider font-bold">
            {{ store.activeThread.modelConfig.provider }} /
            {{ store.activeThread.modelConfig.modelId }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <Button icon="pi pi-info-circle" text rounded size="small" v-tooltip="'Thread Details'" />
          <Button icon="pi pi-share-alt" text rounded size="small" v-tooltip="'Export Chat'" />
        </div>
      </div>
    </header>

    <div class="chat-messages" ref="messagesContainer" @scroll="handleScroll">
      <div class="messages-inner max-w-4xl mx-auto px-4 pb-20 mt-4">
        <ChatMessageItem
          v-for="(msg, index) in store.activeThread.messages"
          :key="index"
          :msg="msg"
        />

        <!-- Thinking Placeholder -->
        <div
          v-if="
            store.isStreaming &&
            store.activeThread.messages[store.activeThread.messages.length - 1]?.role ===
              'assistant' &&
            (!store.activeThread.messages[store.activeThread.messages.length - 1].parts ||
              store.activeThread.messages[store.activeThread.messages.length - 1].parts.length ===
                0)
          "
          class="message-row assistant streaming"
        >
          <div class="avatar assistant pulse">
            <i class="pi pi-bolt"></i>
          </div>
          <div class="message-bubble-container">
            <div
              class="thinking-status px-4 py-2 bg-white rounded-full border border-gray-200 flex items-center gap-3 text-xs font-medium text-gray-500 shadow-sm w-fit"
            >
              <ProgressSpinner
                style="width: 14px; height: 14px"
                strokeWidth="8"
                fill="transparent"
                animationDuration=".5s"
              />
              <span>Formulating response...</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ChatInput />
  </main>
</template>

<style scoped>
/* Chat Main Layout */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100vh;
}

.chat-header {
  height: 64px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color, #f3f4f6);
  display: flex;
  align-items: center;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* Modern Message Rows */
.message-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 0 1rem;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-row.user {
  flex-direction: row-reverse;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 4px;
}

.avatar.assistant {
  background: #f0f7ff;
  color: #3b82f6;
  border: 1px solid #dbeafe;
}

.message-bubble-container {
  max-width: 85%;
}

.pulse {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
  }
}
</style>
