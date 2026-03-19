# Implementation Plan: Optimized Incremental Indexing

## Objective

Reduce UI lag and unnecessary CPU/GPU overhead by ensuring that files are only read, chunked, and embedded if they have actually been modified since the last time they were indexed.

## Changes

1. **File Hashing/Modification Tracking**
   - Create a persistent JSON file (e.g., `index-cache.json` in the user's data directory alongside `projects.db`).
   - This file will act as a registry of `{ [filePath]: lastModifiedTime }` or file hashes.
   - When iterating over `allFiles` in `syncProjectToVectorStore`, check the file's current `mtimeMs` (modification time) against the cached value.
   - If `force=false` and the `mtimeMs` matches the cache, **skip the file completely**.

2. **Index Cleaning (Optional but good practice)**
   - If files have been deleted from the project directory, they should ideally be removed from the vector index and the cache. (We can implement a basic prune step).

3. **Updating the Cache**
   - After successfully processing a file (chunking and upserting), update its entry in the cache object.
   - Once the indexing loop finishes, write the updated cache object back to `index-cache.json`.

## Rationale

By caching modification times, we ensure that restarting the app or triggering minor saves only indexes the _changed_ files, turning a 140+ file operation into a 0 or 1 file operation in most cases, completely bypassing the expensive `MDocument.chunk` and `embed` calls.

## Verification

- First run: all 140+ files should index.
- Second run (no changes): It should finish instantly and print "0 files needed indexing."
- Third run (modify one file): It should only index that 1 specific file.
