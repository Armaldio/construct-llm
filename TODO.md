# Construct LLM - Future Improvements & TODOs

## 1. Mastra Workflows (The Refactor Engine)

- **Problem:** Complex operations like "Refactor movement logic" are too complex for a single agent prompt.
- **Action:** Implement Mastra Workflows to string together multiple steps (Analysis -> Extraction -> Rewrite -> Validation) for stable, automated refactoring.

## 2. Mastra Evaluations (The Quality Gate)

- **Problem:** LLMs can occasionally hallucinate invalid JSON structures.
- **Action:** Implement `Construct3SyntaxEvaluator` using Mastra Evals to programmatically test generated JSON against "Gold Standard" snippets before showing it to the user.

## 3. GraphRAG (Relational Context)

- **Problem:** Vector search is bad at following the "Chain of Dependency" (e.g., finding all events that use an object through Includes).
- **Action:** Implement a `graphQueryTool` to map the explicit relationships between Event Sheets, Layouts, and Object Types for more accurate impact analysis.

## 4. "Apply to Project" (Safe Implementation)

- **Problem:** User has to manually copy-paste JSON for every change.
- **Action:** Implement a safe "Preview & Apply" flow where the AI proposes a file modification and the user can see a diff before approving the write operation.

## 5. Expanded Publishing Knowledge Base

- **Problem:** The AI currently only knows about the Construct 3 engine, but game development requires knowledge of publishing platforms and specific tools.
- **Action:** Scrape and index documentation for:
  - **Pipelab (pipelab.app)**: To help with desktop/Steam builds and CI/CD pipelines.
  - **Steamworks / Steam API**: Guidelines for achievements, leaderboards, and store setup.
  - **Itch.io**: Guidelines for Butler CLI, HTML5 uploads, and page setup.
  - **General Publishing**: Mobile stores (Google Play/App Store) requirements.

## 6. Robust User Feedback (Toast Notifications)

- **Problem:** Errors and success states (like indexing finished) are only visible in the console.
- **Action:** Integrate PrimeVue's Toast system to notify the user about indexing progress, clipboard copy success, and API errors.

## 7. Deep "Chain of Thought" Visualization (Research Log)

- **Problem:** Users can't see why the AI makes certain decisions or what context it's using.
- **Action:** Build a "Research Log" UI that shows real-time steps like "Searching Event Sheets...", "Consulting Manual...", "Filtering results with Reranker...".

## 8. Advanced Markdown & Syntax Highlighting

- **Problem:** JavaScript or JSON code blocks in chat are plain text and hard to read.
- **Action:** Implement `highlight.js` or `Prism.js` to provide high-quality syntax highlighting for all code blocks in the chat.

## 9. Interactive Project Navigator (Project Tree)

- **Problem:** AI context is managed automatically; users can't manually prioritize specific files.
- **Action:** Add a Project Tree view in the sidebar. Let users "Pin" specific event sheets or layouts to the current chat context to force the AI's focus.

## 10. Dynamic Addon Metadata Scraper

- **Problem:** Third-party plugins are often missing from the local manual.
- **Action:** Create a tool that can fetch `aces.json` files directly from URLs or local `.c3addon` files to provide the AI with perfect logic for any plugin.

## 11. Multi-Agent Reasoning (The Judge Agent)

- Problem: A single agent might produce logic that is technically valid but inefficient.
- Action: Implement a "Reviewer" agent that automatically runs the `audit_project` logic on the AI's own suggestions before they are presented to the user.

## 12. Project-wide Lint & TypeScript Fixes (DONE)

- Migrated to `oxlint` and `oxfmt` for ultra-fast linting and formatting.
- Fixed existing linting issues using `oxlint --fix`.
- Integrated formatting into the development workflow via `GEMINI.md`.
