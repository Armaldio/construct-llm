# Implementation Plan: Fix Blocking Indexing

## Objective

Prevent the indexing process from blocking the Electron main thread, which causes UI freezes and fatal app crashes (Wayland "Broken pipe" error).

## Changes

1.  **Batching and Yielding in `syncProjectToVectorStore`**
    - Refactor the inner loop of `syncProjectToVectorStore` to process chunks in batches (e.g., 20 at a time).
    - Use `embeddingModel.doEmbed` with the full batch of strings instead of one-by-one for better performance.
    - Insert `await sleep(5)` or `setImmediate` calls between batches and files to yield control back to the Electron event loop. This ensures that system events (Wayland/X11 heartbeats, IPC) are processed.

2.  **Concurrency Control (Optional but safe)**
    - Check if the project being indexed is still the active one before proceeding with the next batch.

3.  **Error Handling and Abort**
    - Ensure that if indexing is triggered again while one is running, we handle it (currently `force=true` triggers it).

## Verification

- Run indexing on a large project (like the one with 143 files and 455 chunks in a single file).
- Verify the UI remains responsive (e.g., can move the window, click buttons).
- Confirm that "Broken pipe" or "Fatal Wayland error" no longer occurs.
