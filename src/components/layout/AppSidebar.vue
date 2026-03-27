<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import { store } from "../../store";
import { loadProject, deleteProject, deleteThread } from "../../actions";

const emit = defineEmits(["openSettings", "openProjectSettings", "newChat"]);

const groupedThreads = computed(() => {
  if (!store.currentProject) return {};
  const threads = store.currentProject.threads || [];
  const groups: Record<string, any[]> = {};

  threads.forEach((t) => {
    const groupName = "Recent Chats";
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(t);
  });
  return groups;
});

const onProjectChange = () => {
  store.activeThreadId = null;
  store.activeThread = null;
};

const getProjectName = (id: string) => {
  return store.appState.projects.find((p) => p.id === id)?.name || "Unknown Project";
};

const startNewChat = () => {
  store.activeThreadId = null;
  store.activeThread = null;
};

const onThreadSelect = (id: string) => {
  store.activeThreadId = id;
  if (store.currentProject) {
    store.activeThread = store.currentProject.threads.find((t) => t.id === id) || null;
  }
};
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-top">
      <div class="sidebar-header flex items-center justify-between mb-6">
        <div class="flex items-center gap-2">
          <i class="pi pi-bolt text-blue-500 text-xl"></i>
          <h2 class="m-0 text-lg font-bold">Construct LLM</h2>
        </div>
        <Button
          icon="pi pi-cog"
          text
          rounded
          @click="emit('openSettings')"
          v-tooltip.right="'Global Settings'"
          class="settings-btn"
        />
      </div>

      <div class="project-context mb-6">
        <div class="section-label mb-2 px-1 flex justify-between items-center">
          <span>Active Project</span>
          <Button
            icon="pi pi-plus"
            text
            rounded
            size="small"
            class="h-6 w-6 p-0"
            @click="loadProject"
            v-tooltip.top="'Open New Project'"
          />
        </div>
        <Select
          v-model="store.appState.activeProjectId"
          :options="store.appState.projects"
          optionLabel="name"
          optionValue="id"
          placeholder="Select Project"
          class="w-full project-select shadow-sm"
          @change="onProjectChange"
        >
          <template #value="slotProps">
            <div v-if="slotProps.value" class="flex items-center gap-2">
              <i class="pi pi-folder-open text-blue-500"></i>
              <div class="truncate max-w-[140px]">{{ getProjectName(slotProps.value) }}</div>
            </div>
            <span v-else>{{ slotProps.placeholder }}</span>
          </template>
          <template #option="slotProps">
            <div class="flex items-center justify-between w-full pr-2">
              <div class="flex items-center gap-2">
                <i class="pi pi-folder"></i>
                <span>{{ slotProps.option.name }}</span>
              </div>
              <Button
                icon="pi pi-trash"
                text
                rounded
                severity="danger"
                size="small"
                @click.stop="deleteProject(slotProps.option.id)"
                class="h-6 w-6"
              />
            </div>
          </template>
          <template #empty>
            <div class="p-4 text-center text-sm text-gray-500 flex flex-col gap-2">
              <span>No projects found.</span>
              <Button
                label="Open New Project"
                icon="pi pi-plus"
                text
                size="small"
                class="w-full justify-center"
                @click="loadProject"
              />
            </div>
          </template>
          <template #footer>
            <div class="p-2 border-t border-gray-200">
              <Button
                label="Open New Project"
                icon="pi pi-plus"
                text
                size="small"
                class="w-full justify-start"
                @click="loadProject"
              />
            </div>
          </template>
        </Select>

        <div v-if="store.isIndexing" class="indexing-pulse mt-3 px-2 flex items-center gap-2">
          <div class="pulse-dot"></div>
          <span class="text-xs font-medium text-blue-500">Syncing Project Data...</span>
        </div>
      </div>

      <Button
        label="New Chat"
        icon="pi pi-plus"
        class="w-full new-chat-btn mb-6"
        severity="primary"
        @click="startNewChat"
        :disabled="!store.currentProject"
      />

      <div class="sidebar-nav" v-if="store.currentProject">
        <div class="nav-section" v-for="(group, gName) in groupedThreads" :key="gName">
          <div class="section-label px-2 mb-2 mt-4">{{ gName }}</div>
          <div class="nav-items">
            <div
              v-for="thread in group"
              :key="thread.id"
              :class="['nav-item', { active: store.activeThreadId === thread.id }]"
              @click="onThreadSelect(thread.id)"
            >
              <i class="pi pi-comment text-xs mr-2 opacity-50"></i>
              <span class="nav-text">{{ thread.name }}</span>
              <div class="nav-actions">
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  size="small"
                  class="h-6 w-6"
                  @click.stop="deleteThread(thread.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar-bottom mt-auto pt-4 border-t border-gray-200">
      <div
        v-if="store.currentProject"
        class="flex items-center justify-between px-2 py-2 rounded hover:bg-gray-100 cursor-pointer transition-colors"
        @click="emit('openProjectSettings')"
      >
        <div class="flex items-center gap-2 overflow-hidden">
          <div class="project-avatar bg-blue-100 text-blue-500 p-2 rounded">
            <i class="pi pi-briefcase text-sm"></i>
          </div>
          <div class="flex flex-col overflow-hidden">
            <span class="text-xs font-bold truncate">{{ store.currentProject.name }}</span>
            <span class="text-[10px] opacity-60 truncate">Project Settings</span>
          </div>
        </div>
        <i class="pi pi-chevron-right text-[10px] opacity-40"></i>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width, 280px);
  background-color: var(--bg-sidebar, #f9fafb);
  border-right: 1px solid var(--border-color, #f3f4f6);
  display: flex;
  flex-direction: column;
  padding: 1rem;
  flex-shrink: 0;
  height: 100vh;
}

.sidebar-top {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 2rem;
}

.section-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9ca3af;
  margin-top: 1.5rem;
}

.project-select {
  background: white !important;
  border-color: #e5e7eb !important;
  border-radius: 12px !important;
}

.new-chat-btn {
  border-radius: 12px !important;
  font-weight: 700 !important;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  margin-bottom: 2px;
  font-size: 0.9rem;
  color: #4b5563;
}

.nav-item:hover {
  background-color: #f3f4f6;
  color: #111827;
}

.nav-item.active {
  background-color: #ffffff;
  color: var(--blue-color, #3b82f6);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}

.nav-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.nav-item:hover .nav-actions {
  opacity: 1;
}

.indexing-pulse {
  background: #eff6ff;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background-color: #3b82f6;
  border-radius: 50%;
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
