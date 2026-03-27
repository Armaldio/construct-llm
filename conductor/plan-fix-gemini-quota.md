# Objective

Resolve the "Quota Exceeded / Limit: 0" errors reported by the Gemini API while using a valid API key. This involves optimizing token usage, improving diagnostics, and adding helpful user feedback for rate-limited states.

# Potential Root Causes

1. **TPM (Tokens Per Minute) Exhaustion**: Large project snippets returned by tools like `search_project` or `search_snippets` are consuming the free tier's token quota (e.g., sending multiple large files in one prompt).
2. **RPM (Requests Per Minute) Exhaustion**: Concurrent calls for `ask-question` and `generate-title` might trigger Google's strict 429 filters.
3. **Region/Model Restrictions**: The "limit: 0" error often indicates a model is unavailable in the user's region or for their specific account type on the free tier.
4. **Key Format Issues**: Whitespace or invisible characters in the API key (addressed previously but ensuring robustness).

# Proposed Solution

## 1. Optimize Context Usage (TPM Reduction)

- **Reduce Search Results**: Lower `topK` from 5 to 3 in `search_project` and `search_snippets` to keep prompt size manageable.
- **Truncate Snippets**: Limit the size of each snippet returned by tools to ~2000 characters to prevent accidental multi-million token prompts.

## 2. Improve Diagnostics

- **Detailed Key Logging**: Log the model ID and the provider clearly before every AI call.
- **Identify Tier**: Attempt to detect if the error is "FreeTier" specifically and suggest billing setup to the user in the error message.

## 3. Robust Error Handling

- **Informative UI Errors**: Capture the `429` error in the backend and return a user-friendly message: "Gemini Rate Limit reached. If you are on the Free Tier, wait a minute or enable billing in Google AI Studio."
- **Sequential Calls**: Ensure title generation doesn't overlap with heavy streaming if possible.

# Implementation Plan

1. **Update `src/main.ts`**:
   - Update `getDynamicModel` to include better error messages if the key is missing.
   - Update `search_project`, `search_manual`, and `search_snippets` to return fewer results and truncate long text.
   - In the `ask-question` handler, catch `429` errors and translate them into actionable advice for the user.
2. **Update `src/actions.ts`**:
   - Add a small delay (e.g., 500ms) before calling `generateTitle` to avoid simultaneous hits to the API.

# Verification

- Use Gemini 2.0 Flash with a free tier key.
- Send a question that triggers a project search.
- The assistant should respond without hitting the "limit: 0" error, or provide a clear "Wait a minute" message instead of a crash log.
