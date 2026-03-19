# Plan: Project-wide Lint and TypeScript Fixes

## Objective

Fix all 28 errors and 64 warnings identified by `npm run lint` and `tsc`.

## Summary of Fixes

### `scripts/pre-index.ts`

- Fix `no-empty` error in `catch` block (add console.error).
- Replace `any` with proper types where possible or use `@ts-expect-error` with explanation if needed.

### `src/main.ts`

- **Imports**: Fix `import/no-unresolved` for `@mastra/core/agent`. Fix `chokidar` import style.
- **Variables**: Fix `prefer-const` for `encryptedApiKeys`. Remove unused `safeStorage`, `storagePath`, `keysPath`, `globalMissingTriggerOnce`, `mastra`, `apiKeys`.
- **Logic**:
  - Wrap `no-case-declarations` in braces `{}`.
  - Fix `no-empty` blocks (add logging).
  - Remove inferrable type `: string` from string literals.
  - Fix `no-constant-condition` (`while(true)` -> use a descriptive loop control or comment).
  - Replace `@ts-ignore` with `@ts-expect-error` and add justification.
  - Replace `any` with specific interfaces for `Mastra`, `Agent`, `Project`, etc.

### `src/preload.ts`

- Replace `any` with proper type definitions for IPC payloads.
- Remove unused `_event` parameter in listeners or prefix with underscore if allowed.

### `src/vue-shims.d.ts`

- Replace `any` with a more descriptive type if possible.

## Implementation Steps

1. **Step 1: Fix `scripts/pre-index.ts`**
   - Address empty blocks and `any` usage.

2. **Step 2: Fix `src/main.ts` - Part A (Declarations & Imports)**
   - Fix imports, unused variables, and `const` declarations.

3. **Step 3: Fix `src/main.ts` - Part B (Logic & Bracing)**
   - Fix case declarations, empty blocks, and constant conditions.

4. **Step 4: Fix `src/main.ts` - Part C (Typing)**
   - Define interfaces for C3 data structures and Mastra components. Replace `any`.

5. **Step 5: Fix `src/preload.ts`**
   - Define proper types for the exposed API.

## Verification

- Run `npm run lint` and `npx tsc --noEmit` after each step.
- Verify the app still builds and starts correctly.
