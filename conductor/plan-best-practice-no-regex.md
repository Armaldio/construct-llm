# Objective

Remove all remaining regex-based parsing from the application and replace it with "Best Practice" LLM integration using **Structured Object Generation** and **Native Thinking**.

# Key Files & Context

- `src/main.ts`: Agent configurations and streaming loop.
- `src/App.vue`: Message rendering and streaming logic.

# Proposed Solution

1. **Best Practice JSON Output**:
   - For the `generator-agent`, we will use the **AI SDK's `generateObject` or `streamObject`** natively. This is the gold standard for getting typed JSON from an LLM. It handles all the parsing, validation, and even partial streaming validation (via `streamObject`) automatically.
   - We will remove the `C3ClipboardSchema` regex entirely.

2. **Best Practice Reasoning (Thinking)**:
   - For models that support **Native Thinking** (like `gemini-2.0-flash` or `claude-3-7-sonnet`), we will use the AI SDK's `thought` event.
   - For models that _don't_ support it natively, the "Best Practice" is to use **Chain of Thought (CoT)** where the reasoning is a separate property in the structured JSON response (e.g., `{ reasoning: "...", events: [...] }`). Since we're using `generateObject`/`streamObject`, the SDK handles extracting the `reasoning` field while streaming, so we never need regex in the UI.

3. **Best Practice UI Streaming**:
   - In `App.vue`, we will remove the `match` call on `existing.argsText`. Instead, we will use the **Typed Streams** provided by the AI SDK. The SDK handles updating the partial object as it streams, so the renderer just receives a clean, partial JS object.

# Implementation Plan

1. **Update `main.ts`**:
   - Ensure the `generate_c3_clipboard` tool continues to use `structuredOutput` with the refined `C3ClipboardSchema`.
   - Update the `chat-message` loop to use `agent.stream` with **Structured Output** for the `generator-agent` if possible, or ensure the generator's output is flagged as a structured object.

2. **Update `App.vue`**:
   - Remove the `isRecordThought` regex parsing.
   - Replace the Markdown detection with a simple check: "If the message is from the Generator Agent, it is a C3 Clipboard object." No string parsing or regex needed.

# Verification

- The `generator-agent` should produce typed JSON using the native `generateObject` feature.
- `App.vue` should no longer contain any regex for parsing AI responses.
- Thinking blocks should appear for supported models via the native `thought` event.
