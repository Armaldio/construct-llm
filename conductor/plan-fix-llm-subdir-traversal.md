# Plan: Fix LLM Tools Subdirectory Traversal

## Objective

Fix an issue where the Construct 3 LLM tools are unable to find project files (like object schemas or event sheets) if they are placed inside subdirectories. Currently, tools like `list_project_files`, `get_object_schema`, and `search_events` use a non-recursive `fs.readdir`, causing them to miss files such as `examples/demonoire/objectTypes/Player/Player_Base.json`.

## Key Files & Context

- `src/main.ts` - Contains the definitions of the LLM tools. We will also reuse the `getAllFiles` helper function which is already implemented here.

## Implementation Steps

1.  **Refactor `list_project_files` in `src/main.ts`**
    - Replace the non-recursive `fs.readdir` with a call to the existing `getAllFiles` helper.
    - Map the absolute paths returned by `getAllFiles` to relative paths (relative to `dirPath` or `currentProjectPath`) before returning them as JSON.

2.  **Refactor `get_object_schema` in `src/main.ts`**
    - Currently, it hardcodes the path to `path.join(currentProjectPath, "objectTypes", objectName + ".json")`.
    - Change it to scan the `objectTypes` directory recursively using `getAllFiles`.
    - Search the resulting list for a file whose basename matches `${objectName}.json` (case-insensitively).
    - Read and return the content of the found file.

3.  **Refactor `search_events` in `src/main.ts`**
    - Replace the non-recursive `fs.readdir` with `getAllFiles`.
    - Loop through the returned absolute paths, filter for `.json` files, and perform the text search.
    - Return a list of relative paths for files that match the search query.

## Verification & Testing

- Load the `demonoire` example project.
- Ask the agent about `player_base` (or `Player_Base`).
- Verify that the agent can successfully find, read, and describe the object schema even though it's inside the `Player` subfolder.
