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
