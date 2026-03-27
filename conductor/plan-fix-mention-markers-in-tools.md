# Plan: Strip Mention Markers from LLM Tool Queries

## Objective

Fix an issue where LLM tools (`search_project`, `search_events`, `get_object_schema`) are sometimes called with UI mention markers (`#` or `@`) included in the query strings. These markers are intended for the user interface and completions but break the tool's search logic (e.g., searching for `#Player_Base` instead of `Player_Base`).

## Key Files

- `src/main.ts` - Tool definitions and agent creation.

## Implementation Steps

1.  **Modify `search_project`**
    - Strip `@` and `#` from the beginning of the `queryText` before passing it to the embedding model.

2.  **Modify `search_events`**
    - Strip `@` and `#` from the beginning of the `query` before performing the `includes()` check.

3.  **Modify `get_object_schema`**
    - Strip `@` and `#` from the beginning of the `objectName` before searching for the file.

4.  **Update Agent Instructions**
    - Add a global instruction to the `createDynamicAgent` factory reminding the agent to never use `@` or `#` markers when calling tools.

## Verification

- Test with the agent by asking "Tell me about #Player_Base" and ensuring it successfully finds the object.
- Verify that `search_events` works even if the agent prefixes the search term with `#`.
