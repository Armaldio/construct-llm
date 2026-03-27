<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import { createNewThread } from "../../actions";
import { SUPPORTED_MODELS } from "../../store";

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(["update:visible"]);

const newChatName = ref("");
const selectedModel = ref(SUPPORTED_MODELS[0]);

const models = SUPPORTED_MODELS;

const getProviderIcon = (provider: string) => {
  switch (provider) {
    case "mistral":
      return "pi pi-bolt text-orange-500";
    case "openai":
      return "pi pi-prime text-green-600";
    case "anthropic":
      return "pi pi-palette text-amber-700";
    case "google":
      return "pi pi-google text-blue-500";
    default:
      return "pi pi-cpu";
  }
};

const confirmCreateThread = () => {
  const name = newChatName.value.trim() || "New Chat";
  createNewThread(name, selectedModel.value);
  newChatName.value = "";
  emit("update:visible", false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="Start New Conversation"
    :style="{ width: '30rem' }"
  >
    <div class="flex flex-col gap-6 py-4">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-bold">Chat Title</label>
        <InputText v-model="newChatName" fluid placeholder="E.g., Player Controller Logic" />
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-bold">Intelligence Model</label>
        <Select
          v-model="selectedModel"
          :options="models"
          optionLabel="label"
          placeholder="Select a model"
          class="w-full"
        >
          <template #option="slotProps">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded bg-gray-50">
                <i :class="getProviderIcon(slotProps.option.provider)" class="text-[10px]"></i>
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-bold">{{ slotProps.option.label }}</span>
                <span class="text-[10px] opacity-50 uppercase tracking-widest">{{
                  slotProps.option.provider
                }}</span>
              </div>
            </div>
          </template>
        </Select>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="emit('update:visible', false)" />
      <Button label="Create Chat" icon="pi pi-plus" @click="confirmCreateThread" raised />
    </template>
  </Dialog>
</template>
