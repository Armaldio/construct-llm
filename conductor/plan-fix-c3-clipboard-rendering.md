# Fix C3 Event Preview and Instruct LLM to Avoid Repeating JSON

## Objective

1.  **Strict Schema**: Update `C3ClipboardSchema` in `src/main.ts` to use `z.enum` for `eventType` to ensure compatibility with `C3EventPreview.vue`.
2.  **Instructional Change**: Update the system instructions for `construct-llm-agent` (and other agents using `generate_c3_clipboard`) to explicitly forbid repeating the JSON in their final text response.

## Key Files & Context

- `src/main.ts`: Contains the schema and agent instructions.

## Implementation Steps

1.  **Refine `C3ClipboardSchema` in `src/main.ts`**:
    - Update `eventType` to `z.enum(["block", "group", "comment"])`.
    - Ensure `conditions`, `actions`, `title`, and `text` are appropriately defined (and optional where applicable) to support all event types.
    - Add `children` to the item schema if we want to support nested events (though for the clipboard tool, we can keep it simple or use `z.array(z.any())` for the lazy part if needed, but let's try to keep it flat for now as most snippets are flat).

2.  **Update Agent Instructions in `src/main.ts`**:
    - Append a "CRITICAL" instruction to `construct-llm-agent` and any other agents using the clipboard tool: "When using the 'generate_c3_clipboard' tool, DO NOT repeat the generated JSON in your response. The UI will automatically render the clipboard data. Simply confirm the events have been generated."

3.  **Refine `generate_c3_clipboard` Prompt**:
    - Ensure the internal prompt for the `simpleGenerator` also reminds the AI to only output the JSON object.

## Verification & Testing

- Ask the agent to generate a simple "on start of layout" logic.
- Verify that the "C3 Event Clipboard" block in the UI is NOT empty (i.e., it renders the condition and action).
- Verify that the final text message from the assistant does NOT contain the raw JSON string.
