import { describe, expect, it } from "vitest";

import { productDocumentInputSchema } from "@/core/product-document";

describe("product-document input", () => {
  it("accepts a delivery-ready PRD with optional requirements sections", () => {
    const content = [
      "# Partner overview",
      "## Problem",
      "Partners cannot review all clients in one place.",
      "## Acceptance criteria",
      ...Array.from({ length: 100 }, (_, index) => `${index + 1}. Criterion ${index + 1} is observable and testable.`),
      "## Proposed Definition of Done",
      "- Authorization tests pass.",
    ].join("\n");

    expect(content.length).toBeGreaterThan(4_000);
    expect(productDocumentInputSchema.parse({
      document_type: "prd",
      title: "Partner overview",
      content,
      related_ids: [],
    }).content).toBe(content);
  });
});
