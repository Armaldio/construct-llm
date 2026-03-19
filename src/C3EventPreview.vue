<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  data: any;
}>();

// Helper to turn technical IDs into readable C3 names
const formatId = (id: string) => {
  if (!id) return "";
  // Specific overrides for common C3 actions
  const overrides: Record<string, string> = {
    "on-start-of-layout": "On start of layout",
    "compare-instance-variable": "Compare instance variable",
    "set-instvar-value": "Set value",
    "add-to-instvar-value": "Add to",
    "set-boolean-instvar": "Set boolean",
    "simulate-control": "Simulate control",
    "on-collision-with-another-object": "On collision with",
    "is-overlapping-another-object": "Is overlapping",
    "wait-for-previous-actions": "Wait for previous actions to complete",
    "trigger-once-while-true": "Trigger once while true",
    "pick-by-unique-id": "Pick by UID",
    "set-group-active": "Set group active",
  };

  if (overrides[id]) return overrides[id];

  // Fallback: kebab-case to Title case
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatParams = (params: any) => {
  if (!params) return "";
  const entries = Object.entries(params);
  if (entries.length === 0) return "";

  return (
    "(" +
    entries
      .map(([key, value]) => {
        return `${JSON.stringify(value)}`;
      })
      .join(", ") +
    ")"
  );
};

const items = computed(() => {
  if (props.data && props.data.items) return props.data.items;
  if (Array.isArray(props.data)) return props.data;
  return [];
});
</script>

<template>
  <div class="c3-event-sheet">
    <template v-for="(item, index) in items" :key="index">
      <!-- Event Block -->
      <div v-if="item.eventType === 'block'" class="c3-block">
        <div class="c3-event-row">
          <!-- Conditions Column -->
          <div class="c3-conditions">
            <div v-for="(cond, cIdx) in item.conditions" :key="cIdx" class="c3-condition">
              <span class="c3-object">{{ cond.objectClass }}</span>
              <span class="c3-id">{{ formatId(cond.id) }}</span>
              <span class="c3-params">{{ formatParams(cond.parameters) }}</span>
            </div>
          </div>

          <!-- Actions Column -->
          <div class="c3-actions">
            <div v-for="(act, aIdx) in item.actions" :key="aIdx" class="c3-action">
              <span class="c3-object">{{ act.objectClass }}</span>
              <span class="c3-id">{{
                act.callFunction ? `Call ${act.callFunction}` : formatId(act.id)
              }}</span>
              <span class="c3-params">{{ formatParams(act.parameters) }}</span>
            </div>
            <div v-if="!item.actions || item.actions.length === 0" class="c3-no-actions">
              &nbsp;
            </div>
          </div>
        </div>

        <!-- Nested Children -->
        <div v-if="item.children && item.children.length > 0" class="c3-sub-events">
          <C3EventPreview :data="item.children" />
        </div>
      </div>

      <!-- Group -->
      <div v-else-if="item.eventType === 'group'" class="c3-group">
        <div class="c3-group-header">
          <i class="pi pi-folder-open mr-2"></i>
          <span>Group: {{ item.title }}</span>
        </div>
        <div class="c3-group-content">
          <C3EventPreview :data="item.children" />
        </div>
      </div>

      <!-- Comment -->
      <div v-else-if="item.eventType === 'comment'" class="c3-comment">// {{ item.text }}</div>
    </template>
  </div>
</template>

<style scoped>
.c3-event-sheet {
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  font-size: 12px;
  background: white;
  color: #333;
}

.c3-block {
  border: 1px solid #d1d5db;
  margin-bottom: -1px; /* Collapse borders */
  display: flex;
  flex-direction: column;
}

.c3-event-row {
  display: flex;
  min-height: 24px;
}

.c3-conditions {
  flex: 0 0 40%;
  padding: 4px 8px;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.c3-actions {
  flex: 1;
  padding: 4px 8px;
  background: white;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.c3-condition,
.c3-action {
  margin: 2px 0;
  line-height: 1.4;
}

.c3-object {
  font-weight: bold;
  color: #2563eb;
  margin-right: 4px;
}

.c3-actions .c3-object {
  color: #059669;
}

.c3-id {
  margin-right: 4px;
}

.c3-params {
  color: #6b7280;
  font-style: italic;
}

.c3-sub-events {
  border-left: 16px solid #f3f4f6;
}

.c3-group {
  margin: 8px 0;
  border: 1px solid #94a3b8;
}

.c3-group-header {
  background: #e2e8f0;
  padding: 4px 8px;
  font-weight: bold;
  border-bottom: 1px solid #94a3b8;
}

.c3-group-content {
  padding-left: 8px;
}

.c3-comment {
  padding: 4px 8px;
  color: #0891b2;
  font-style: italic;
  background: #f0fdfa;
  border: 1px solid #ccfbf1;
  margin-top: 4px;
}

.c3-no-actions {
  height: 16px;
}
</style>
