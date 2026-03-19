# Plan: Dynamic AI Providers & Settings

## Objective

Remove the hardcoded Mistral AI dependency and replace it with a dynamic settings interface. This will allow users to input their own API keys for various providers (Mistral, OpenAI, Anthropic, Gemini, Groq, etc.) and select which model to use on a per-thread basis.

## Background & Motivation

Currently, `process.env.MISTRAL_API_KEY` is hardcoded, and the `mistral` provider from `@ai-sdk/mistral` is hardcoded into the `Agent` definition. Mastra and the Vercel AI SDK support many providers natively. By building a UI to capture these keys and a backend utility to instantiate the correct provider, the app becomes a flexible BYOK (Bring Your Own Key) tool.

## Scope & Impact

1.  **Frontend (Settings UI)**:
    - Create a settings modal in `src/App.vue` (or a dedicated component).
    - List supported providers (e.g., Mistral, OpenAI, Anthropic, Google).
    - Input fields for API keys.
    - Save these keys to a secure local store (using Electron's `safeStorage` or the existing `appState` for now, though `appState` is plain JSON).
2.  **Frontend (Thread Settings)**:
    - Add a dropdown to select the active model for the current thread or chat session.
3.  **Backend (`src/main.ts`)**:
    - Remove hardcoded `mistral` imports.
    - Install necessary `@ai-sdk/*` packages for the supported providers.
    - Create a factory function `getModel(providerId, modelId, apiKeys)` that returns the initialized AI SDK model object.
    - Update the `ask-question` IPC handler to dynamically configure the `agent` with the selected model before calling `agent.stream()`.

## Note on Architecture

Mastra's `Agent` expects a `model` object in its constructor. However, you can override the model on a per-call basis using `agent.stream(text, { model: ... })` or by dynamically recreating/updating the agent if needed. The easiest approach for this architecture is to instantiate the AI SDK model right before the stream call and pass it via the options, or re-initialize the agent if the API keys change.

Actually, Mastra allows passing a `model` directly to `stream`:
`agent.stream(messages, { model: customModel })`

Let's verify this in the docs.
