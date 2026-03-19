# Implementation Plan: Project Indexing Logic

## Objective

Implement the missing indexing logic in `syncProjectToVectorStore` to allow the LLM to perform semantic search across the user's Construct 3 project files (JSON, JS, TS).

## Changes

1.  **Define File Discovery Utility**
    - Implement a helper to recursively find all relevant files (`.json`, `.js`, `.ts`) in the project directory.

2.  **Update `syncProjectToVectorStore`**
    - Add logic to check if a file has already been indexed (optional but recommended for performance). For now, we'll focus on a full (re)index when `force=true`.
    - Iterate through the discovered files.
    - For each file:
      - Read the content.
      - Split the content into manageable chunks using `MDocument` from `@mastra/rag`.
      - Generate embeddings for each chunk using the existing `embeddingModel`.
      - Construct unique IDs and metadata (file path, type).
      - Upsert the vectors and metadata into `projectStore` under the `project_content` index.
    - Emit "indexing" and "complete" events to the renderer to update the UI.

3.  **Refactor `syncGlobalAssetsToVectorStore` (Optional/Cleanup)**
    - While not strictly required for the project indexing, ensure consistency if this is ever used.

## Verification

- Monitor the Electron main process logs for "Upserted X chunks from file Y".
- Use the "🏗️ Architect" or "General Expert" agent to ask a question that requires knowledge across multiple event sheets (e.g., "Which layouts use the 'Enemy' object?") and verify it uses the `search_project` tool effectively.
- Verify the indexing status in the UI transitions correctly.
