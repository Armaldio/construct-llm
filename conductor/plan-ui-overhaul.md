# Objective

Perform a complete UI/UX overhaul of the Construct LLM desktop application to improve professionalism, usability, and visual hierarchy. This includes a redesign of the sidebar, settings dialogs, and general chat layout using PrimeVue components and modern CSS.

# Key Areas of Improvement

1. **Sidebar Overhaul**: Move from basic listboxes to a structured, hierarchical navigation system.
2. **Unified Settings**: Consolidate global and project settings into a clean, tabbed dialog.
3. **Chat Experience**: Improve message bubbles, reasoning (thought) display, and the "Generator" preview integration.
4. **Project Management**: Better visual feedback for active projects and indexing status.

# Proposed Solution

## 1. Sidebar Redesign

- **Top Section**: App logo/name with a "New Chat" primary action button.
- **Project Switcher**: Use a dropdown or a dedicated section at the bottom for switching between loaded projects.
- **Active Project Context**:
  - **Indexing Status**: Integrated progress bar or subtle pulse indicator.
  - **Navigation**: Tabs or a tree-like structure for "Chats", "Project Tree", and "Project Info".
- **Chat History**: Grouped by date (Today, Yesterday, etc.) with editable names and delete actions.

## 2. Settings Overhaul

- **Consolidated Dialog**: A single "Settings" modal with categories:
  - **Models**: API key management (Mistral, OpenAI, Anthropic, Google).
  - **Active Project**: Custom prompt, re-indexing, and project-specific overrides.
  - **Appearance**: Theme selection (if supported) and UI density.
- **Validation**: Visual feedback for missing API keys.

## 3. General UX Improvements

- **Tooltips**: Add descriptive tooltips to all icon-only buttons.
- **Loading States**: Replace full-screen overlays with scoped progress indicators where possible.
- **Empty States**: Friendly placeholders when no project is loaded or no chat is active.
- **Transitions**: Add subtle CSS transitions for sidebar collapse and dialog entry.

# Implementation Plan

## Phase 1: CSS Refactoring & Layout

1.  **Define CSS Variables**: Centralize colors (Primary, Surface, Text) to match PrimeVue's theme.
2.  **Update `app-container`**: Ensure proper flex-box usage for a fixed sidebar and fluid chat area.
3.  **Modernize Message Bubbles**: Use better padding, border-radius, and distinct colors for User vs. Assistant.

## Phase 2: Sidebar Implementation

1.  **Replace `Listbox`**: Use a custom `v-for` loop with styled "nav-item" components for better control over icons and actions.
2.  **Implement "Project Selector"**: Add a dedicated dropdown at the top of the sidebar to switch between active projects.
3.  **Refactor Chat List**: Add date-grouping logic to the chat thread list.

## Phase 3: Unified Settings Dialog

1.  **Create `SettingsDialog`**: A new component or a large PrimeVue `Dialog` with a `Tabs` component.
2.  **Tab 1: API Keys**: Group fields by provider with clear status indicators.
3.  **Tab 2: Project Management**: Move "Project Settings" and "Re-index" actions here.
4.  **Tab 3: LLM Settings**: Global default model selection.

## Phase 4: Chat & Preview Polish

1.  **Improve Research Log**: Use a more compact, retractable "thought" block.
2.  **C3 Preview integration**: Ensure the `c3-clipboard` parts are seamlessly integrated into the message flow.

# Verification & Testing

- **Responsiveness**: Ensure the sidebar remains usable at different window widths.
- **Consistency**: All buttons and inputs should follow the PrimeVue theme.
- **Performance**: Transitions should be smooth (60fps).
- **Functionality**: Verify that deleting projects/threads and saving settings still works correctly.
