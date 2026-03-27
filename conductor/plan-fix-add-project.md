# Fix Project Management Actions and Add Project UI

## Objective

Fix the IPC return type mismatch between `src/actions.ts` and `src/main.ts` that prevents users from adding, deleting, or reindexing projects. Also, improve the UI so users can easily add a project even when the project list is empty.

## Background & Motivation

The user reported that clicking "Open New Project" does nothing. Investigation revealed that the `select-project`, `delete-project`, and `force-reindex` IPC handlers in `src/main.ts` return raw values (e.g., the `Project` object or a `boolean`), but `src/actions.ts` expects an object with `{ success: boolean, project?: Project, error?: string }`. Because of this mismatch, the actions silently fail.
Additionally, the "Open New Project" button in the sidebar is hidden inside the `Select` component's `#footer`, making it hard to access when the project list is empty.

## Key Files & Context

- `src/actions.ts`: Handles UI actions and IPC calls.
- `src/components/layout/AppSidebar.vue`: Contains the project `Select` dropdown.
- `src/components/chat/ChatEmptyState.vue`: Displayed when no project is loaded.

## Implementation Steps

1. **Fix IPC return handlers in `src/actions.ts`**:
   - `loadProject()`: Update to check if `result` is truthy (since it's a `Project` object directly). Replace `result.success && result.project` with `if (result)` and use `result.id` and `result.threads` directly instead of `result.project.id`.
   - `deleteProject(id: string)`: Update to check `if (res)` instead of `if (res.success)`, as it returns a boolean.
   - `forceReindex()`: Update to check `if (!res)` instead of `if (!res.success)`, as it returns a boolean.

2. **Improve UI in `src/components/layout/AppSidebar.vue`**:
   - Change the "Active Project" section label to a flex row and add a small `+` button (`icon="pi pi-plus"`) next to the text. This allows adding projects without opening the dropdown.
   - Add an `#empty` slot to the `Select` component with a "No projects found" message and an "Open New Project" button.

3. **Improve UI in `src/components/chat/ChatEmptyState.vue`**:
   - Import `loadProject` and `Button`.
   - In the empty state (`v-else`), add a large "Open New Project" button below the text, providing a clear call-to-action.

## Verification & Testing

- Click "Open New Project" from the sidebar and verify the file dialog opens.
- Select a folder and verify the project loads and becomes active.
- Delete a project and verify it is removed from the state.
- Empty the project list and verify the UI displays the prominent "Open New Project" button in the empty state and the sidebar.
