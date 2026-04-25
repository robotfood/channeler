This is the canonical agent instructions file for this repository.
Agent-specific files should defer to this file unless they need explicit overrides.

<!-- BEGIN:nextjs-agent-rules -->
# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project instructions for Codex

## Stack
- Next.js App Router
- TypeScript
- React Server Components by default
- Use Server Actions where appropriate
- Styling: Tailwind CSS
- Package manager: pnpm

## Next.js docs
Use the version-matched docs bundled with this project:
- Read `.next/types` when relevant
- Prefer docs from `node_modules/next` over memory
- Do not use outdated Pages Router patterns unless this repo uses `/pages`

## Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Typecheck: `pnpm tsc --noEmit`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Build: `pnpm build`

## Code rules
- Prefer Server Components.
- Add `"use client"` only when needed for state, effects, browser APIs, or event handlers.
- Keep data fetching on the server when possible.
- Use `next/link`, `next/image`, and `next/navigation`.
- Do not introduce API routes unless Server Actions or route handlers are unsuitable.
- Preserve existing component patterns and folder structure.

## Verification
Before finishing, run:
1. `pnpm lint`
2. `pnpm tsc --noEmit`
3. `pnpm build`

Summarize changed files and any commands that failed.
