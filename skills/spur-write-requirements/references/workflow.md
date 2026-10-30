# Requirements workflow

## 1. Establish the destination

1. Select the Spur MCP server named or implied by the user. If several are available and the target is unclear, ask the user to choose.
2. Read `spur://workspace` and confirm the organization, permissions, features, and relevant existing product documents.
3. Determine whether the result is a PRD or technical specification and whether it should stay in chat, be written to a file, or be saved in Spur.
4. Confirm any explicitly requested sections and visual formats. Use the skill's core set for unspecified documents.

Do not call a write tool during this preflight.

## 2. Gather evidence without turning discovery into an interview

- Capture the user's problem, intended outcome, users, constraints, and exclusions.
- Use `investigate` for specific questions about current behavior, rules, controls, dependencies, decisions, or recorded metrics.
- Use `search_memory` with `limit: 20` and a second distinct phrasing when the first result is empty or weak. Read decisive records with `get_memory`; use `trace_relationships` when dependencies matter.
- Use existing PRDs or specifications through `list_product_documents` and `get_product_document` to avoid contradictory or duplicate requirements.
- Search repositories only within the selected tenant's policy. Keep code-derived findings in a **Verify before building** section until a person confirms they are intended behavior.
- If material product intent is missing, ask one compact question. Group closely related choices instead of serially interrogating the user.

## 3. Draft with explicit epistemic boundaries

Classify source material while drafting:

- **Current confirmed context:** accepted, applicable Spur knowledge or explicit user facts.
- **Unconfirmed current behavior:** candidate knowledge or code observations; mark for verification.
- **Product intent:** requirements explicitly requested or approved by the user.
- **Proposal:** structure, thresholds, metrics, or delivery choices suggested by the agent; label them until accepted.
- **Unknown:** a decision that changes scope or acceptance and still needs an owner.

Do not expose internal memory IDs, confidence numbers, commits, filenames, or code excerpts in the main requirements document unless the user requests a technical appendix.

When visuals are useful, follow `references/visuals.md`. Check every diagram, screenshot, image, and mockup against the written scope and label whether it represents current behavior, a proposal, or an illustration.

## 4. Review before saving

Check that:

- the goal describes an outcome rather than a feature list;
- scope and out-of-scope do not conflict;
- requirements are individually testable;
- acceptance criteria cover the important paths and boundaries without restating every requirement;
- Definition of Done contains completion gates, not product behavior;
- permissions and tenant boundaries are explicit when relevant;
- non-functional targets have a measurement condition;
- assumptions and code-derived claims appear under **Verify before building**;
- visuals have a purpose, status label, caption, and text alternative, and do not contradict the requirements;
- open questions name the decision needed and, when known, its owner.

Show the draft and ask for approval before saving.

## 5. Save only with approval

- Use `create_product_document` for a new document and `update_product_document` for an approved replacement of an existing document.
- Set `document_type` to `prd` or `spec` as agreed.
- Link only relevant visible `mem_...` objects, up to the tool limit. Related objects provide context; they do not turn the draft into accepted truth.
- Preserve the selected Markdown sections in `content`.
- Preserve editable Mermaid source inline when the destination supports it. Use stable HTTPS image references for documents saved in Spur; local file paths are not portable to another MCP client.
- If the tool rejects the document for length, shorten repetition and low-value prose before dropping requirements or acceptance conditions.

Report what was saved, include the Product documents path returned by Spur, list which sections were included, and state which questions remain open. Do not claim the requirements are approved unless the user explicitly approved them as such.
