# Requirements section catalog

## Core sections

Use these unless the user selects a narrower format:

- **Problem:** who is affected, what fails today, and why it matters.
- **Desired outcome:** the measurable change the work should create.
- **Users:** primary users and important secondary actors.
- **Scope:** included behavior and boundaries.
- **Requirements:** numbered, atomic obligations written as outcomes or constraints.
- **Out of scope:** intentionally excluded work; keep deferred ideas separate.
- **Verify before building:** unconfirmed current behavior, code-derived assumptions, and evidence gaps.
- **Open questions:** unresolved decisions that can change scope, behavior, or acceptance.

## Optional sections

### Acceptance criteria

Use when delivery or review needs observable pass/fail conditions. Include the actor, starting condition, action, and observable result when those details matter. Cover the main success path, important boundary cases, authorization boundaries, and meaningful empty or failure states.

Do not prescribe internal implementation or turn every UI detail into a criterion. Number criteria for review and testing.

### Definition of Done

Use when the user wants delivery-completeness gates beyond feature behavior. Typical categories are tests, accessibility, observability, documentation, migration, security or privacy review, and release readiness.

Reuse an evidenced organizational Definition of Done when one exists. Otherwise title the section **Proposed Definition of Done** and keep it proportional to the change. Do not claim a proposed checklist is company policy.

### Non-functional requirements

Use for measurable performance, availability, accessibility, privacy, retention, scalability, localization, or operational constraints. Every target needs a scope and measurement condition; avoid unsupported percentages and latency targets.

### Data and access rules

Use when the feature reads, writes, aggregates, exports, or exposes tenant data. State data grain, ownership, retention, authorization boundaries, cross-tenant prohibitions, and sensitive-data handling without inventing a schema.

### Dependencies and risks

Use when external services, shared components, migrations, uncertain source behavior, or organizational decisions can block delivery. Distinguish a dependency from a risk and name a mitigation only when credible.

### Metrics and analytics

Use when success must be observed after launch. Tie each metric to the desired outcome and define the event or population precisely enough to implement later.

### Rollout and migration

Use for data backfills, feature flags, staged releases, compatibility windows, reversibility, or user communication. Omit for changes that genuinely need none.

### Test approach

Use in technical specifications or when the user explicitly requests it. Describe the required test levels and critical scenarios without duplicating acceptance criteria.

### Visuals

Use when a process, interaction, state change, data relationship, system boundary, or interface concept is materially easier to understand visually. Select the smallest useful diagram or image and follow [visuals.md](visuals.md).

## Useful section profiles

- **Lean:** core sections only.
- **Delivery-ready:** core + acceptance criteria + proposed or evidenced Definition of Done + dependencies and risks + useful visuals.
- **Data or access-sensitive:** delivery-ready + data and access rules + non-functional requirements.
- **Technical specification:** context + design + interfaces + data + failure handling + test approach + rollout, while retaining verification and open questions.

Profiles are shortcuts, not rigid templates. The user can add or remove any optional section.
