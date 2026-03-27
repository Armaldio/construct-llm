# Fix C3 Event Rendering and Duplicate JSON

## Objective

1.  **UI Resilience**: Update `C3EventPreview.vue` to show a fallback message if data is missing and ensure it handles the recursive structure correctly.
2.  **Tool Output Wrapping**: Modify `generate_c3_clipboard` in `src/main.ts` to return an object that contains the data for the UI but also a clear "Stop" message for the LLM to prevent it from repeating the JSON.
3.  **Prompt Strengthening**: Update system instructions and tool descriptions to be even more aggressive about not repeating JSON.
4.  **UI Debugging**: Add a pre-check in `ChatMessageItem.vue` or `C3EventPreview.vue` to verify the JSON structure before rendering.

## Key Files & Context

- `src/main.ts`: Tool implementation and agent instructions.
- `src/C3EventPreview.vue`: Rendering logic.
- `src/components/chat/ChatMessageItem.vue`: Chat part management.

## Implementation Steps

1.  **Update `src/main.ts`**:
    - Modify `generate_c3_clipboard` tool's return value to include a `notice` field for the LLM.
    - Update `generate_c3_clipboard` description: "Generates Construct 3 events. The results are automatically displayed in a dedicated UI block. DO NOT repeat the JSON in your final answer."
    - Update `construct-llm-agent` instructions to be even more explicit.

2.  **Update `src/C3EventPreview.vue`**:
    - Add debug fallback if `items` is empty.
    - Ensure `formatId` and `formatParams` are robust against missing data.
    - Check if `props.data` is nested under `items`.

3.  **Update `src/App.vue`**:
    - Ensure the `tool-result` handler correctly identifies the data even if it has extra fields like `notice`.

## Verification & Testing

- Trigger event generation.
- Check if the UI block shows "No events" or actual events.
- Check if the assistant message is clean of JSON.
