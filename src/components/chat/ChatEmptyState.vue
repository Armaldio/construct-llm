<script setup lang="ts">
import Button from "primevue/button";
import ChatInput from "./ChatInput.vue";
import { store } from "../../store";
import { loadProject } from "../../actions";

const emit = defineEmits(["newChat"]);
</script>

<template>
  <div
    class="empty-state-full max-w-4xl mx-auto flex flex-col items-center justify-center py-20 px-4 text-center"
  >
    <div v-if="store.currentProject" class="welcome-container flex flex-col items-center w-full">
      <div class="logo-large mb-6 bg-blue-50 text-blue-500 p-6 rounded-3xl shadow-sm">
        <i class="pi pi-bolt text-5xl"></i>
      </div>
      <h2 class="text-3xl font-bold mb-2">Welcome back to {{ store.currentProject.name }}</h2>
      <p class="text-gray-500 mb-12 max-w-md text-lg">What would you like to build today?</p>

      <div class="w-full max-w-2xl">
        <ChatInput standalone />
      </div>
    </div>
    <div v-else class="no-project-container flex flex-col items-center">
      <div class="logo-large mb-6 bg-gray-100 text-gray-300 p-6 rounded-3xl">
        <i class="pi pi-folder-open text-5xl"></i>
      </div>
      <h2 class="text-3xl font-bold mb-2">Construct LLM</h2>
      <p class="text-gray-500 mb-8 max-w-md">
        The RAG-powered assistant for your Construct 3 projects. Open a project from the sidebar to
        get started.
      </p>
      <Button label="Open New Project" icon="pi pi-folder-open" size="large" @click="loadProject" />
    </div>
  </div>
</template>

<style scoped>
.empty-state-full {
  animation: fadeIn 0.5s ease-out;
  flex: 1;
  width: 100%;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
