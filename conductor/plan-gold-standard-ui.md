# Objective

Perform a high-end UI/UX overhaul of Construct LLM, drawing direct inspiration from industry-leading chat interfaces like ChatGPT, Gemini, and Claude. This involves a clean, minimalist sidebar, a focus on the conversation, and dedicated, logically separated settings views for global configuration and project-specific overrides.

# Gold Standard Design Principles

- **Clean Sidebar**: Focus on the chat history and project selection with a minimalist footprint.
- **Dedicated Modals**:
  - **Global Settings**: Purely for API keys, theme, and user-level defaults.
  - **Project Settings**: Purely for the active project's behavior (system prompt, indexing).
- **Professional Chat UI**: Better typography, message-width constraints, and subtle but informative states (thinking, tool calling).

# Implementation Plan

## 1. Sidebar Redesign (The "Claude" Approach)

- **Top Section**: "New Chat" button with a sleek icon and a "Project" dropdown to quickly switch context.
- **Chat History**:
  - Grouped by "Today", "Previous 7 Days", etc.
  - Simple, text-only items that highlight on hover, with a "..." menu for rename/delete.
- **Bottom Section**: User profile/settings trigger and the current project's indexing status.

## 2. Dedicated settings Views

### Global Settings (`showSettingsDialog`)

- **Category 1: Models**: Manage API keys with clear status badges (Connected/Not Connected).
- **Category 2: Defaults**: Select the default model (Mistral, OpenAI, etc.).
- **Category 3: System**: General app settings.

### Project Settings (`showProjectSettingsDialog`)

- **Active Context**: Display the loaded project's path.
- **System Prompt**: A dedicated textarea to customize how the agent behaves for _this_ project.
- **Index Management**: Large "Re-index Project" button with a detailed progress indicator.

## 3. Chat UX Improvements (The "Gemini" Approach)

- **Message Bubbles**: Transparent background with a subtle border for Assistant, light surface color for User.
- **Thinking Process**:
  - A retractable "Reasoning" or "Thinking" section that uses the native `thought` event.
  - While thinking, a subtle animated skeleton or pulsing dot.
- **Generator Integration**:
  - "C3 Clipboard" objects are rendered as a clean, standalone card in the chat flow, with a clear "Copy to Clipboard" action.
  - No Markdown backticks or raw JSON shown by default.

## 4. Layout & CSS Polish

- **Fixed Header**: Sticky chat header with the thread name.
- **Max-Width Message Content**: Constraint the message width to ~800px for optimal readability.
- **Typography**: Switch to a more modern, sans-serif stack (Inter or similar).
- **PrimeVue Integration**: Leverage `Drawer`, `Menu`, and `Dialog` components correctly with a consistent theme.

# Implementation Steps

1.  **CSS Cleanup**: Define a new set of utility classes for layout (e.g., `.chat-bubble`, `.sidebar-item`).
2.  **Sidebar Refactor**: Implement the new project switcher and the grouped chat list.
3.  **Settings Refactor**: Create two distinct dialogs with a clear visual hierarchy.
4.  **Chat UI Update**: Update the `v-for` loop to use the new message components and thinking block.
5.  **Refactor Dialogs**: Ensure "Global Settings" and "Project Settings" are separate modals as requested.

# Verification

- **Aesthetic Check**: Does it feel like a modern AI application?
- **Usability Check**: Is it easier to switch projects and manage settings?
- **Performance Check**: Are the transitions smooth and non-blocking?
