# Objective

The UI is broken because I used utility classes like `flex`, `items-center`, `justify-between`, `px-2`, `hover:bg-surface-100`, etc., in the Vue templates, but the project does not have a utility CSS framework like **Tailwind CSS** or **PrimeFlex** configured to process them.

# Root Cause

During the "Gold Standard" UI overhaul, I injected Tailwind-style utility classes assuming they were available in the standard Vite/Vue template. Without a processor like Tailwind CSS, the browser ignores these classes, causing the layout to collapse and elements to overlap or lose their padding/margins.

# Proposed Solution

1. **Integrate Tailwind CSS (v4)**: Since we are using Vite, the modern approach is to use the `@tailwindcss/vite` plugin.
2. **Update Vite Config**: Add the Tailwind plugin to `vite.renderer.config.ts`.
3. **Update CSS Entry**: Add `@import "tailwindcss";` to `src/index.css`.
4. **PrimeVue Compatibility**: Ensure the Tailwind base styles don't heavily conflict with PrimeVue by adjusting the CSS import order if necessary. (Tailwind v4 handles this quite well natively).

# Implementation Steps

1. I have already run `npm install tailwindcss @tailwindcss/vite postcss autoprefixer`.
2. I will modify `vite.renderer.config.ts` to include `tailwindcss()`.
3. I will prepend `@import "tailwindcss";` to `src/index.css`.
4. I will verify that the dev server correctly parses the classes.

# Verification

Once Tailwind is active, classes like `flex`, `items-center`, `gap-2`, and `px-4` will be evaluated by the Vite plugin and injected into the CSS, instantly fixing the alignment, spacing, and hover states of the sidebar, settings dialog, and chat bubbles.
