import { describe, expect, it } from "vitest";

import { TestMemoryStore as MemoryStore } from "./support/postgres";
import type { IsmsControlInput } from "@/core/isms-types";

const input: IsmsControlInput = {
  reference: "SEC-01",
  framework: "Internal security controls",
  framework_version: "2026",
  title: "Review privileged access",
  objective: "Privileged access is reviewed by an accountable owner.",
  owner: "Security team",
  applicability: "applicable",
  applicability_rationale: "Applies to production systems.",
  implementation_status: "not_assessed",
  review_due_on: "2026-12-31",
  evidence_references: [{ label: "Access review", locator: "GRC/access-review/2026-Q4" }],
  linked_memory_ids: [],
};

describe("ISMS control catalog", () => {
  it("keeps draft, approval, edits, and archive as separate revisions", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const first = (await store.saveIsmsControl(input, "reviewer"));
      expect(first.governance_state).toBe("draft");
      expect(first.version).toBe(1);
      expect(first.evidence_references).toEqual(input.evidence_references);
      expect((await store.searchIsmsControls("privileged access")).map((item) => item.id)).toEqual([first.id]);
      const approved = (await store.changeIsmsControlState(first.id, "approved", "reviewer", 1));
      expect(approved.version).toBe(2);
      expect(approved.governance_state).toBe("approved");
      const edited = (await store.saveIsmsControl({ ...input, owner: "CISO" }, "editor", first.id, 2));
      expect(edited.version).toBe(3);
      expect(edited.governance_state).toBe("draft");
      expect((await store.listIsmsControlRevisions(first.id)).map((revision) => revision.version)).toEqual([3, 2, 1]);
      await expect(store.saveIsmsControl(input, "old editor", first.id, 1)).rejects.toThrow(/changed/);
      (await store.changeIsmsControlState(first.id, "archived", "reviewer", 3));
      expect((await store.listIsmsControls())).toEqual([]);
      expect((await store.listIsmsControlRevisions(first.id))).toHaveLength(4);
    } finally { (await store.close()); }
  });

  it("validates model links, unique references, and applicability before approval", async () => {
    const store = new MemoryStore(":memory:");
    try {
      await expect(store.saveIsmsControl({ ...input, linked_memory_ids: ["mem_missing"] }, "reviewer")).rejects.toThrow(/not found/);
      const technical = (await store.upsertMemory({
        kind: "control", title: "Access check", statement: "The application checks access before a privileged action.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
      }));
      const first = (await store.saveIsmsControl({ ...input, linked_memory_ids: [technical.id] }, "reviewer"));
      expect((await store.getIsmsControl(first.id))?.linked_memory_ids).toEqual([technical.id]);
      await expect(store.saveIsmsControl(input, "reviewer")).rejects.toThrow(/already exists/);
      const undecided = (await store.saveIsmsControl({ ...input, reference: "SEC-02", applicability: "undecided" }, "reviewer"));
      await expect(store.changeIsmsControlState(undecided.id, "approved", "reviewer", 1)).rejects.toThrow(/applicability/);
    } finally { (await store.close()); }
  });

  it("keeps control catalogs isolated between organizational stores", async () => {
    const first = new MemoryStore(":memory:");
    const second = new MemoryStore(":memory:");
    try {
      (await first.saveIsmsControl(input, "reviewer"));
      expect((await first.listIsmsControls())).toHaveLength(1);
      expect((await second.listIsmsControls())).toHaveLength(0);
    } finally { (await first.close()); (await second.close()); }
  });
});
