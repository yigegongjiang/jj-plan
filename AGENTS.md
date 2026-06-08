# AGENTS

`jjplan`: a rock-stable Spec/Task/Ask tracker for AI (macOS only). Project overview → [README.md](./README.md); release flow → [deploy.md](./deploy.md); doc authoring → [llm-doc-style.md](./llm-doc-style.md). Chinese mirror → [AGENTS.zh.md](./AGENTS.zh.md).

## Workflow (AI-only)

- Code / test / build / deploy / release decisions are all executed by Claude Code or Codex; humans do not develop here
- Design decisions (architecture / selection / directory / naming / dependencies) follow AI judgment; MUST NOT force human conventions / best practices unless that convention is itself the AI's own optimum
- MUST NOT ask back unless necessary; decide and execute directly (deploy / technical choices / doc sync / version number / changelog)
- User role = trigger + online acceptance (via the Cloudflare URL); MUST NOT pull humans into the design loop
- Version: bump PATCH by default; new feature → MINOR; breaking → MAJOR. Unless told "no push", push + tag per [deploy.md](./deploy.md)
- Dissatisfied with the just-shipped version → `git commit --amend` + force push + re-tag the same tag (see deploy.md §4)

## Doc constraints

- All docs (README / CHANGELOG / deploy / AGENTS / comments) MUST be concise, focused, zero redundancy — one line over two, a list over a paragraph, no fluff
- Style spec → [llm-doc-style.md](./llm-doc-style.md); when reviewing, MUST check against the "Anti-patterns" section
- All readers are AI/LLM — optimize for high-quality machine comprehension, not human reading comfort

## Hard rules

- **Stability first**: `jjplan` is a rock-stable plan system; stability outranks feature expansion / UI quality / architecture abstraction / refactoring. Fix defects and edges before adding abstractions
- **Contract vs internals**: CLI/API behavior is a stable contract; data structures are internal. Confirm current behavior before changing, stay compatible after
- **Self-hosting**: maintaining this repo MUST go through `jjplan` itself (create/break-down/track its own Spec/Task) — not in chat or scattered md. Friction = a defect, fix it first
- **Boundaries**: no product model beyond Spec/Task/Ask unless the user explicitly asks; no extra runtime / service shape / storage / background daemon; stable, narrow, maintainable is the default — MUST NOT widen scope for "completeness"
- **Platform**: macOS only (x64 + arm64); other OS/arch are actively rejected by `install.sh` and `update`
- **Version consistency**: the root `VERSION` file is the single source; `cli/build.ts` injects it into the binary as `JJ_VERSION`; the first Actions step validates `VERSION == tag (minus the v)` and fails on mismatch
