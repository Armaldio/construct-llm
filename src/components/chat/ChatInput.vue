<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import MonacoChatInput from "./MonacoChatInput.vue";
import { store, SUPPORTED_MODELS } from "../../store";
import { sendMessage, createNewThread } from "../../actions";

const props = defineProps({
  standalone: {
    type: Boolean,
    default: false,
  },
});

const newMessage = ref("");
const inputRef = ref<InstanceType<typeof MonacoChatInput> | null>(null);

const selectedModel = ref(SUPPORTED_MODELS[0]);

const models = SUPPORTED_MODELS;

const agentOptions = [
  { label: "🤖 Automatic", id: "auto" },
  { label: "🏗️ Architect", id: "architect-agent" },
  { label: "🧠 Logic Expert", id: "logic-expert-agent" },
  { label: "🎨 Generator", id: "generator-agent" },
];

const onSend = () => {
  if (!newMessage.value.trim()) return;

  if (props.standalone) {
    createNewThread("New Chat", selectedModel.value, newMessage.value);
  } else {
    sendMessage(newMessage.value, []);
  }
  newMessage.value = "";
};
</script>

<template>
  <div
    :class="[
      'chat-input-container w-full',
      standalone
        ? 'relative py-10'
        : 'sticky bottom-0 z-10 bg-gradient-to-t from-white via-white/90 to-transparent pt-10 pb-6',
    ]"
  >
    <div class="max-w-4xl mx-auto px-4" v-if="store.activeThread || standalone">
      <div
        class="input-wrapper shadow-lg border border-gray-200 bg-white rounded-2xl p-2 transition-all hover:border-blue-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100"
      >
        <div class="input-tools flex items-center justify-between mb-2 px-2">
          <Select
            v-if="!standalone"
            v-model="store.activeThread!.agentId"
            :options="agentOptions"
            optionLabel="label"
            optionValue="id"
            class="compact-agent-select"
            size="small"
          />
          <Select
            v-else
            v-model="selectedModel"
            :options="models"
            optionLabel="label"
            class="compact-agent-select"
            size="small"
          />
          <div class="flex items-center gap-1 opacity-60">
            <span class="text-[10px] font-bold uppercase tracking-widest">{{
              standalone ? selectedModel.modelId : store.activeThread?.modelConfig.modelId
            }}</span>
          </div>
        </div>
        <div class="flex items-end gap-2">
          <MonacoChatInput
            ref="inputRef"
            v-model="newMessage"
            :placeholder="
              standalone
                ? 'Start a new conversation...'
                : 'Message Construct LLM... (Type @ for files, # for Object Types)'
            "
            @submit="onSend"
            class="flex-1"
          />
          <Button
            :icon="store.isStreaming ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-up'"
            class="send-btn-new rounded-xl h-10 w-10 flex-shrink-0"
            @click="onSend"
            :disabled="!newMessage.trim() || store.isStreaming"
            severity="primary"
          />
        </div>
      </div>
      <div class="text-[10px] text-center mt-3 opacity-40 font-medium">
        AI can make mistakes. Verify important project details in the Construct 3 editor.
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Chat Input Styling */
.chat-input-container {
  border-top: none;
}

.input-wrapper {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.send-btn-new {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;
}

.send-btn-new:active {
  transform: scale(0.95);
}

.compact-agent-select :deep(.p-select-label) {
  font-weight: 700;
  color: #64748b;
}

.compact-agent-select {
  border: none !important;
  background: transparent !important;
}
</style>
