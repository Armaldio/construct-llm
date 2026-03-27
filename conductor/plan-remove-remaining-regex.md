# Objective

Remove all remaining regex-based parsing from the application, specifically the streaming "thought" extraction and the Markdown code block detection in `App.vue`.

# Key Files & Context

- `src/App.vue`: Contains the streaming logic that uses regex to extract the "thought" value from partial JSON and detects Markdown code blocks around Construct 3 JSON.

# Proposed Solution

1. **Remove Thought Extraction Regex**: Instead of regex, we will use a simple string search for the ` "thought": "` marker. If the marker is found, we take the substring after it. This is more predictable and avoids regex complexity.
2. **Remove Markdown Detection Regex**: Replace regex with `trim()`, `startsWith()`, and `endsWith()` checks for ` ```json ` and ` ``` `. This is safer and more readable for detecting code blocks.
3. **Handle Edge Cases**: Ensure that escaping (like `\"`) is still handled if we don't use regex for the value extraction.

# Implementation Plan

1. **Update `App.vue` - Thought Streaming**:
   - Replace the `match` call on `existing.argsText` with a logic that finds the index of `"thought":"`.
   - Take everything after the opening quote until the end of the string.
   - Unescape common characters manually (or using a simple utility).

2. **Update `App.vue` - Markdown Detection**:
   - Instead of regex for `codeBlockStartMatch` and `codeBlockEndMatch`, use `beforeBlock.trimEnd().endsWith('```json') || beforeBlock.trimEnd().endsWith('```')`.
   - Use `afterBlock.trimStart().startsWith('```')` for the end match.

# Verification

- Streaming "Reasoning" blocks should still show the live-updated thought text as the tool call is being generated.
- Construct 3 clipboard previews should still render correctly even if wrapped in markdown.
- No `.match()` calls should remain in `App.vue` or `main.ts` for AI-generated content.
