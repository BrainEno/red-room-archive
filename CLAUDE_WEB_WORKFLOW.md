# Claude Web-Only Development Workflow

This repository is maintained with Claude's web chat (including the free plan). Do not assume Claude Code, a local shell, Desktop, or a direct Git working tree is available.

## Repository facts

- Stack: Astro 5 SSR on Node, TypeScript, Three.js, GSAP, Lenis, SQLite and Notion integration.
- Default branch: `main`.
- Build command: `npm ci && npm run build`.
- Automated validation: GitHub Actions workflow `Validate` runs on PRs and pushes to `main`.
- Runtime secrets and production data must never be added to Git. Use `.env.example` as the safe template.

## Required workflow for every task

1. Start by reading this file, `README.md`, `package.json`, the current default branch SHA, relevant source files, and recent PR/CI results. Do not download or re-upload a ZIP unless there is no alternative.
2. Define the smallest useful change, acceptance criteria, relevant files, and checks before editing. Avoid broad rewrites and unrelated formatting.
3. Make changes on a dedicated branch named `claude/<short-task-slug>` or `task/<short-task-slug>`; never commit directly to `main`.
4. Prefer a pull request with a small, reviewable diff. Include the task intent, design decisions, changed files, validation results, known risks, and a recovery note in the PR body.
5. Do not claim tests passed unless the GitHub Actions run actually confirms success. This project currently has a build validation workflow; do not claim it has unit or integration tests unless they are added and executed.
6. If a check fails, inspect the exact failing step and log, fix only the root cause, and rerun the smallest relevant check before rerunning the full build.
7. Never force-push, rewrite shared history, reset the default branch, or merge a PR without explicit user authorization. Do not overwrite a file based on stale content: check the latest file SHA or branch head before updates.
8. Never commit `.env`, tokens, credentials, database files, uploaded user content, generated build output, or other secrets/data. Do not echo secrets into logs.
9. Keep work resumable. In each PR description or task issue, record task ID and objective; base branch and base commit SHA; completed changes and changed paths; CI run URL and actual result; outstanding work and the exact next action.
10. If the free usage limit interrupts work, stop. Resume by reading the task/PR, current branch head, diff, and CI status. Continue only incomplete work; do not repeat repository discovery or reimplement already completed changes.

## How to transfer changes without ZIP files

Use the GitHub web interface and PRs as the source of truth. When direct branch editing is unavailable in Claude chat, ask Claude to produce a unified diff patch limited to the named files, with no binary files. Apply that patch in a dedicated branch using GitHub's supported editing workflow or a trusted local Git client, then open/update the PR. Do not paste a whole repository into chat.

For small text-only changes, GitHub's file editor can be used directly on the task branch. For multi-file changes, use a local Git client or a trusted patch-application tool to apply the unified diff, inspect `git diff --check` and `git diff`, then push the branch. Avoid ZIP round-trips.

## Prompt template for Claude web

> Work only on BrainEno/red-room-archive. Follow CLAUDE_WEB_WORKFLOW.md. First inspect the latest main SHA, relevant source files, open PRs, and the latest Validate workflow result. Propose a small plan and acceptance criteria. Implement only the scoped change on a dedicated branch/PR; do not modify main directly. Keep the diff small, inspect the final diff for accidental changes and secrets, and report actual CI status. If you cannot write to GitHub or execute Git operations from this chat, do not pretend you did: return a unified diff patch for only the necessary files plus exact apply/verify commands. Record the base SHA, changed paths, CI URL/result, and the next action so the work can resume without re-analysis.

## Current limitations

The repository workflow validates dependency installation and the production build. It does not itself give Claude web chat repository write access or shell access. GitHub's connected app permissions and the Claude interface determine which actions are available. The Validate workflow is intentionally read-only (`contents: read`); it does not execute arbitrary model-supplied shell commands, commit patches, or merge PRs.
