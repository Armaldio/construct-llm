# Objective

Remove all remaining regex-based parsing from the application and replace it with "Gold Standard" native LLM features: **JSON Mode**, **Native Thinking**, and **Simple String Splitting**.

# Key Files & Context

- `src/main.ts`: Agent configurations and streaming loop.
- `src/App.vue`: Message rendering and streaming logic.

# Proposed Solution

1. **Gold Standard JSON Output**:
   - For the `generator-agent`, we will ensure it uses **Native JSON Mode** (not just a schema). This ensures the output is _never_ wrapped in Markdown backticks (e.g., ` ```json ... ``` `).
   - The renderer will then use `JSON.parse` directly on the full response, or a simple `slice` if it's still streaming. No regex needed to "detect" the JSON block.

2. **Gold Standard Reasoning (Thinking)**:
   - For models that support **Native Thinking** (like `gemini-2.0-flash` or `claude-3-7-sonnet`), the AI SDK already sends a `type: "thought"` event. The renderer will listen for this event and update the reasoning block directly. No regex needed to parse JSON arguments.
   - For other models, instead of the `record_thought` tool, we will use a **Chain of Thought (CoT)** prompt that puts the reasoning in `<thought>...</thought>` tags. Since the tags are fixed, we can split the string by tags using simple `split()` and `indexOf()` without regex.

3. **Gold Standard UI Streaming**:
   - In `App.vue`, we will remove the `match` call on `existing.argsText`. Instead, we will use a simple **JSON property check** on the completed tool arguments, or a simple "Thinking..." indicator during the stream.

# Implementation Plan

1. **Update `main.ts`**:
   - In the `generate_c3_clipboard` tool, remove the `structuredOutput` in favor of a simpler prompt that says: "Output ONLY the JSON object. No Markdown blocks. No text before or after." and use `experimental_jsonMode: true` in the agent's model call.
   - This ensures the `generator-agent` output is a raw JSON string.

2. **Update `App.vue`**:
   - Remove the `match` call for thoughts. Instead, use the `thought` event (which some models send naturally).
   - Replace the Markdown code block detection (`beforeBlock.match(...)`) with a more robust segmenting logic based on whether the message is a `c3-clipboard` type (which we will flag in the backend).

# Verification

- The `generator-agent` should now produce raw JSON (no backticks).
- No regex should remain for parsing AI outputs.
- Thinking blocks should appear for supported models.
