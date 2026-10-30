# Browser UI and agent harness

The Playwright gate exercises the production SSR build and a **demo-only static snapshot**, with an isolated temporary database, media and uploads. The fixture server binds to `127.0.0.1` ports 4178/4179 and must not be exposed publicly. No real Notion credentials or user data are needed. Both servers are stopped and temporary database data removed on normal test completion; the generated `.ui-test-snapshot/` is ignored by Git and replaced on the next run (the normal `static-dist/` is not touched). Do not run multiple copies on the same ports. Do not commit generated screenshots, traces or reports.

```sh
npm ci
npx playwright install --with-deps chromium  # one-time browser + system dependencies
npm run test:ui                               # rebuild SSR, create demo snapshot, run UI tests
# If the build and demo snapshot are already current:
npm run test:ui:built
npx playwright test --project=small-phone     # specific project (requires built fixtures)
npx playwright show-report                   # CI HTML report when saved
```

Node 22.23.4+ is required. On Linux install a CJK system font (e.g. `fonts-noto-cjk`) to render Chinese body text; the site intentionally uses a system CJK body font. CI installs it. Playwright normally downloads its pinned Chromium; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects a compatible installed binary. Browser test environment clears Notion credentials and uses an isolated working directory; still do not provide production secrets to a test run.

## Scope and evidence

- Chromium viewport emulation: 320, 390, 720, 768 and 1440 CSS pixels, touch where relevant; English/Chinese and SSR/static public routes. Search, navigation, responsive contents, admin tabs/expanded editor, keyboard focus, long text, speech controls (mock speech), reduced motion and no-WebGL/no-JS homepage fallback are covered.
- The assertions check document overflow, key controls and basic interactions. On failure Playwright keeps a screenshot and trace in `test-results/`; CI uploads the failure artifacts and report. These can contain test data and should be treated as potentially sensitive if fixtures change.
- This is **not** pixel-diff visual regression, a full accessibility audit, physical mobile/Safari/Firefox verification, real audio playback or a production deployment test. Automated geometry checks can miss clipping, overlapping controls, contrast and aesthetic regressions; inspect screens and test real devices separately. Screenshot baselines should be introduced only with pinned OS/fonts/browser and reviewed changes.

For agents: read `AGENTS.md` and `docs/DESIGN-SYSTEM.md`, make the smallest appropriate change, run relevant fast checks and the full gates, and report what could not be verified. Test scripts must remain deterministic and isolated; add regression coverage for discovered layout bugs rather than suppressing failures.
