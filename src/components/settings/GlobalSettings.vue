<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Password from "primevue/password";
import Dialog from "primevue/dialog";
import { store } from "../../store";
import { saveCurrentState } from "../../actions";

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(["update:visible"]);

const localApiKeys = ref<Record<string, string>>({
  mistral: "",
  openai: "",
  anthropic: "",
  google: "",
  openrouter: "",
});

const saveSettings = async () => {
  const keysToSave: Record<string, string> = {};
  if (localApiKeys.value.mistral) keysToSave.mistral = localApiKeys.value.mistral;
  if (localApiKeys.value.openai) keysToSave.openai = localApiKeys.value.openai;
  if (localApiKeys.value.anthropic) keysToSave.anthropic = localApiKeys.value.anthropic;
  if (localApiKeys.value.google) keysToSave.google = localApiKeys.value.google;
  if (localApiKeys.value.openrouter) keysToSave.openrouter = localApiKeys.value.openrouter;

  // Save the real keys to the encrypted backend storage
  await (window as any).api.saveApiKeys(keysToSave);

  // Update the frontend store with masked versions for the UI
  const masked: Record<string, string> = { ...store.appState.apiKeys };
  Object.keys(keysToSave).forEach((k) => {
    masked[k] = "********";
  });
  store.appState.apiKeys = masked;

  // Persist the general app state (this will send masked keys to main process, which is fine as main ignores them in saveState)
  saveCurrentState();

  // Clear local input
  localApiKeys.value = {
    mistral: "",
    openai: "",
    anthropic: "",
    google: "",
    openrouter: "",
  };
  emit("update:visible", false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="System Settings"
    :style="{ width: '40rem' }"
    class="settings-dialog"
  >
    <div class="settings-tabs h-[500px] flex overflow-hidden">
      <div class="settings-nav w-40 flex flex-col border-r border-gray-200 pr-4">
        <Button
          label="Model Providers"
          icon="pi pi-key"
          text
          class="justify-start mb-1"
          size="small"
        />
        <Button
          label="Preferences"
          icon="pi pi-sliders-h"
          text
          class="justify-start mb-1"
          size="small"
          severity="secondary"
          disabled
        />
        <Button
          label="About"
          icon="pi pi-info-circle"
          text
          class="justify-start mt-auto"
          size="small"
          severity="secondary"
          disabled
        />
      </div>
      <div class="settings-content flex-1 pl-6 overflow-y-auto">
        <h4 class="mt-0 mb-4 font-bold text-base">API Configuration</h4>
        <p class="text-xs opacity-60 mb-6">
          Enter your API keys for each provider. They are encrypted and stored locally.
        </p>

        <div class="flex flex-col gap-6">
          <div
            v-for="(label, provider) in {
              mistral: 'Mistral AI',
              openai: 'OpenAI',
              anthropic: 'Anthropic (Claude)',
              google: 'Google (Gemini)',
              openrouter: 'OpenRouter',
            }"
            :key="provider"
            class="flex flex-col gap-2"
          >
            <div class="flex items-center justify-between">
              <label class="text-sm font-bold">{{ label }}</label>
              <div
                v-if="store.appState.apiKeys[provider as keyof typeof store.appState.apiKeys]"
                class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold"
              >
                CONNECTED
              </div>
              <div
                v-else
                class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold"
              >
                NOT SET
              </div>
            </div>
            <Password
              v-model="localApiKeys[provider]"
              :feedback="false"
              toggleMask
              fluid
              placeholder="sk-..."
              class="settings-password"
            />
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-between w-full border-t border-gray-200 pt-4">
        <div class="text-[10px] opacity-40 flex items-center">
          <i class="pi pi-lock mr-1"></i> AES-256 Encryption Active
        </div>
        <div class="flex gap-2">
          <Button label="Close" text severity="secondary" @click="emit('update:visible', false)" />
          <Button label="Save Changes" icon="pi pi-check" @click="saveSettings" raised />
        </div>
      </div>
    </template>
  </Dialog>
</template>
