# Objective

Fix the "Failed to resolve directive: tooltip" warning that occurs when running the Vue application.

# Key Context

The application uses PrimeVue components and specifically uses the `v-tooltip` directive in several components (e.g., `AppSidebar.vue`, `ChatMessageItem.vue`). However, the `v-tooltip` directive is not globally registered in the Vue app instance (`src/renderer.ts`).

# Proposed Solution

1. Import the `Tooltip` directive from PrimeVue (`import Tooltip from 'primevue/tooltip'`).
2. Register it globally on the Vue app instance before mounting (`app.directive('tooltip', Tooltip)`).

# Implementation Plan

1. Open `src/renderer.ts`.
2. Add the import statement for `Tooltip`.
3. Add `app.directive('tooltip', Tooltip);` right after `app.use(PrimeVue, ...)`.

# Verification

When the app is reloaded, hovering over buttons with tooltips (like "Global Settings" in the sidebar) should correctly display the tooltip without throwing console warnings.
