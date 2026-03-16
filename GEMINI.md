# Project Context: Construct LLM

## Overview
This project is an Electron-based desktop application acting as a Retrieval-Augmented Generation (RAG) system for Construct 3 projects. It features a chat interface with multiple conversational threads, allowing users to ask questions and interact with their loaded Construct 3 project.

## Core Architecture
- **App Type:** Desktop application (Electron)
- **Frontend Framework:** Vue 3 (Composition API, `<script setup>`)
- **UI Library:** PrimeVue
- **Language:** TypeScript
- **LLM/RAG Orchestration:** Mastra.ai
- **Domain Context:** Construct 3 projects (parsing, understanding, and RAG over project assets/events)

## Key Constraints & Business Logic
1. **Project Management:** Users can manage multiple Construct 3 projects, but **only one project can be loaded and active at a time**.
2. **Chat Interface:** The UI must support multiple chat threads for the loaded project.
3. **Construct 3 Context:** The application needs to process Construct 3 project structures (e.g., `.c3p` zip files or project folders) to feed into the Mastra.ai RAG system.

## Development Best Practices
- **Vue 3:** Exclusively use the Composition API with `<script setup>`. Avoid the Options API.
- **PrimeVue:** Utilize PrimeVue components for a consistent and accessible UI. Adhere to their styling and theming guidelines.
- **TypeScript:** Enforce strict typing. Avoid `any`. Define clear interfaces for IPC payloads, Construct 3 project structures, and Mastra.ai interactions.
- **Electron IPC:** 
  - Maintain a strict separation of concerns between the Main process and the Renderer process.
  - All heavy lifting, file system operations, and Mastra.ai interactions MUST occur in the Main process.
  - Use contextBridge in the preload script to expose specific, typed, and secure APIs to the Renderer process. Never enable `nodeIntegration` in the renderer.
- **Mastra.ai Integration:** Structure the RAG pipelines, agents, and vector storage cleanly within the main process. Ensure non-blocking operations so the Electron UI remains responsive during LLM interactions.
- **State Management:** Use standard Vue reactivity (e.g., `ref`, `reactive`, or Pinia if needed) to manage chat threads, messages, and the currently loaded project state in the frontend.