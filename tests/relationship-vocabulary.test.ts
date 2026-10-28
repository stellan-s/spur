import { describe, expect, it } from "vitest";

import { modeledEntityDefinitionSchema } from "../src/core/memory-types";
import { relationshipPredicateProblem } from "../src/core/relationship-vocabulary";

describe("relationship vocabulary", () => {
  it("accepts vocabulary predicates and names the replacement for known synonyms", () => {
    expect(relationshipPredicateProblem("governed_by", "process", "rule")).toBeNull();
    expect(relationshipPredicateProblem("belongs_to", "entity", "entity")).toBeNull();
    expect(relationshipPredicateProblem("governs", "rule", "process"))
      .toMatch(/use governed_by with the endpoints swapped/);
  });

  it("keeps entity predicates between entities", () => {
    expect(relationshipPredicateProblem("uses", "entity", "entity")).toMatch(/belongs_to or references/);
    expect(relationshipPredicateProblem("belongs_to", "process", "entity")).toMatch(/only valid between two entities/);
  });

  it("allows affects only from decisions", () => {
    expect(relationshipPredicateProblem("affects", "decision", "rule")).toBeNull();
    expect(relationshipPredicateProblem("affects", "observation", "rule")).toMatch(/concerns/);
  });
});

describe("modelled data locations", () => {
  const location = { system: "Portal database", storage_type: "postgresql_table", locator: "User" };

  it("requires a role", () => {
    expect(modeledEntityDefinitionSchema.safeParse({ data_locations: [location] }).success).toBe(false);
    expect(modeledEntityDefinitionSchema.safeParse({
      data_locations: [{ ...location, role: "system_of_record" }],
    }).success).toBe(true);
  });

  it("rejects a role written into storage_type", () => {
    expect(modeledEntityDefinitionSchema.safeParse({
      data_locations: [{ ...location, storage_type: "system_of_record: postgresql_table", role: "copy" }],
    }).success).toBe(false);
  });
});
