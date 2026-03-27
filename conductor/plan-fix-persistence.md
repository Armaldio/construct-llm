# Objective

Ensure that chat threads and messages are persisted immediately so that no state is lost if the application is closed during a conversation.

# Root Causes

1. **Delayed Saving**: The `sendMessage` action only calls `saveCurrentState()` in the `finally` block, meaning if the app is closed while the AI is responding, even the User's message isn't saved.
2. **Missing Save in New Thread**: When a new thread is created with an initial message, `createNewThread` calls `sendMessage` without an intermediate save, risking the loss of the entire thread entry.
3. **Deep Proxy Issues**: `toRaw(store.appState)` might not be creating a perfectly clean, deep clone for IPC, potentially leading to inconsistencies.

# Proposed Solution

1. **Incremental Persistence**: Update `sendMessage` to call `saveCurrentState()` multiple times:
   - Immediately after adding the User's message.
   - Immediately after creating the Assistant's message placeholder.
   - Immediately after the generated title is applied.
   - In the `finally` block (as it does now).
2. **Immediate Thread Save**: Update `createNewThread` to call `saveCurrentState()` _before_ calling `sendMessage`.
3. **Clean Deep Clone**: Use `JSON.parse(JSON.stringify(...))` in `saveCurrentState()` to ensure a clean, standard object is sent over the Electron IPC boundary.

# Implementation Plan

1. **Update `src/actions.ts`**:
   - Update `saveCurrentState` to use deep cloning.
   - Update `createNewThread` to save before `sendMessage`.
   - Update `sendMessage` to save after user message and placeholder creation.
   - Ensure `generateTitle` result is saved immediately.

# Verification

- Create a new chat from the welcome screen.
- Close the app immediately while the AI is "Formulating response...".
- Re-open the app. The thread and the user's initial message should still be there.
- Verify the generated title is also persisted.
