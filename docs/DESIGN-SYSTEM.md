# UI system: editorial rules and shared primitives

This is a pragmatic system for the existing Red Room identity, not a redesign. The public site uses a dark field, ink-coloured text, red accents, condensed display typography, hairline rules and generous spacing. Homepage, reading pages, More and admin have different jobs; they should share the vocabulary without forcing identical layouts.

## Source of truth

- `src/ui/styles/base.css`: `--void` (background), `--ink` (text), `--red` (brand accent), `--accent-soft` (readable warm accent on dark), `--page-gutter`, `--ease`, shared font stacks and keyboard focus ring.
- `src/ui/styles/cjk.css`: Chinese and mixed-script typography; `src/ui/i18n.ts`: interface copy. Do not hardcode English labels in public components. User content may be either language independently of the interface.
- `Page.astro`, `SiteHeader`, `SiteFooter`, `ArticleList`, `Pager`, `ReadAloud`: reuse shared landmarks, navigation and patterns before introducing a parallel component. Home intentionally has its own scene and navigation; admin is operational UI.
- `pages.css`, `home.css`, `more.css`, `admin.css` own page-specific layout. The current public breakpoint is 720px; article TOC switches at 1100px; admin and More have additional content-driven breakpoints. Do not change one without checking adjacent widths.

## Interaction and layout contracts

- All links, buttons, inputs, selects and disclosures need a visible keyboard focus state. Keep semantic elements, accessible names, a skip link on inner pages, and control labels; do not rely only on colour or hover. Test touch and keyboard paths.
- Respect `prefers-reduced-motion`; preserve legibility and access when motion or WebGL is unavailable. Browser TTS is optional and only appears when supported.
- Allow headings, metadata, names and URLs to wrap. Use `minmax(0, 1fr)` and `min-width: 0` in grids/flex layouts. Wide tables/code scroll inside an identifiable region rather than widening the entire viewport. Do not truncate essential controls or hide whole-page horizontal overflow to make a test pass.
- Support 320px and wider, long unbroken text, CJK/Latin mixtures, no-cover and covered articles. Keep readable measure for article body and use fluid gutters. Validate 200% zoom and real devices separately when available.
- Maintain adequate contrast for text and interactive states; red on dark is a brand accent, not automatically an accessible text colour. Focus and disabled states must remain distinguishable. This document is not a substitute for a contrast or accessibility audit.

## Change checklist

1. Reuse existing tokens/components and explain intentional deviations.
2. Test English and Chinese, SSR and static where applicable; inspect mobile, breakpoint and desktop layouts.
3. Run browser interaction/overflow checks (`docs/UI-TESTING.md`) and inspect screenshots or live pages for visual changes. Automated geometry assertions do not prove visual quality, full accessibility or real-device behavior.
4. Update this document when a design rule or shared token changes.
