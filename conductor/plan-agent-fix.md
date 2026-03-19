# Implementation Plan: Refactor Agent Code

## Objective

Refactor the agent creation logic in `src/main.ts` to solve three core issues:

1. Prevent continuous mutation of the global agent prompt (`instructions`) on each request, which causes the prompt to grow infinitely and causes race conditions across multiple threads.
2. Fix silent failures in `getDynamicModel` when an API key is missing.
3. Remove improper TypeScript assertions (`as any`) when mutating agent configurations.

## Changes

1. **Extract Agent Configurations**
   - Create an `AGENT_CONFIGS` object that stores the `name`, `instructions`, and `tools` for each agent (`architect-agent`, `logic-expert-agent`, `generator-agent`, `construct-llm-agent`).

2. **Refactor Static Agents and Mastra Initialization**
   - Update the static instantiations of `architect`, `logicExpert`, `generator`, and `agent` to pull their base properties from `AGENT_CONFIGS`.
   - Update `generate_c3_clipboard` to use the static `generator` instance directly rather than calling `(mastra as any).getAgent("generator-agent")`.

3. **Refactor `getDynamicModel`**
   - Remove the `try...catch` block that hides errors.
   - Throw a clear `Error` if the API key for the selected provider is missing. This will be caught by the outer IPC handler and returned gracefully.

4. **Refactor `createDynamicAgent`**
   - Look up the agent properties from `AGENT_CONFIGS` based on the requested `agentId`.
   - Throw an `Error` if the config doesn't exist.
   - Assemble `finalInstructions` freshly using the base instructions and custom user prompt.
   - **Return a `new Agent(...)`** with the dynamic `model` and `instructions` instead of mutating the static global agents.

## Verification

- Test running a query to verify `askQuestion` successfully creates a dynamic agent and streams back a response.
- Verify that passing an invalid/empty model configuration throws an error instead of silently falling back to Mistral.
- Verify that custom prompts are passed down without being duplicated on subsequent messages.
