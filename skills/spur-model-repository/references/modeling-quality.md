# Modeling quality rubric

## Business wording

- Title a concept in sentence case using the tenant's model language.
- State what the organization or system does, retains, requires, or prevents.
- Do not describe code layout, framework mechanics, implementation quality, or author intent.
- Preserve canonical product names. Preserve exact technical identifiers only in technical fields and evidence.

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
- entities include only evidenced attributes, locations, roles, and cardinalities;
- existing memory was reused where the same business concept already existed;
- unsupported business rationale, ownership, decisions, and off-repository behavior are reported as gaps.

The baseline may still contain candidates, low-confidence items, disconnected objects, and organizational knowledge gaps. Say so plainly.
