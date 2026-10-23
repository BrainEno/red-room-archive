# Claude Web-Only Development Workflow

This repository is maintained with Claude's web chat, including the free plan. Do not assume Claude Code, a local shell, Claude Desktop, or a direct Git working tree is available.

## Repository facts

- Stack: Astro 5 SSR on Node, TypeScript, Three.js, GSAP, Lenis, SQLite and Notion integration.
- Default branch: `main`.
- Build command: `npm ci && npm run build`.
- Automated validation: GitHub Actions workflow `Validate` runs on PRs and pushes to `main`, and can be dispatched against a task branch.
- Runtime secrets and production data must never be added to Git. Use `.env.example` as the safe template.

## Required workflow for every task

1. Start by reading this file, `README.md`, `package.json`, the current default branch SHA, relevant source files, recent PRs, and CI results. Do not download or re-upload a ZIP unless there is no alternative.
2. Define the smallest useful change, acceptance criteria, relevant files, and checks before editing. Avoid broad rewrites and unrelated formatting.
3. Use a dedicated branch named `claude/<short-task-slug>` or `task/<short-task-slug>`; never commit directly to `main`.
4. Keep the patch small and reviewable. The resulting PR should state the objective, changed files, validation results, known risks, and recovery note.
5. Do not claim tests passed unless a GitHub Actions run confirms success. The current automated check runs dependency installation and a production build; do not claim unit or integration tests exist unless added and executed.
6. If a check fails, inspect the exact failing step and log, fix only the root cause, and rerun the relevant check.
7. Never force-push, rewrite shared history, reset the default branch, or merge a PR without explicit user authorization. Check the latest branch/file SHA before updates.
8. Never commit `.env`, tokens, credentials, database files, uploaded user content, generated build output, or other secrets/data. Do not echo secrets into logs.
9. Keep work resumable. Record the task objective, base SHA, changed paths, CI URL/result, outstanding work, and exact next action.
10. If the free usage limit interrupts work, stop. Resume by reading the task/PR, branch head, diff, and CI status; continue only incomplete work.

## ZIP-free patch handoff

The repository now includes `.github/workflows/apply-claude-patch.yml`. It lets you transfer a text patch from Claude's web chat through a GitHub Issue or existing PR. It does **not** give Claude direct Git access.

1. Create a GitHub Issue describing the coding task, or use an existing PR if one is already open.
2. Ask Claude to return a **unified diff only**, in one fenced `diff` code block. It must target only files in the allowed paths listed below. Do not ask it to include shell commands or binary files.
3. Review the diff yourself. In the Issue or PR conversation, post a comment that begins exactly with `/apply-patch`, followed by the single fenced diff block. Example:

   ```text
   /apply-patch
   ```diff
   diff --git a/src/example.ts b/src/example.ts
   ...
   ```
   ```

4. GitHub Actions checks the comment author, validates the patch, applies it on an isolated branch, runs `npm ci` and `npm run build`, then commits and pushes only if the build passes.
5. If you commented on an Issue, the workflow opens a PR. If you commented on an existing PR, it pushes to that PR's branch. It also dispatches the `Validate` workflow against the resulting branch.
6. Review the complete PR diff and CI result. The workflow never merges a PR. If the job fails, inspect its Actions log; the patch is not committed unless the build passed.

### Safety boundaries

- Only comments by the repository owner account `BrainEno` that start with `/apply-patch` are accepted. If the account name changes, update the allowlist in the workflow.
- The patch is treated as data, never executed as a shell script.
- Binary patches, file mode changes, renames, and copies are rejected.
- The path allowlist is limited to `src/**`, `public/**`, `docs/**`, and selected project configuration/documentation files. Workflow files, secrets, local databases, and uploaded data are not patchable through this mechanism.
- The patch is built without a persisted checkout credential. The write token is used only after the build, to push the commit and create/update the PR.
- This workflow does not give Claude web chat shell access, does not run arbitrary Claude-generated commands, and does not auto-merge.

## Prompt template for Claude web

> Work only on BrainEno/red-room-archive. Follow CLAUDE_WEB_WORKFLOW.md. Inspect the latest main SHA, relevant source files, open PRs, and the latest Validate result. State a small plan and acceptance criteria first. Implement only the scoped change. If you cannot write to GitHub directly, return one complete unified diff in a single fenced `diff` block, with no surrounding prose inside the block, no binary files, no shell commands, and only allowed paths. Make sure the patch applies to the latest target branch. Then list the changed paths, rationale, risks, and how to verify. Do not claim CI passed until GitHub Actions confirms it.

## Current limitations

The patch handoff avoids ZIP round-trips, but a person must still review Claude's patch and explicitly post the `/apply-patch` command. Build validation is not a substitute for reviewing the code or testing the site in a browser. Keep secrets and production data out of prompts and patches.
