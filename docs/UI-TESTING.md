# Browser UI and agent harness

The Playwright gate exercises the production SSR build and a **demo-only static snapshot**, with an isolated temporary database, media and uploads. The fixture server binds to `127.0.0.1` ports 4178/4179 and must not be exposed publicly. No real Notion credentials or user data are needed. Both servers are stopped and temporary database data removed on normal test completion; the generated `.ui-test-snapshot/` is ignored by Git and replaced on the next run (the normal `static-dist/` is not touched). Do not run multiple copies on the same ports. Do not commit generated screenshots, traces or reports unless deliberately promoting reviewed visual baselines.

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run test:ui                  # build SSR + demo snapshot, run all browser projects
# If the build and demo snapshot are current:
npm run test:ui:built -- --project=firefox-phone --project=firefox-desktop
npm run test:ui:built -- --project=webkit-phone --project=webkit-desktop
npx playwright show-report
```

Node 22.23.4+ is required. On Linux install a CJK system font (e.g. `fonts-noto-cjk`) for the regular UI tests. Playwright downloads the browser revisions specified by the lockfile. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects a compatible local Chromium binary; never use that override to generate reference images. Browser test environment clears Notion credentials and uses an isolated working directory; still do not provide production secrets to a test run.

## Scope and evidence

- CI runs Chromium at 320, 390, 720, 768 and 1440 CSS pixels, Firefox and WebKit at 390 and 1440, in both SSR/static and English/Chinese. These are emulated viewports; Playwright WebKit is not shipping Safari and Firefox emulation is not a phone.
- Tests cover search including empty results, contents, admin tabs and disclosures, keyboard focus, long text, speech controls (mock speech), reduced motion and no-WebGL/no-JS homepage fallback. Axe checks a selection of public/admin states against WCAG 2 A/AA and 2.1 A/AA rules, including detectable contrast; axe cannot verify every contrast case, dynamic scene or screen reader workflow.
- On failure Playwright keeps screenshots and traces in `test-results/`; CI uploads diagnostics. These can contain test data and should be treated as potentially sensitive if fixtures change.
- Not a substitute for actual Safari, physical devices, screen readers, 200%/400% zoom, real audio, a full accessibility audit or a production deployment test. Automated geometry can miss clipping, overlap, contrast and aesthetic regressions.

## Visual review and future baselines

CI's `Reviewable visual captures` job uses `mcr.microsoft.com/playwright:v1.56.1-noble`, the browser version from `@playwright/test` in the lockfile, Archivo served by the app, `@docx-editor.dev/fonts-cjk@2.33.0` through `tests/visual/fonts.conf`, fixed time/locale/viewport, and reduced motion. It uploads four demo-only PNGs and `environment.json` as the `visual-candidates` artifact, including on a failure where captures exist. The image is version-tagged, not digest-pinned, and running outside this container does not produce a trusted reference. These are **review candidates**, not an approved baseline or a pixel-diff gate.

To establish approved baselines, inspect the candidate screenshots with the product owner; then run in the exact same container, Node version, working directory, fontconfig and lockfile, create snapshots with `VISUAL_COMPARE=1 npx playwright test --config=playwright.visual.config.mjs --update-snapshots`, review the added PNGs, and commit them. After approval, enable `npm run test:visual:compare` in the visual CI job. Do not silently update goldens to make failures pass. Pin the container by digest and verify font/browser versions before trusting pixel diffs; regenerate deliberately when updating them. Local `npm run test:visual:candidates` is useful for inspection but is not a baseline without the container.

## Real-device and assistive technology checklist

Record date, build/URL, OS, browser and version, device and orientation, assistive technology and result; never mark tests passed without running them. Use non-sensitive demo content.

1. iPhone Safari with VoiceOver and Android Chrome with TalkBack: navigate landmarks/headings, skip link, language selection, article contents and search/empty results. Check portrait and landscape, text enlargement and 200% zoom.
2. macOS Safari/VoiceOver and Windows Firefox/NVDA: browse lists and article body; verify announcements and focus through admin login, tab arrow keys, More editor disclosures and reordering; confirm focus and names after changing a tab.
3. In reduced-motion mode and with WebGL unavailable, verify homepage navigation remains usable. Test browser TTS only on actual supported systems and verify controls hide when unsupported.
4. Check text and focus indicators against their actual backgrounds, including hover, selected, disabled and error states; inspect image/table/code overflow and very long mixed-language content. Document failures and screenshots without user data.

For agents: read `AGENTS.md` and `docs/DESIGN-SYSTEM.md`, make the smallest appropriate change, run relevant fast checks and the full gates, and report what could not be verified. Add regression coverage rather than suppressing failures.
