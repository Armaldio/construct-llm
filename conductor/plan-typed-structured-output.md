# Objective

Replace the fragile regex parsing in the `generate_c3_clipboard` tool with a strictly typed `structuredOutput` approach using a refined Zod schema that is compatible with LLM providers (especially Mistral).

# Key Files & Context

- `src/main.ts`: The `generate_c3_clipboard` tool implementation.
- `Zod`: Used for defining the JSON schema for the AI SDK.

# Proposed Solution

1. **Define a strict, typed schema**: Instead of `z.record(z.any())`, we will use `z.record(z.union([z.string(), z.number(), z.boolean()]))` for parameters. This removes the `any` type which often breaks Mistral's JSON Schema generation.
2. **Handle recursion (Optional but better)**: Use `z.lazy` to allow for sub-events in the clipboard structure, if supported by the provider. If not, we will stick to a non-recursive version for safety.
3. **Use `structuredOutput`**: Re-enable the `structuredOutput` option in `Agent.generate`, passing the new schema. This ensures the output is validated _before_ it's returned to the tool, removing the need for any manual regex or parsing.

# Implementation Plan

1. **Re-add `C3ClipboardSchema`**: Define the schema at the top of the file (or just before the tool).

   ```typescript
   const C3ClipboardSchema = z.object({
     "is-c3-clipboard-data": z.literal(true),
     type: z.literal("events"),
     items: z.array(
       z.object({
         eventType: z.string(),
         conditions: z.array(
           z.object({
             id: z.string(),
             objectClass: z.string(),
             parameters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
           }),
         ),
         actions: z.array(
           z.object({
             id: z.string(),
             objectClass: z.string(),
             parameters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
           }),
         ),
       }),
     ),
   });
   ```

2. **Modify `generate_c3_clipboard`**:
   - Update the prompt to remove mentions of "raw JSON block" and "regex" and instead focus on following the schema.
   - Update `simpleGenerator.generate` to use `structuredOutput: { schema: C3ClipboardSchema }`.
   - Remove all regex matching and manual parsing.
   - Return `JSON.stringify(result.object)`.

# Verification

- The tool will now return typed objects that are guaranteed to match the schema.
- No regex parsing will be performed.
- Mistral should no longer return 500 errors because the schema is well-defined (no `any`).
