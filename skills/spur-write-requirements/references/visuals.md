# Visuals in requirements

## Decide whether a visual helps

Add a visual only when it makes scope, sequence, ownership, state, data, or layout easier to verify than prose alone. Do not add decorative images or repeat a simple list as a diagram.

Choose the smallest suitable form:

- **Flowchart:** user or business process with branches.
- **Sequence diagram:** ordered interaction across people, systems, or services.
- **Context diagram:** system boundary and external actors or dependencies.
- **Entity relationship diagram:** important business data and cardinality.
- **State diagram:** lifecycle and permitted transitions.
- **Wireframe:** layout, hierarchy, and interaction intent without visual polish.
- **Screenshot:** actual current behavior that needs explanation or comparison.
- **Mockup or generated image:** proposed experience or visual direction.

## Mark its epistemic status

Place one label in the title or caption:

- **Current:** supported by accepted Spur knowledge or verified current-system evidence.
- **Proposed:** part of the requested future behavior or a design proposal.
- **Illustrative:** explains a concept without specifying exact behavior or appearance.

Never label a generated image, inferred architecture, or mockup as Current. When a current-state diagram combines accepted and unconfirmed information, label it Illustrative and list what must be verified.

## Format and portability

- Prefer Mermaid for editable flows, sequences, entity relationships, state diagrams, and context diagrams when the destination supports Mermaid.
- Keep Mermaid node labels business-facing and stable. Do not expose secrets, internal IDs, file paths, or unnecessary code names.
- If Mermaid support is unknown, include a concise text fallback or render SVG/PNG while retaining the editable source beside file-based documents.
- For a Markdown file, use relative image paths only when the image will be delivered with the document.
- For a document saved in Spur, use only stable HTTPS image URLs in `![alt text](url)`. Spur does not upload a local image merely because its path appears in Markdown.
- Do not embed base64 images in product-document Markdown.

## Images, screenshots, and mockups

- Reuse a user-provided image when it is the source material. Do not edit it unless the user asks.
- Capture or cite a screenshot as evidence only when it comes from the actual current system and its relevant state is known.
- Clearly watermark or caption a generated mockup as Proposed or Illustrative.
- Remove or obscure personal data, credentials, tenant identifiers, and sensitive operational details before including a screenshot.
- Do not generate a high-fidelity interface when a low-fidelity wireframe communicates the requirement more accurately.

## Accessibility and review

Every visual needs:

- concise alt text describing its meaning, not its styling;
- a caption stating why it exists and whether it is Current, Proposed, or Illustrative;
- a nearby textual statement of the requirement or conclusion so the document remains usable without the image.

Before delivery, verify that names, arrows, directions, cardinalities, states, and boundaries agree with the written requirements. Treat any mismatch as a document defect, not a cosmetic issue.
