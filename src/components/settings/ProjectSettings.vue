<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import { store } from "../../store";
import { forceReindex } from "../../actions";

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(["update:visible"]);

const projectSettings = ref({
  name: "",
  customPrompt: "",
});

watch(
  () => props.visible,
  (newVal) => {
    if (newVal && store.currentProject) {
      projectSettings.value = {
        name: store.currentProject.name,
        customPrompt: store.currentProject.customPrompt || "",
      };
    }
  },
);

const saveProjectSettings = () => {
  if (!store.currentProject) return;
  store.currentProject.name = projectSettings.value.name;
  store.currentProject.customPrompt = projectSettings.value.customPrompt;
  emit("update:visible", false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="Project Context"
    :style="{ width: '45rem' }"
    class="project-settings-dialog"
  >
    <div v-if="store.currentProject" class="flex flex-col gap-8 py-2">
      <div class="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div class="p-3 bg-white rounded-lg shadow-sm">
          <i class="pi pi-folder text-blue-500 text-2xl"></i>
        </div>
        <div class="flex flex-col overflow-hidden">
          <span class="text-xs font-bold opacity-50 uppercase tracking-widest">Active Path</span>
          <span class="text-sm truncate font-mono">{{ store.currentProject.path }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <label class="text-base font-bold">Project Name</label>
        <InputText v-model="projectSettings.name" fluid placeholder="Display Name" />
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <label class="text-base font-bold">System Instructions (Project Prompt)</label>
          <span class="text-[10px] bg-blue-50 text-blue-500 px-2 py-1 rounded-full font-bold"
            >CONTEXT INJECTION</span
          >
        </div>
        <p class="text-xs opacity-60">
          Define specific rules for this project. E.g., "Always use 'Player' as the main object," or
          "The project uses the '8-Direction' behavior for movement."
        </p>
        <Textarea
          v-model="projectSettings.customPrompt"
          rows="8"
          autoResize
          fluid
          class="font-mono text-sm p-4 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
          placeholder="Type your project-specific AI rules here..."
        />
      </div>

      <div class="border-t border-gray-200 pt-6">
        <h4 class="m-0 mb-4 text-base font-bold">Advanced Management</h4>
        <div class="flex flex-col gap-4">
          <div
            class="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <div class="flex flex-col gap-1">
              <span class="text-sm font-bold">Vector Database Index</span>
              <span class="text-[10px] opacity-60"
                >Force a full re-scan and embedding of all project files.</span
              >
            </div>
            <Button
              label="Re-index Project"
              icon="pi pi-refresh"
              severity="secondary"
              size="small"
              @click="forceReindex"
              :loading="store.isIndexing"
              raised
            />
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2 border-t border-gray-200 pt-4">
        <Button label="Cancel" text severity="secondary" @click="emit('update:visible', false)" />
        <Button label="Apply & Save" icon="pi pi-check" @click="saveProjectSettings" raised />
      </div>
    </template>
  </Dialog>
</template>
