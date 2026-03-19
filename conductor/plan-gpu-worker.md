# Implementation Plan: WebGPU Worker for Embeddings

## Objective

Offload the CPU-intensive embedding generation from the Electron main process to a Web Worker running in the Renderer process. This allows us to leverage WebGPU (hardware acceleration) via `@huggingface/transformers` v3, completely freeing the main thread and eliminating UI lag.

## Changes

1. **Create the Web Worker (`src/embedding.worker.ts`)**
   - Import `pipeline` from `@huggingface/transformers` (v3 supports WebGPU).
   - Set up an `onmessage` listener that initializes the `feature-extraction` pipeline with `{ device: "webgpu" }` (falling back to WASM/CPU if unsupported).
   - Process the requested texts, extract the embedding data, format it as a 2D array, and post the result back.

2. **Update `src/preload.ts`**
   - Add `onEmbeddingRequest` to listen for requests from the main process.
   - Add `sendEmbeddingResult` to send the computed vectors back to the main process.

3. **Initialize Worker in Renderer (`src/App.vue` or `src/renderer.ts`)**
   - Instantiate the Web Worker using Vite's worker syntax (`import EmbeddingWorker from './embedding.worker.ts?worker'`).
   - Listen to `window.api.onEmbeddingRequest` and forward the data (`id`, `texts`) to the worker.
   - Listen to the worker's `onmessage` event and forward the result to `window.api.sendEmbeddingResult`.

4. **Refactor Main Process (`src/main.ts`)**
   - Remove the `XenovaEmbedder` class and the `@xenova/transformers` import.
   - Update `embeddingModel.doEmbed` to use a Promise-based IPC mechanism. It will send a `request-embedding` message to `mainWindow` with a unique ID and wait for an `embedding-result` event from `ipcMain`.
   - Ensure the batch sizes in `syncProjectToVectorStore` can be increased again (e.g., back to 20 or 50) since the main thread is no longer blocked.

## Verification

- Run the indexing on the large project again.
- The UI should have zero stuttering because the heavy math is in a Web Worker.
- The logs should indicate rapid processing.
- Run a `search_project` tool call to ensure the Mastra agents can still successfully request embeddings for their queries via the IPC bridge.
