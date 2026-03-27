# Objective

Remove all remaining regex-based parsing by leveraging native LLM features: **JSON Mode** for the `generator-agent` and **Native Thinking** (where supported) or a better extraction method for reasoning thoughts.

# Key Files & Context

- `src/main.ts`: The `generator-agent` and the `chat-message` streaming loop.
- `src/App.vue`: The message parsing and thought-streaming logic.

# Proposed Solution

1. **Enable JSON Mode for the Generator Agent**:
   - Update `get_chat_agent` or the `generator` instantiation in `main.ts` to use `experimental_jsonMode: true` (or the equivalent in Mastra/AI SDK).
   - This ensures the LLM's entire output is a valid JSON string without Markdown backticks, making the regex in `App.vue` unnecessary for this agent.
   - We can then use `JSON.parse` directly on the full response or a simple substring slice for partials.

2. **Native Thought Handling**:
   - For models that support a native thinking block (like `gemini-2.0-flash`), the AI SDK already provides a `thought` chunk. We will ensure the `chat-delta` event for `thought` is correctly handled in `App.vue` without regex.
   - For other models, we will continue using the `record_thought` tool but change how its progress is reported. Instead of the renderer parsing the `argsTextDelta` JSON with regex, we can use a **Simple JSON Buffer** in the renderer to keep track of the `thought` value as it arrives, or just show the raw reasoning until it's complete.

3. **Simplify `App.vue` Parsing**:
   - Instead of complex regex for "C3 Clipboard" detection, we will use a more robust "Split by Content-Type" approach.
   - Since we already have a `type: "c3-clipboard"` in the chat message segments, we can ensure the backend _always_ flags the generator's output with this type.

# Implementation Plan

1. **Update `main.ts`**:
   - In the `generator` agent's `generate` call (inside `generate_c3_clipboard`), we already use `structuredOutput`, which _is_ the native way to request JSON only. So the `regex` I added (and removed) was already unnecessary. The current `generate_c3_clipboard` is correct.
   - In the `chat-message` loop, for the `generator-agent`, we will ensure that the text chunks are sent with a flag indicating they are part of a C3 Clipboard JSON.

2. **Update `App.vue`**:
   - Remove the `isRecordThought` regex parsing. Instead, we can use the `thought` event (which some models send naturally) or a simple JSON property lookup if the tool call is finished.
   - For the Markdown detection in `App.vue`, we will replace it with simple `includes` and `slice` logic for code blocks.

# Verification

- The `generator-agent` should continue producing valid Construct 3 JSON using the native `structuredOutput` feature.
- `App.vue` should no longer contain any AI-parsing regex.
- Thinking blocks should still appear for supported models.
