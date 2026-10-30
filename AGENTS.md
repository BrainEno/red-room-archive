# Agent working agreement

Read this file and the relevant code/tests before modifying the project. Follow user instructions and preserve existing uncommitted work. The site is a Notion-backed, single-process Node SSR app with a separate **read-only static snapshot**, not a serverless SQLite app.

## Workflow
1. Identify the affected contracts and deployment modes before changing behavior. Inspect `src/shared`, `src/core`, `src/server`, `src/ui` and the matching tests; keep routes, compatibility paths and database migrations unless their removal is explicitly intended.
2. For UI changes, consult `docs/DESIGN-SYSTEM.md`: reuse tokens, components and bilingual copy, preserve keyboard access and reduced-motion behavior, and check narrow as well as wide layouts. Avoid hiding overflow at the page level to mask broken layouts.
3. Use deterministic demo/mock data and isolated temporary storage for tests. Never put secrets or private Notion content into tests, screenshots, traces, commits or PR descriptions. Do not run browser tests against a real deployment.
4. Run the smallest relevant tests while iterating, then `npm run check`. For visual/layout changes also run `npm run test:ui` after installing Playwright Chromium, Firefox and WebKit (see `docs/UI-TESTING.md`). Report anything not run and why; do not claim physical-device or screen-reader testing based on emulation.
5. Summarize behavior, compatibility/migration effects, exact checks and remaining risks in the PR. Do not close issues before their fixes are merged unless explicitly asked.

`npm run check` covers typecheck, unit tests, production build and SSR/static integration tests. `npm run test:ui` is the separate browser-engine layout/interaction gate and builds an isolated demo snapshot. CI runs both. The browser gate is not a pixel-perfect visual approval or an accessibility audit.
