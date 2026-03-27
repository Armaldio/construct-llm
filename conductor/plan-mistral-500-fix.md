# Background & Motivation

The `generate_c3_clipboard` tool currently uses `structuredOutput` with a Zod schema (`C3ClipboardSchema`) to force the LLM to return valid JSON. However, the schema contains `z.record(z.any(), z.any())`, which produces a malformed or overly broad JSON Schema. Mistral's API strictly validates the JSON schema provided in the `response_format` field, and when it encounters schemas it cannot parse or support (like arbitrary records), it fails with a generic `500 Service Unavailable` error instead of a 400 Bad Request.

# Scope & Impact

This change will only affect the `generate_c3_clipboard` tool inside `src/main.ts`.

# Proposed Solution

1. **Remove `structuredOutput`**: Instead of relying on the LLM provider's structured output feature (which is fragile with complex or partially-defined schemas like Construct 3 events), we will prompt the LLM to output a raw JSON block.
2. **Manual JSON Extraction**: We will extract the JSON string from the LLM's text response using a regex (to find the ` ```json ... ``` ` block) or just parse the whole response.
3. **Remove `C3ClipboardSchema`**: We can remove the `C3ClipboardSchema` entirely, as it's incomplete anyway (it doesn't account for sub-events, comments, or other complex Construct 3 clipboard structures) and causes the API to crash.

# Implementation Steps

1. In `src/main.ts`, remove the `C3ClipboardSchema` definition.
2. In `generate_c3_clipboard`, update the prompt to explicitly ask for a valid JSON string wrapped in a code block.
3. Update the `simpleGenerator.generate` call to not use `structuredOutput` and instead return `result.text`.
4. Parse the extracted JSON string and return it.

# Verification

When tested, generating Construct 3 clipboard logic using Mistral will successfully return a valid JSON string without throwing a 500 error.
