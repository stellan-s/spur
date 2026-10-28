# Evidence and code-minimization policy

The model describes the organization. Source code only proves particular claims.

## Allowed evidence

- Use committed code or tests at the run's pinned commit.
- Prefer the smallest contiguous range that proves the statement, usually 1–8 lines.
- Each excerpt must stay within the limits returned by `get_modeling_schema`.
- Cite separate small ranges when two independent facts are required; never expand one excerpt merely for context.
- Keep paths, line numbers, code identifiers, routes, table names, and implementation details out of business titles.
- Put a necessary technical name in the dedicated technical field, entity definition, data locator, or evidence rather than the business statement.

## Refused evidence

Do not submit:

- entire functions, components, classes, schemas, or configuration blocks when a smaller range is sufficient;
- JSON, JSONL, CSV, TSV, source maps, lockfiles, minified files, or arbitrary data dumps;
- fixtures, snapshots, generated code, dependencies, build output, coverage output, or debugging artifacts;
- credentials, environment files, tokens, keys, secrets, or production/customer data;
- uncommitted content or an excerpt copied from a different commit.

Human-verified rule records explicitly accepted by the runtime contract may be used. Server validation remains authoritative.

## Freshness

An excerpt is immutable evidence about its pinned commit, not a claim that the implementation remains current. The completion report must state the modeled commit. Do not delete older evidence or accepted memory merely because a later repository view differs.
