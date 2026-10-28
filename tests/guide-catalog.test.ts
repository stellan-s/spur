import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuideModelReference } from "@/components/guide-model-reference";
import { memoryKindSchema } from "@/core/memory-types";
import { CATALOG_EXPLANATIONS, MODEL_REFERENCES } from "@/lib/guide-catalog";

describe("guide model reference", () => {
  it("explains every catalog object type", () => {
    expect(Object.keys(CATALOG_EXPLANATIONS).sort()).toEqual([...memoryKindSchema.options].sort());
    for (const explanation of Object.values(CATALOG_EXPLANATIONS)) {
      expect(explanation.label).not.toBe("");
      expect(explanation.question).toMatch(/\?$/);
      expect(explanation.meaning.length).toBeGreaterThan(30);
      expect(explanation.purpose.length).toBeGreaterThan(30);
      expect(explanation.example.length).toBeGreaterThan(30);
    }
  });

  it("provides direct HTTPS references for each type and supporting concept", () => {
    const references = [...Object.values(CATALOG_EXPLANATIONS).map((item) => item.reference), ...Object.values(MODEL_REFERENCES)];
    for (const reference of references) {
      const url = new URL(reference.href);
      expect(url.protocol).toBe("https:");
      expect(["en.wikipedia.org", "www.iso.org"]).toContain(url.hostname);
      expect(url.pathname).not.toBe("/");
      expect(reference.title).not.toBe("");
    }
  });

  it("renders model concepts, labeled examples, and organization-specific catalog links", () => {
    const html = renderToStaticMarkup(createElement(GuideModelReference, { basePath: "/o/example" }));
    expect(html).toContain("What is an information model?");
    expect(html).toContain("not saved catalog entries");
    expect(html).toContain("Information Security Management System");
    expect(html).toContain("does not establish certification");
    for (const term of ["Attribute", "Relationship", "Cardinality", "Information classification", "Data location"]) {
      expect(html).toContain(`<dt class="font-medium">${term}</dt>`);
    }
    for (const kind of memoryKindSchema.options) {
      expect(html).toContain(`id="guide-kind-${kind}"`);
      expect(html).toContain(`href="/o/example/model/catalog?kind=${kind}"`);
      expect(html).toContain(`href="${CATALOG_EXPLANATIONS[kind].reference.href}"`);
    }
    expect(html).toContain('href="/o/example/isms/controls"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    for (const id of ["guide-information-model", "guide-catalog-types", "guide-relationships", "guide-isms"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});
