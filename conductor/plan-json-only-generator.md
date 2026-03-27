# Objective

Ensure the `generator-agent` outputs _only_ a valid JSON object without any Markdown wrapping or additional text. Simplify the renderer by removing the complex parsing logic for this agent's messages.

# Key Files & Context

- `src/main.ts`: The `generate_c3_clipboard` tool and the `chat-message` IPC handler.
- `src/App.vue`: The message rendering and `parseMessageContent` logic.

# Proposed Solution

1. **Force JSON-Only Output**: Update the `generator-agent` and its tool to use **Native JSON Mode** (`experimental_jsonMode: true`). This ensures the model output is a raw JSON string, never wrapped in Markdown (no ` ```json `).
2. **Flag Message Type**: In the `chat-message` handler, if the message originates from the `generator-agent` (or the specific `generate_c3_clipboard` tool call), we will explicitly flag the resulting message in the app state with a `metadata: { type: "c3-clipboard" }` property.
3. **Simplify Renderer**: In `App.vue`, if a message has the `c3-clipboard` metadata, the renderer will skip all parsing and treat the entire content as the JSON payload. The complex `parseMessageContent` logic (which used brace counting) will be removed or bypassed for these messages.

# Implementation Plan

1. **Update `main.ts`**:
   - In `getDynamicModel`, ensure we can pass options like `jsonMode`.
   - In `generate_c3_clipboard`, use `experimental_jsonMode: true` and update the prompt to be even stricter.
   - In the `ipcMain.on("chat-message", ...)` loop, detect when the `generator-agent` is active. When it finishes, ensure the message is saved with a specific type.

2. **Update `App.vue`**:
   - Update the message interface to include `metadata?: { type: string }`.
   - In the message display loop, if `msg.metadata?.type === 'c3-clipboard'`, render the `C3EventPreview` component directly using the raw content.
   - Remove the `parseMessageContent` function entirely if it's no longer needed for general text (or simplify it if other agents still output mixed content).

# Verification

- The `generator-agent` should produce raw JSON strings in the logs.
- The UI should display the clipboard preview immediately without any "parsing" step.
- No Markdown backticks should appear in the generated clipboard data.
