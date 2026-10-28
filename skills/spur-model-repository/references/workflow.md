# Repository modeling workflow

## 1. Select and verify the workspace

1. Select the one Spur MCP server named or implied by the user.
2. Read `spur://workspace` from that server.
3. Stop if MCP is not ready, `modelling_writes` is disabled, or `permissions` lacks `memory.propose`, `memory.relate`, or `memory.add_evidence`.
4. Match the current Git checkout to one configured repository. Do not infer the target from similar folder names.
5. Read the repository's `HEAD` and `git status --short`.
6. Determine the model language from established tenant memory. If the tenant is empty or mixed, ask once during preflight.
7. Call `get_modeling_schema`. Treat it as the current contract.

Show a compact preflight containing the Spur server, organization, repository, commit, dirty-state decision, model language, and planned phases. Ask for one approval before calling a write tool.

## 2. Understand the existing model and repository

- Use the workspace memory and relationships as the existing catalog. Reuse stable `mem_...` IDs when this repository adds evidence to an existing concept.
- Inspect committed source, tests, migrations, configuration, and relevant documentation. When the worktree is dirty and the user chose HEAD-only, read exclusively from the pinned commit with commit-aware commands such as `git ls-tree`, `git grep <commit>`, and `git show <commit>:<path>`; do not use ordinary filesystem reads. Exclude dependencies, generated output, build artifacts, fixtures, snapshots, data dumps, credentials, and secret-like files.
- Follow the `layer_order` returned by `get_modeling_schema`. Do not hardcode a different order.
- Cover every returned modeled kind that the repository supports. Record absence as a gap in the final report, not as a fabricated object.

## 3. Open one commit-pinned run

Call `begin_source_analysis` with:

- the exact commit SHA;
- the configured repository name when it is not the primary repository;
- a stable idempotency key derived from the skill ID, repository, and commit;
- `client_name` set to `spur-model-repository`;
- `client_version` set to the installed skill version;
- the actual Claude model name when available.

Reuse the same idempotency key after a recoverable failure.

Inspect the returned run before proposing anything:

- If it is `completed`, do not write. Report that this exact repository commit was already modeled, with the returned counts.
- If it is `active` with nonzero counts, resume by regenerating the deterministic batches and stable external IDs for the same pinned commit. Re-sending an exact object or relationship is idempotent. Stop and report a conflict if the same external ID now describes a different concept.

## 4. Propose the baseline

- Work in bounded batches. Use stable external IDs that describe the business concept, not a file path.
- Before proposing a new object, compare it with existing tenant memory and earlier objects in the run. Use `add_evidence` for the same concept instead of creating a duplicate.
- Call `propose_memory_objects` with exact, minimal evidence that follows the evidence policy.
- Propose an entity when committed evidence establishes the business concept. Include only evidenced attributes and data locations; empty lists are valid. Do not guess classifications, system-of-record roles, or identifiers.
- Call `propose_relationships` only after both endpoints exist. Use only runtime predicates in their stated direction. Entity relationships need the runtime-required cardinality and joining attributes when supported.
- Model non-sensitive technical safeguards as candidate controls. When safeguard details meet the runtime definition of `restricted`, propose them only if `permissions` contains `restricted.write`. Otherwise omit them, report the permission-limited gap, and do not claim that duplicates were ruled out among hidden restricted knowledge. Do not copy ISMS register wording or claim effectiveness.
- Decisions are human-owned. Never infer or create them from repository evidence.

## 5. Verify and complete

Before `complete_source_analysis`:

- confirm every runtime layer was attempted;
- check that titles and statements are business-facing;
- check every object has accepted evidence;
- check relationship direction and entity cardinality;
- check for semantic duplicates within memory visible to the current principal;
- separate objective observations from subjective assessment;
- list unsupported or ambiguous areas as knowledge gaps in the report.

Seal the run only when these checks pass. If a blocking tool or validation error remains, leave the run active and report the exact blocker.
