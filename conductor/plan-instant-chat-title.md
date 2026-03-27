# Objective

Implement an "Instant Start" chat experience where the user can send their first message directly from the "Welcome" screen. The application will then automatically generate a concise thread title based on the context of the conversation.

# Architecture Changes

## 1. Backend (`src/main.ts`)

- Add an IPC handler `generate-title` that uses `generateText` from the AI SDK to create a 3-5 word summary of the first interaction.
- Import `generateText` from `ai`.

## 2. Shared Actions (`src/actions.ts`)

- Update `sendMessage` to optionally trigger a "Title Generation" callback if it's the first message in a thread.
- Implement `createNewThread` to handle an optional initial message.
- Add a `generateThreadTitle` helper.

## 3. UI Components

- **`ChatEmptyState.vue`**:
  - Integrate `ChatInput.vue` (or a specialized version) directly into the center of the welcome screen.
  - Remove the redundant "New Chat" button.
- **`ChatInput.vue`**:
  - Modify to support a "Stand-alone" mode where it doesn't require an `activeThread` to be present (it will create one on submit).

# Implementation Steps

1.  **Update `main.ts`**:
    - Add `import { generateText } from "ai";`.
    - Add `ipcMain.handle("generate-title", ...)` logic.
2.  **Update `actions.ts`**:
    - Modify `sendMessage` to detect if it's the first assistant response.
    - If it is, call `electronAPI.generateTitle` and update `activeThread.name`.
3.  **Update `ChatInput.vue`**:
    - Add a `standalone` prop.
    - If `standalone`, `onSend` calls `createNewThread` with the initial message.
4.  **Update `ChatEmptyState.vue`**:
    - Render `ChatInput` with `standalone` prop.

# Verification

- Open a project with no chats.
- Type a message in the center input and press Enter.
- A new thread should be created, the message sent, and after the AI responds, the sidebar title should change from "New Chat" to a relevant summary (e.g., "Player Movement Logic").
