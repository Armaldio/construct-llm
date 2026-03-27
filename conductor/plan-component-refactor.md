# Objective

Refactor the monolithic `App.vue` (currently > 2000 lines) into a clean, maintainable, component-based architecture using Vue 3 Composition API (`<script setup>`). This will significantly improve code readability, reusability, and development velocity while maintaining the recent UX improvements.

# Architecture Plan

We will split `App.vue` into logical, domain-specific components organized in a `src/components/` directory.

## 1. Directory Structure

```
src/
  components/
    layout/
      AppSidebar.vue        # Left navigation, project switcher, chat history
      AppRightSidebar.vue   # Project explorer tree
    chat/
      ChatContainer.vue     # Main chat view wrapper
      ChatMessageList.vue   # The scrolling list of messages
      ChatMessageItem.vue   # Individual message bubble (handles User vs Assistant)
      ChatInput.vue         # The input area with the model selector
      ChatEmptyState.vue    # The "Welcome" or "Open Project" screen
      ResearchLog.vue       # The legacy "reflection" accordion
    settings/
      GlobalSettings.vue    # Modal for API keys
      ProjectSettings.vue   # Modal for active project context/prompts
      NewChatDialog.vue     # Modal for creating a new thread
```

## 2. State Management (The "Glue")

Currently, all state is reactive variables in `App.vue`. To make components work seamlessly without massive prop-drilling, we will either:
A. Extract the state into a simple composable (e.g., `src/composables/useAppStore.ts` or similar).
B. Keep state in `App.vue` and `provide`/`inject` it to children.
_Decision:_ Since `pinia` is already in `package.json`, we will create a lightweight Pinia store OR a simple shared reactive state file (`src/store.ts`) to manage `appState`, `currentProject`, `activeThread`, etc. _Given constraints, a simple exported reactive object in a `.ts` file is fastest and cleanest for this refactor._

## 3. Component Details & Responsibilities

### Layout Components

- **`AppSidebar.vue`**: Needs access to `projects`, `currentProject`, `groupedThreads`, `isIndexing`. Emits events or calls store methods for `onProjectChange`, `createNewThread`, `deleteProject`, `deleteThread`.
- **`AppRightSidebar.vue`**: Needs `projectTree`, `currentProject`.

### Chat Components

- **`ChatContainer.vue`**: Manages the sticky header, includes `ChatMessageList` and `ChatInput`.
- **`ChatMessageList.vue`**: Loops over `activeThread.messages`, renders `ChatMessageItem`.
- **`ChatMessageItem.vue`**: Highly complex. Needs to handle `text`, `thought`, `c3-clipboard`, and `reflection` parts. It will internally import `C3EventPreview` and `ResearchLog`.
- **`ChatInput.vue`**: Manages `newMessage`, `isStreaming`, handles mentions (`@` / `#`), and the "Send" action.

### Settings Components

- **`GlobalSettings.vue`**: Receives `localApiKeys` and `showSettingsDialog` (via v-model).
- **`ProjectSettings.vue`**: Manages `projectSettings` form and the "Re-index" button.

# Implementation Steps

1. **Create State Store (`src/store.ts`)**:
   - Move `appState`, `currentProject`, `activeThread`, `isIndexing`, `isStreaming`, etc., into an exported reactive store.
   - Move core actions (`loadProject`, `sendMessage`, `forceReindex`) into this file or keep them in `App.vue` and pass them to the store.

2. **Create Components (Iterative Refactor)**:
   - Create `src/components/layout/AppSidebar.vue`. Extract sidebar HTML and CSS.
   - Create `src/components/chat/ChatMessageItem.vue`. Extract the complex message loop body.
   - Create `src/components/chat/ChatInput.vue`.
   - Create the Dialog components (`GlobalSettings`, `ProjectSettings`, `NewChatDialog`).

3. **Wire up `App.vue`**:
   - Import the new components.
   - `App.vue` becomes a shell:
     ```vue
     <template>
       <div class="app-container">
         <AppSidebar />
         <ChatContainer v-if="activeThread" />
         <ChatEmptyState v-else />
         <AppRightSidebar v-if="showRightSidebar" />
         <!-- Modals -->
         <GlobalSettings v-model:visible="showSettings" />
         <ProjectSettings v-model:visible="showProjectSettings" />
         <NewChatDialog v-model:visible="showNewChat" />
       </div>
     </template>
     ```

# Verification

- The application should look identical to the "Gold Standard" design but the codebase will be split across multiple files.
- IPC communication must remain intact (ensure `main.ts` still talks to the correct renderer functions).
