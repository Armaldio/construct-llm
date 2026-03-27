# Plan: Interleaving and C3 Loading Fix

This plan addresses two separate issues:

1.  Ensuring tool calls and thoughts are interleaved correctly with text in the chat.
2.  Adding a loading indicator for C3 snippets while they are being generated.

---

## Part 1: Fix Message Part Interleaving

### Objective

Refactor the agent stream handlers in `src/App.vue` to create a separate `ChatMessagePart` for each distinct event (text, thought, tool call). This will ensure parts are stored sequentially and can be rendered interleaved in the UI.

### Key Files

- `src/App.vue`: The main application component where agent events are handled.

### Implementation Steps

1.  **Analyze `onAgentReflection` Handler:**
    - Examine the existing logic in `src/App.vue` for the `api.onAgentReflection` listener.
    - Identify the code that currently groups all reflections (thoughts, tools) into a single `ChatMessagePart` of type `reflection`.

2.  **Refactor for Granular Part Creation:**
    - **Thoughts:** Modify the logic for `data.type === 'thought'`. Instead of finding and updating an existing thought part, always create and push a new part: `{ type: 'thought', content: data.content }`.
    - **Tool Calls (`tool-call-delta`):**
      - When the _first_ delta for a new `toolCallId` arrives, create and push a _new_ `ChatMessagePart` of type `reflection`. This part's `reflections` array will contain a single new `Reflection` object for this tool call.
      - For _subsequent_ deltas for the same `toolCallId`, locate the recently created `ChatMessagePart` (it should be the last part of type `reflection` for that `toolCallId`) and update the `argsText` of the `Reflection` object within it.
    - **Tool Results (`tool-result`):**
      - When a result arrives, find the `ChatMessagePart` corresponding to its `toolCallId`.
      - Update the `Reflection` object within that part to include the `result`.

3.  **Cleanup:**
    - Remove the old logic that creates a single, monolithic `reflectionPart`. The new logic will handle part creation dynamically.

---

## Part 2: Add C3 Snippet Loading Indicator

### Objective

Implement a loading indicator for the C3 Event Preview component that is displayed while the snippet content is being streamed from the agent.

### Key Files

- `src/store.ts`: For data structure changes.
- `src/App.vue`: For state management during streaming.
- `src/components/chat/ChatMessageItem.vue`: For UI rendering logic.

### Implementation Steps

1.  **Update Data Structure (`src/store.ts`):**
    - Add a new optional property `isStreaming?: boolean` to the `ChatMessagePart` interface.

2.  **Manage Streaming State (`src/App.vue`):**
    - In the `api.on("data")` event listener, when a _new_ `ChatMessagePart` of type `c3-clipboard` is created, initialize it with `isStreaming: true`.
    - In the `api.on("agent-stream-end")` event listener, get the last message from the active thread. Iterate through its `parts` and set `isStreaming` to `false` for any part where it was true.

3.  **Render Loading UI (`src/components/chat/ChatMessageItem.vue`):**
    - Locate the template section that renders the `c3-clipboard` part.
    - Add a `v-if="part.isStreaming"` condition. When true, display a loading indicator (e.g., a spinner icon and text like "Generating Events...").
    - The existing `C3EventPreview` component should be in the `v-else` block, rendered only when `part.isStreaming` is false.
    - **Safety:** To prevent UI crashes from incomplete data, wrap the `JSON.parse(part.content)` call in a `try-catch` block or a computed property that can handle parsing errors gracefully before passing the data to `C3EventPreview`.

## Verification

- **Interleaving:** Run a query that requires multiple tool calls and text responses. Verify that the tool call blocks appear interleaved with the text blocks in the final message.
- **Loading State:** Run a query that generates a C3 snippet. Verify that a loading indicator appears instantly in the place of the snippet and is replaced by the actual snippet preview once generation is complete.
