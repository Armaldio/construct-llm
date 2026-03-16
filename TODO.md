# Construct LLM - Future Improvements & TODOs

## 3. Expand the Indexing Scope
- **Problem:** Currently only indexing `project.c3proj`, `layouts`, and `eventSheets`. The LLM lacks knowledge about object types, instance variables, and behaviors.
- **Action:** Add `objectTypes`, `families`, and `scripts` directories to the indexing loop in `syncProjectToVectorStore`.

## 4. Inject a "Project Skeleton" into the Prompt
- **Problem:** Vector search is bad at answering global structural questions like "What layouts exist?" or "What is the player object called?".
- **Action:** When a project is loaded, build a lightweight summary string (list of all Object Type names, Layout names, Global Variables) and inject it into the Agent's system instructions or query context.

## 5. Build Specialized Mastra Tools
- **Problem:** `vectorQueryTool` is fuzzy and sometimes misses precise deterministic data.
- **Action:** Create custom Mastra tools that interact directly with the local file system:
  - `list_project_files({ directory: 'layouts' })` -> Returns exact layout names.
  - `get_object_schema({ objectName: 'Player' })` -> Returns instance variables, behaviors, and plugin type from `objectTypes/Player.json`.
  - `search_events({ query: 'Player' })` -> Iterates over event sheet JSONs and returns only the blocks involving the queried object.

## 6. Reranking and Context Formatting
- **Problem:** `vectorQueryTool` dumps raw JSON text fragments into the context which can be hard for the LLM to read and wastes context window.
- **Action:** Format the tool output to be easily readable. Add a Reranker to the `vectorQueryTool` options to filter out irrelevant chunks before they reach the LLM.
