# Objective

The recent refactor broke the CSS styling, making the UI look "really really bad" according to the user. This is primarily because when components were split out (`AppSidebar`, `ChatContainer`, `ChatMessageItem`, etc.), their local styles were left behind in the monolithic `App.vue` or stripped of `scoped` attributes improperly.

# Key Problems Identified

1. **Missing Global Layout Styles**: The `body` and `#app` tags need explicit height/flex properties to ensure the sidebar and main view sit side-by-side correctly.
2. **Missing Component-Specific Styles**: The `.message-bubble`, `.sidebar-nav`, `.chat-main`, and Markdown styling classes are either missing, improperly scoped, or lost during the file split.

# Proposed Solution

1. **Global CSS (`src/index.css` or `src/App.vue` non-scoped)**: Establish the core variables (`--sidebar-width`, colors), reset `body`/`html`/`#app` to 100vh flex containers, and define global PrimeVue overrides.
2. **Component Scoped CSS**:
   - **`AppSidebar.vue`**: Add back `.sidebar`, `.nav-item`, `.project-select`, and `.indexing-pulse` styles.
   - **`ChatContainer.vue`**: Add back `.chat-main`, `.chat-header`, and `.chat-messages` flex-layout styles.
   - **`ChatMessageItem.vue`**: Add back `.message-row`, `.message-bubble`, `.avatar`, `.thought-block`, and Markdown (`.markdown-body`) overrides.
   - **`ChatInput.vue`**: Add back `.chat-input-container`, `.input-wrapper`, and `.send-btn-new` styles.

# Implementation Plan

1. **Update `App.vue` Styles**: Keep only the overarching layout container and startup overlay styles here. Make them non-scoped so child components inherit layout variables if needed.
2. **Inject CSS into `AppSidebar.vue`**: Append the `<style scoped>` block containing all sidebar-related CSS.
3. **Inject CSS into `ChatContainer.vue`**: Append the `<style scoped>` block containing the main flex view and header CSS.
4. **Inject CSS into `ChatMessageItem.vue`**: Append the `<style scoped>` block containing message bubbles, thinking blocks, avatars, and markdown rendering CSS.
5. **Inject CSS into `ChatInput.vue`**: Append the `<style scoped>` block for the input bar and buttons.

# Verification

- The UI should return to the intended "Gold Standard" side-by-side flex layout with proper padding, borders, and modern styling.
