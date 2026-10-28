import { describe, expect, it, vi } from "vitest";

import { TestMemoryStore as MemoryStore } from "./support/postgres";

describe("organizational memory store", () => {
  it("merges duplicate catalog objects without losing evidence or relationships", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const target = (await store.upsertMemory({
        kind: "rule", title: "Budget approval", statement: "Large budget changes require approval.",
        state: "accepted", authority: "person", confidence: 1,
        subjects: ["budget"], evidenceIds: ["ev_target"], sourceIds: ["src_target"],
      }));
      const source = (await store.upsertMemory({
        kind: "rule", title: "Budget change rule", statement: "Budget increases need manager approval.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
        subjects: ["approval"], evidenceIds: ["ev_source"], sourceIds: ["src_source"],
      }));
      const process = (await store.upsertMemory({
        kind: "process", title: "Budget planning", statement: "Budget planning prepares project spending.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
      }));
      const system = (await store.upsertMemory({
        kind: "system", title: "Budget service", statement: "Budget service records project spending.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
      }));
      (await store.link(source.id, "constrains", process.id, { source: "original" }));
      (await store.link(target.id, "constrains", process.id, { source: "target" }));
      (await store.link(system.id, "implements", source.id));

      const merged = (await store.mergeMemory(source.id, target.id, "Test architect"));
      expect(merged.title).toBe("Budget approval");
      expect(merged.statement).toBe(target.statement);
      expect(merged.state).toBe("accepted");
      expect(merged.subjects).toEqual(["budget", "approval"]);
      expect(merged.evidence_ids).toEqual(["ev_target", "ev_source"]);
      expect(merged.source_ids).toEqual(["src_target", "src_source"]);
      expect(merged.metadata.merged_from_ids).toEqual([source.id]);
      expect((await store.listAllMemory()).map((item) => item.id)).not.toContain(source.id);
      expect((await store.getMemory(source.id))?.metadata.merged_into_id).toBe(target.id);
      expect((await store.listRelationships(target.id))).toHaveLength(2);
      expect((await store.listRelationships(target.id)).find((item) => item.predicate === "constrains")?.metadata.source).toBe("target");
      expect((await store.listRelationships(target.id)).find((item) => item.predicate === "implements")?.from_id).toBe(system.id);

      const reingested = (await store.upsertMemory({
        kind: "rule", title: source.title, statement: source.statement,
        state: "candidate", authority: "ai_inference", confidence: 0.8,
        evidenceIds: ["ev_new"], sourceIds: ["src_new"],
      }));
      expect(reingested.id).toBe(target.id);
      expect(reingested.evidence_ids).toEqual(["ev_target", "ev_source", "ev_new"]);
      expect((await store.getMemory(source.id))?.metadata.deleted_at).toBeDefined();
    } finally {
      (await store.close());
    }
  });

  it("rolls back an entity merge when classifications conflict", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const target = (await store.upsertMemory({
        kind: "entity", title: "Campaign budget", statement: "Campaign budget tracks spending.",
        state: "accepted", authority: "person", confidence: 1,
        metadata: { entity_definition: { information_classification: "internal", attributes: [], data_locations: [] } },
      }));
      const source = (await store.upsertMemory({
        kind: "entity", title: "Budget", statement: "Budget stores planned campaign spend.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
        metadata: { entity_definition: { information_classification: "confidential", attributes: [], data_locations: [] } },
      }));
      await expect(store.mergeMemory(source.id, target.id, "Test architect"))
        .rejects.toThrow("classifications conflict");
      expect((await store.getMemory(source.id))?.metadata.deleted_at).toBeUndefined();
      expect((await store.getMemory(target.id))?.metadata.merged_from_ids).toBeUndefined();
    } finally {
      (await store.close());
    }
  });

  it("combines non-conflicting entity attributes and storage locations", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const target = (await store.upsertMemory({
        kind: "entity", title: "Campaign", statement: "Campaign stores advertising settings.",
        state: "accepted", authority: "person", confidence: 1,
        metadata: { entity_definition: { information_classification: "internal",
          attributes: [{ name: "id", data_type: "string", identifier: true }],
          data_locations: [{ system: "Portal", storage_type: "PostgreSQL", locator: "campaigns" }] } },
      }));
      const source = (await store.upsertMemory({
        kind: "entity", title: "Campaign record", statement: "Campaign record holds budget details.",
        state: "candidate", authority: "ai_inference", confidence: 0.8,
        metadata: { entity_definition: { information_classification: "internal",
          attributes: [{ name: "budget", data_type: "decimal" }],
          data_locations: [{ system: "API", storage_type: "PostgreSQL", locator: "campaign_budget" }] } },
      }));
      const merged = (await store.mergeMemory(source.id, target.id, "Test architect"));
      const definition = merged.metadata.entity_definition as {
        attributes: Array<{ name: string }>;
        data_locations: Array<{ locator: string }>;
      };
      expect(definition.attributes.map((attribute) => attribute.name)).toEqual(["id", "budget"]);
      expect(definition.data_locations.map((location) => location.locator)).toEqual(["campaigns", "campaign_budget"]);
    } finally {
      (await store.close());
    }
  });

  it("stores searchable memory and typed relationships", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const source = (await store.upsertSource({
        kind: "repository",
        name: "payments",
        locator: "payments",
        status: "connected",
      }));
      const application = (await store.upsertMemory({
        kind: "application",
        title: "Payments",
        statement: "Payments handles customer refunds.",
        state: "accepted",
        authority: "system",
        confidence: 1,
        sourceIds: [source.id],
      }));
      const rule = (await store.upsertMemory({
        kind: "rule",
        title: "Refund approval",
        statement: "Refunds above the threshold require manager approval.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.82,
        sourceIds: [source.id],
      }));
      const relationship = (await store.link(application.id, "implements", rule.id, {
        cardinality: "one_to_many",
      }));

      expect((await store.searchMemory("refund manager")).map((item) => item.id)).toContain(rule.id);
      expect((await store.listRelationships(application.id))).toEqual([relationship]);
      expect(relationship.metadata).toEqual({ cardinality: "one_to_many" });
      expect((await store.counts())).toEqual({ memory: 2, sources: 1, candidates: 1 });
    } finally {
      (await store.close());
    }
  });

  it("lists older relationships after more than 200 links have been stored", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const from = (await store.upsertMemory({
        kind: "system",
        title: "Campaign system",
        statement: "The campaign system manages campaign planning.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
      }));
      const to = (await store.upsertMemory({
        kind: "process",
        title: "Campaign planning",
        statement: "Campaign planning prepares a campaign for launch.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
      }));
      const oldest = (await store.link(from.id, "supports", to.id));
      for (let index = 0; index < 200; index += 1) {
        (await store.link(from.id, `related_to_${index}`, to.id));
      }

      expect((await store.listRelationships())).toHaveLength(201);
      expect((await store.listRelationships()).map((item) => item.id)).toContain(oldest.id);
    } finally {
      (await store.close());
    }
  });

  it("finds and lists old memory after many newer objects", async () => {
    const store = new MemoryStore(":memory:");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const oldRule = (await store.upsertMemory({
        kind: "rule",
        title: "Refund approval",
        statement: "Refunds above the threshold require manager approval.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
      }));
      for (let index = 0; index < 250; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 2, 0, 0, index)));
        (await store.upsertMemory({
          kind: "observation",
          title: `Newer observation ${index}`,
          statement: `Observation number ${index} about shipping labels.`,
          state: "candidate",
          authority: "ai_inference",
          confidence: 0.8,
        }));
      }

      expect((await store.searchMemory("refund manager approval")).map((item) => item.id))
        .toContain(oldRule.id);
      expect((await store.listAllMemory())).toHaveLength(251);
      expect((await store.listAllMemory(["rule"])).map((item) => item.id)).toEqual([oldRule.id]);
    } finally {
      vi.useRealTimers();
      (await store.close());
    }
  });

  it("searches entity attributes, classifications, and data locations", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const entity = (await store.upsertMemory({
        kind: "entity",
        title: "Campaign budget",
        statement: "The campaign budget records optimization limits.",
        state: "accepted",
        authority: "person",
        confidence: 1,
        metadata: {
          entity_definition: {
            technical_name: "CampaignBudget",
            information_classification: "internal",
            attributes: [{
              name: "customerBudgetLimit",
              data_type: "decimal",
              information_classification: "confidential",
            }],
            data_locations: [{
              system: "Northstar API",
              storage_type: "PostgreSQL",
              locator: "campaign_budget",
              environment: "production",
            }],
          },
        },
      }));

      expect((await store.searchMemory("customer budget limit")).map((item) => item.id)).toContain(entity.id);
      expect((await store.searchMemory("confidential PostgreSQL")).map((item) => item.id)).toContain(entity.id);
    } finally {
      (await store.close());
    }
  });

  it("deduplicates the same memory statement", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const first = (await store.upsertMemory({
        kind: "decision",
        title: "Identity master",
        statement: "CRM is the customer identity master.",
        state: "accepted",
        authority: "person",
        confidence: 1,
      }));
      const second = (await store.upsertMemory({
        kind: "decision",
        title: "Customer identity master",
        statement: "CRM is the customer identity master.",
        state: "accepted",
        authority: "person",
        confidence: 1,
      }));

      expect(second.id).toBe(first.id);
      expect((await store.counts()).memory).toBe(1);
      expect((await store.getMemory(first.id))?.title).toBe("Customer identity master");
    } finally {
      (await store.close());
    }
  });

  it("does not recall memory that only overlaps on common question words", async () => {
    const store = new MemoryStore(":memory:");
    try {
      (await store.upsertMemory({
        kind: "rule",
        title: "What are the rules for setting a budget on a project and which platforms can I connect?",
        statement: "Project settings require platform authorization and account selection.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.82,
      }));

      expect(
        (await store.searchMemory("What are the rules for setting a budget on a project?")),
      ).toEqual([]);
    } finally {
      (await store.close());
    }
  });

  it("recalls memory learned from the exact same question", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const memory = (await store.upsertMemory({
        kind: "rule",
        title: "Budget validation finding",
        statement: "Daily amounts must be positive.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.82,
      }));
      (await store.saveInvestigation({
        question: "What are the rules for setting a budget on a project?",
        answer: "Daily amounts must be positive.",
        analysis: {},
        recalledMemoryIds: [],
        learnedMemoryIds: [memory.id],
      }));

      expect(
        (await store.searchMemory("What are the rules for setting a budget on a project?")),
      ).toEqual([memory]);
    } finally {
      (await store.close());
    }
  });

  it("keeps repository provenance when the active checkout changes", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const previous = (await store.upsertSource({
        id: "src_configured_repository",
        kind: "repository",
        name: "Previous app",
        locator: "https://example.com/previous.git",
        status: "connected",
        metadata: { active: true, commit_sha: "previous" },
      }));
      const active = (await store.upsertSource({
        kind: "repository",
        name: "Current app",
        locator: "https://example.com/current.git",
        status: "connected",
        metadata: { active: true, commit_sha: "current" },
      }));

      (await store.markRepositoryActive(active.id));

      expect((await store.getSource(previous.id))).toMatchObject({
        name: "Previous app",
        status: "configured",
        enabled: false,
      });
      expect((await store.getSource(active.id))).toMatchObject({
        name: "Current app",
        status: "connected",
        enabled: true,
      });
    } finally {
      (await store.close());
    }
  });

  it("stores conversations as ordered investigation turns", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const conversation = (await store.createConversation({
        title: "Shipping address rules",
        repositoryCommitSha: "abc123",
        createdBy: "usr_owner",
      }));
      const first = (await store.saveInvestigation({
        conversationId: conversation.id,
        question: "When can an address change?",
        answer: "Before dispatch.",
        analysis: {},
        recalledMemoryIds: [],
        learnedMemoryIds: [],
      }));
      const second = (await store.saveInvestigation({
        conversationId: conversation.id,
        question: "Why?",
        answer: "The dispatched order is locked.",
        analysis: {},
        recalledMemoryIds: [],
        learnedMemoryIds: [],
      }));

      expect((await store.listConversations("usr_other"))).toEqual([]);
      expect((await store.getConversation(conversation.id, "usr_other"))).toBeNull();
      expect((await store.listConversations("usr_owner"))).toMatchObject([{
        id: conversation.id,
        title: "Shipping address rules",
        repository_commit_sha: "abc123",
        turn_count: 2,
      }]);
      expect((await store.getConversation(conversation.id, "usr_owner"))?.investigationIds).toEqual([
        first.id,
        second.id,
      ]);
      expect((await store.getInvestigation(second.id))?.question).toBe("Why?");
    } finally {
      (await store.close());
    }
  });

  it("hides recoverably deleted memory from listings and counts", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const memory = (await store.upsertMemory({
        kind: "rule",
        title: "Budget guardrail",
        statement: "Large budget changes require approval.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.82,
      }));
      (await store.updateMemory(memory.id, {
        state: "stale",
        metadata: { deleted_at: "2026-10-18T12:00:00.000Z" },
      }));

      expect((await store.getMemory(memory.id))?.metadata.deleted_at).toBeDefined();
      expect((await store.listMemory())).toEqual([]);
      expect((await store.counts())).toEqual({ memory: 0, sources: 0, candidates: 0 });
    } finally {
      (await store.close());
    }
  });
});
