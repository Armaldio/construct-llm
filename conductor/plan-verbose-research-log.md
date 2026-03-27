# Verbose Inline Steps Implementation Plan

## Objective

Enhance the message rendering in the frontend UI to display agent thinking, tool calls, arguments, and results as inline blocks interleaved with the text, instead of grouping them inside a single "Research Log" container. All blocks should appear exactly where they belong in the flow of the conversation.

## Key Files & Context

- `src/components/chat/ChatMessageItem.vue`: Contains the rendering logic for the chat messages and the `reflection` parts.

## Implementation Steps

1. **Remove "Research Log" Wrapper in `ChatMessageItem.vue`:**
   - Locate the `<!-- Legacy Reflection Part -->` block (`<div v-if="part.type === 'reflection'">`).
   - Remove the outer `<details>` and `<summary>` (the "Research Log" header) elements that group all steps together.
   - Render each `step` from `part.reflections` directly into the flow of the message as a separate block.
2. **Style Individual Steps as Inline Expandable Blocks:**
   - Each individual `research-step` should be its own independent `<details>` element, appearing sequentially in the message.
   - The `<summary>` will contain an icon (e.g., tool/cog or search) and the `step.content`.
   - The expanded content will display `step.toolName`, `step.argsText` (or stringified `step.args`), and `step.result` inside formatted `<pre>` blocks for readability.
   - Use small text (`text-xs` and `text-[10px]`) and muted background colors (`bg-gray-50`, `bg-gray-100`) to maintain a clean UI for technical logs.
   - Ensure the `pre` tags have `whitespace-pre-wrap` or `overflow-x-auto` to handle large JSON outputs gracefully without breaking the layout.

## Verification & Testing

- Send a message that triggers a tool call (e.g., "search the codebase for Mastra").
- Verify that the tool step appears inline, interleaved with the text, rather than being hidden in a "Research Log" section.
- Open the inline block.
- Verify that the expanded block correctly displays the `argsText`/`args` and `result` payloads.
