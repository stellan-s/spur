---
name: spur-write-requirements
description: Turn a product idea or change into an evidence-aware PRD or technical specification using the explicitly selected Spur tenant. Use when the user asks to write, refine, compare, visualize, or save requirements, acceptance criteria, Definition of Done, scope, diagrams, images, rollout, or open questions. Do not use for implementation, broad code-quality assessment, or silently treating code observations as approved requirements.
---

# Write requirements with Spur

Create a useful requirements document without confusing existing system evidence, user intent, and proposed delivery choices.

## Required references

- Read [references/workflow.md](references/workflow.md) before using Spur context or saving a document.
- Read [references/sections.md](references/sections.md) when selecting the document structure or writing acceptance criteria, Definition of Done, or technical sections.
- Read [references/visuals.md](references/visuals.md) when the user requests visuals or a diagram, image, screenshot, mockup, map, or model would materially clarify the requirements.

## Choose the document shape

Respect sections the user already requested. Otherwise use the core set: problem, desired outcome, users, scope, requirements, open questions, and verification needed before building.

Offer optional sections only when they add value:

- acceptance criteria;
- Definition of Done;
- non-functional requirements;
- data and access rules;
- dependencies and risks;
- metrics and analytics;
- rollout and migration;
- test approach;
- diagrams, images, screenshots, or wireframes.

Do not make the user answer a long questionnaire. Ask one compact question when a missing choice would materially change the document; otherwise draft with stated assumptions.

## Invariants

- Use exactly one explicitly selected Spur MCP server. Read `spur://workspace` before relying on tenant knowledge.
- Treat accepted human-owned knowledge, candidate model knowledge, code observations, user intent, and new proposals as different evidence classes. Never present one as another.
- A short or empty search result is not proof that Spur lacks the knowledge. Retry once with a distinct shorter or alternative business phrasing before recording an unknown.
- Search the repository only when the user authorizes code search or the selected tenant is already configured to search it. Code can establish observed behavior, not business approval or future intent.
- Keep a PRD business-facing. Put implementation design in a technical specification or a clearly labeled technical section.
- Acceptance criteria describe observable feature outcomes. Definition of Done describes delivery-completeness gates. Do not duplicate one into the other.
- If no organization-specific Definition of Done is evidenced, label it **Proposed Definition of Done**.
- Label every visual as **Current**, **Proposed**, or **Illustrative**. A generated diagram or mockup is never evidence of current behavior.
- Prefer editable diagrams for structure and flow. Include images only when they convey information that prose or a small diagram cannot.
- Draft before saving. Call `create_product_document` or `update_product_document` only after the user explicitly approves the document and destination.
- Saving creates or updates unverified product-document memory. It does not prove implementation, approve a decision, or promote other catalog objects.
- Finish every Spur-based user-facing report with the beta notice required by the MCP server, in the user's language.

## Output quality

Use concise, testable language. Give each requirement one obligation. Separate out-of-scope items from deferred ideas, expose unresolved decisions, and avoid prescribing a technical solution unless the evidence or user requires it.
