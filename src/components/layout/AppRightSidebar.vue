<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Tree from "primevue/tree";
import { store } from "../../store";
import { forceReindex } from "../../actions";

const emit = defineEmits(["openProjectSettings"]);
</script>

<template>
  <aside class="sidebar-right" v-if="store.currentProject && store.projectTree.length > 0">
    <div class="sidebar-section">
      <div class="section-header flex justify-between items-center mb-2">
        <h3 class="text-xs uppercase text-gray-400 font-bold m-0">Project Explorer</h3>
        <div class="flex gap-1">
          <Button
            icon="pi pi-cog"
            text
            rounded
            size="small"
            @click="emit('openProjectSettings')"
            v-tooltip="'Project Settings'"
          />
          <Button
            icon="pi pi-refresh"
            text
            rounded
            size="small"
            @click="forceReindex"
            :loading="store.isIndexing"
            v-tooltip="'Force Reindex'"
          />
        </div>
      </div>
      <Tree :value="store.projectTree" class="project-tree w-full">
        <template #default="slotProps">
          <div class="tree-node flex justify-between items-center w-full text-sm">
            <span>{{ slotProps.node.label }}</span>
          </div>
        </template>
      </Tree>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-right {
  width: 280px;
  background-color: #ffffff;
  border-left: 1px solid #dee2e6;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  overflow-y: auto;
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
</style>
