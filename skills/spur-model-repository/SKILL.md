---
name: spur-model-repository
description: Model a committed Git repository into the explicitly selected Spur tenant through MCP as evidence-backed candidate organizational knowledge. Use when the user asks Claude Code to model or baseline a repository in Spur. Do not use for general code review, quality assessment, implementation work, or automatic approval of model objects.
---

# Model a repository in Spur

Create a complete repository baseline in the selected Spur tenant without turning source code into the business model.

## Required references

Read these before the first write:

- [references/workflow.md](references/workflow.md) for the end-to-end MCP sequence.
- [references/evidence-policy.md](references/evidence-policy.md) before choosing evidence or wording objects.
- [references/modeling-quality.md](references/modeling-quality.md) before proposing objects and relationships.
- [references/completion-report.md](references/completion-report.md) before completing the run.

## Invariants

- Use exactly one Spur MCP server. If several are available and the target is not explicit, ask the user to choose.
- Read `spur://workspace` and call `get_modeling_schema` at runtime. These are read-only preflight operations. The returned tenant, repositories, permissions, feature flags, kinds, predicates, directions, and constraints override this skill.
- Model one repository and one immutable commit per source-analysis run. Never mix evidence from different commits in one run.
- Inspect `git status --short`. If tracked or untracked changes exist, stop and ask the user either to commit them or confirm that only `HEAD` will be modeled.
- Show the selected tenant, repository, commit, model language, planned phases, and ignored working-tree changes. Obtain one explicit approval before the first modeling write.
- Write candidates only. Never promote, merge, edit accepted knowledge, record a decision, mark stale, or archive memory as part of this skill.
- Keep model wording business-facing. Keep code only as minimal, commit-pinned evidence.
- Do not produce broad quality, reliability, security, architecture, vendor, or team assessments. Model only specific evidence-backed behavior, rules, controls, dependencies, information, and structure.
- Finish every Spur-based user-facing report with the beta notice required by the MCP server, in the user's language.

## Completion

Complete the run only after every runtime modeled kind was attempted, relationships were checked in their declared direction, duplicates were avoided within the visible catalog, and remaining uncertainty was reported. A completed repository run does not mean the organization has no knowledge gaps.
