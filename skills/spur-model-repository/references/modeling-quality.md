# Modeling quality rubric

## Business wording

- Title a concept in sentence case using the tenant's model language.
- State what the organization or system does, retains, requires, or prevents.
- Do not describe code layout, framework mechanics, implementation quality, or author intent.
- Preserve canonical product names. Preserve exact technical identifiers only in technical fields and evidence.

## Capability coverage and aliases

- Reconstruct end-to-end product behavior across user interface, routes, services, integrations, and storage. A cross-cutting capability must not be missed merely because no single file names it directly.
- Keep one stable canonical title for each business concept.
- Add an alias only when committed evidence explicitly supports that alternate business or product term. Give the alias its own smallest exact excerpt.
- Do not use code identifiers, route names, filenames, or speculative synonyms as aliases.
- Repository-derived aliases remain reviewable proposals. They improve retrieval but do not independently verify the capability.

## Confidence

Use confidence consistently:

- `0.90–0.99`: the claim is explicit and corroborated by direct code plus a relevant test or independent committed source.
- `0.80–0.89`: one direct committed source clearly establishes the claim.
- `0.65–0.79`: several committed facts jointly support a limited inference; phrase the statement narrowly.
- Below `0.65`: do not create an object. Report a knowledge gap or ambiguity instead.

Confidence measures evidence support, not software quality or control effectiveness.

## Completeness

A repository baseline is complete when:

- every layer returned by the runtime contract was deliberately examined;
- supported objects have minimal verified evidence;
- supported direct relationships were proposed in the declared direction;
- cross-cutting capabilities were checked across their complete user and data flow;
- evidenced alternate business terms were proposed as aliases instead of duplicate objects;
- entities include only evidenced attributes, locations, roles, and cardinalities;
- existing memory was reused where the same business concept already existed;
- unsupported business rationale, ownership, decisions, and off-repository behavior are reported as gaps.

The baseline may still contain candidates, low-confidence items, disconnected objects, and organizational knowledge gaps. Say so plainly.
