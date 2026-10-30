import path from "node:path";
import { describe, expect, it } from "vitest";

import { BETA_NOTICE_ENGLISH } from "@/core/beta-notice";

import { TestMemoryStore as MemoryStore } from "./support/postgres";
import { GitRepository } from "@/core/repository";
import {
  isRestrictedMemory,
  maskRestrictedMemory,
  RESTRICTED_MESSAGE,
} from "@/core/security-disclosure";
import { SpurService } from "@/core/spur-service";
import type { AnalysisAdapter } from "@/core/types";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";

const forbiddenAdapter: AnalysisAdapter = {
  provider: "none",
  async analyze() {
    throw new Error("Restricted memory must not reach the model.");
  },
};

describe("restricted security controls", () => {
  it("masks every service read while preserving verified evidence and relationships internally", async () => {
    const store = new MemoryStore(":memory:");
    const repository = new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
    const service = new SpurService(
      repository,
      store,
      forbiddenAdapter,
      "none",
      "Security architect",
      process.cwd(),
      { slug: "test", name: "Test" },
      [],
      "ask",
      undefined,
      "Security team",
    );
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const candidate = search.candidates.find((item) => item.path === "src/orders.ts");
      expect(candidate).toBeDefined();
      const evidence = {
        kind: candidate!.kind === "test" ? "test" as const : "code" as const,
        path: candidate!.path,
        start_line: candidate!.startLine,
        end_line: candidate!.endLine,
        excerpt: candidate!.excerpt,
      };
      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "restricted-shipping-control",
        client_name: "Claude Code",
      });
      const proposed = await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [
          {
            external_id: "shipping-control",
            kind: "control",
            title: "Shipping address dispatch guard",
            statement: "Shipping address changes use a sensitive dispatch-state check.",
            sensitivity: "restricted",
            subjects: ["shipping secret", "dispatch"],
            confidence: 0.9,
            evidence: [evidence],
          },
          {
            external_id: "shipping-capability",
            kind: "capability",
            title: "Shipping address management",
            statement: "An order's shipping address can be managed before dispatch.",
            subjects: ["shipping"],
            confidence: 0.9,
            evidence: [evidence],
          },
        ],
      });
      const [control, capability] = proposed.items;
      const raw = (await store.getMemory(control.id))!;
      expect(raw.metadata.sensitivity).toBe("restricted");
      expect(raw.metadata.evidence_status).toBe("verified");
      expect(raw.evidence_ids).toHaveLength(1);
      expect((await store.getEvidence(raw.evidence_ids[0]))?.excerpt).toBe(evidence.excerpt);
      const reingested = (await store.upsertMemory({
        kind: raw.kind,
        title: raw.title,
        statement: raw.statement,
        state: raw.state,
        authority: raw.authority,
        confidence: raw.confidence,
        sourceVersion: raw.source_version,
        metadata: {},
      }));
      expect(reingested.evidence_ids).toContain(raw.evidence_ids[0]);
      expect(reingested.metadata).toMatchObject({
        sensitivity: "restricted",
        evidence_status: "verified",
      });
      expect(control).toEqual(maskRestrictedMemory(raw, "Security team"));

      await expect(service.proposeMemoryObjects({
        run_id: run.id,
        objects: [{
          external_id: "bad-control",
          kind: "control",
          title: "Unverified control",
          statement: "This excerpt is not in the source.",
          sensitivity: "restricted",
          confidence: 0.9,
          subjects: [],
          evidence: [{ ...evidence, excerpt: "not the actual code" }],
        }],
      })).rejects.toThrow();

      const linked = (await service.proposeRelationships({
        run_id: run.id,
        relationships: [{
          from_external_id: "shipping-control",
          predicate: "part_of",
          to_external_id: "shipping-capability",
        }],
      }));
      expect(linked.relationships).toHaveLength(1);
      const sensitiveLink = (await store.link(control.id, "checks_private_signature", capability.id, {
        internal_attribute: "signature_secret",
      }));

      const accepted = (await service.promoteMemory(control.id));
      expect(accepted.state).toBe("accepted");
      expect(isRestrictedMemory((await store.getMemory(control.id))!)).toBe(true);
      const expected = {
        id: control.id,
        kind: "control",
        state: "accepted",
        authority: "person",
        confidence: 1,
        title: "Restricted security control",
        statement: "A security control exists here. Its details are restricted. Ask Security team.",
        subjects: [],
        evidence_ids: [],
        source_ids: [],
        source_version: null,
        actor: null,
        metadata: { sensitivity: "restricted" },
      };
      expect((await service.getMemory(control.id))).toMatchObject(expected);
      expect((await service.getMemory(control.id))?.created_at).toBe(raw.created_at);
      expect((await service.getMemory(control.id))?.updated_at).toBe((await store.getMemory(control.id))?.updated_at);
      expect((await service.searchMemory("shipping address dispatch guard"))).toContainEqual(
        expect.objectContaining(expected),
      );
      expect((await service.workspace()).memory).toContainEqual(expect.objectContaining(expected));
      expect((await service.workspace()).relationships.find((item) => item.id === sensitiveLink.id))
        .toMatchObject({ predicate: "related_to", metadata: {} });
      const traced = (await service.traceRelationships("shipping address dispatch guard"));
      expect([...traced.matches, ...traced.related]).toContainEqual(expect.objectContaining(expected));
      expect(traced.relationships.some((item) => item.from_id === control.id &&
        item.to_id === capability.id)).toBe(true);
      expect(traced.relationships.find((item) => item.id === sensitiveLink.id))
        .toMatchObject({ predicate: "related_to", metadata: {} });
      expect((await service.getMemoryDetail(control.id))).toMatchObject({
        item: expected,
        evidence: [],
        related: [expect.objectContaining({ id: capability.id })],
      });
      expect((await service.getEvidence(raw.evidence_ids[0]))).toBeNull();

      const host = await service.prepareHostInvestigation(
        "How are shipping address changes protected?",
        { searchCode: true },
      );
      expect([...host.recalled_memory, ...host.related_memory]).toContainEqual(
        expect.objectContaining(expected),
      );
      expect(host.memory_evidence).toEqual([]);
      expect(host.repository_evidence).toEqual([]);
      expect(host.relationships.find((item) => item.id === sensitiveLink.id))
        .toMatchObject({ predicate: "related_to", metadata: {} });
      expect(host.answering_instructions.join(" ")).toContain("Ask Security team");
      expect(host.answering_instructions.join(" ")).toContain("Do not infer");
      expect((await service.searchRepository("shipping address dispatch")).candidates).toEqual([]);

      expect((await service.searchRepository("delivered")).candidates
        .some((item) => item.path === "src/orders.ts")).toBe(false);

      const answer = await service.investigate("How are shipping address changes protected?");
      expect(answer.answer).toBe(`${expected.statement}\n\n${BETA_NOTICE_ENGLISH}`);
      expect(answer.analysis.evidence).toEqual([]);
      expect(answer.recalled_memory).toContainEqual(expect.objectContaining(expected));

      const edited = (await service.editMemory(control.id, {
        action: "edit",
        kind: "control",
        title: "Updated sensitive shipping control",
        statement: raw.statement,
        subjects: ["sensitive shipping"],
      }));
      expect(edited).toMatchObject(expected);
      expect((await store.getMemory(control.id))?.metadata.sensitivity).toBe("restricted");
      const appended = await service.addEvidence({
        run_id: run.id,
        memory_id: control.id,
        evidence: [evidence],
      });
      expect(appended.evidence_ids).toEqual([]);
      expect((await store.getMemory(control.id))!.evidence_ids.length).toBeGreaterThan(0);
      expect((await service.getMemory(capability.id))).toEqual((await store.getMemory(capability.id)));
      (await service.archiveMemory(control.id, control.id));
      expect((await service.getEvidence(raw.evidence_ids[0]))).toBeNull();
      expect((await service.searchRepository("shipping address dispatch")).candidates).toEqual([]);
    } finally {
      (await service.close());
    }
  });

  it("restricts an existing object through an edit", async () => {
    const store = new MemoryStore(":memory:");
    const service = new SpurService(repositoryForTest(), store, forbiddenAdapter, "none", "Test");
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const candidate = search.candidates.find((item) => item.path === "src/orders.ts")!;
      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "restrict-by-edit",
        client_name: "Claude Code",
      });
      const [control] = (await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [{
          external_id: "plain-control",
          kind: "control",
          title: "Shipping address dispatch guard",
          statement: "Shipping address changes are checked before dispatch.",
          subjects: ["shipping"],
          confidence: 0.9,
          evidence: [{
            kind: "code",
            path: candidate.path,
            start_line: candidate.startLine,
            end_line: candidate.endLine,
            excerpt: candidate.excerpt,
          }],
        }],
      })).items;
      expect((await service.getMemory(control.id))?.title).toBe("Shipping address dispatch guard");
      const edited = (await service.editMemory(control.id, {
        action: "edit",
        kind: "control",
        title: control.title,
        statement: control.statement,
        subjects: control.subjects,
        sensitivity: "restricted",
      }));
      expect(edited.title).toBe("Restricted security control");
      expect(isRestrictedMemory((await store.getMemory(control.id))!)).toBe(true);
      expect((await store.getMemory(control.id))?.statement).toBe("Shipping address changes are checked before dispatch.");
    } finally {
      (await service.close());
    }
  });

  it("masks entity metadata and leaves unrestricted memory unchanged", async () => {
    const store = new MemoryStore(":memory:");
    const entity = (await store.upsertMemory({
      kind: "entity",
      title: "Sensitive token record",
      statement: "A private field stores a token secret.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      subjects: ["token secret"],
      metadata: {
        sensitivity: "restricted",
        entity_definition: { attributes: [{ name: "secret" }] },
        external_id: "private-run-id",
      },
    }));
    const ordinary = (await store.upsertMemory({
      kind: "capability",
      title: "Order management",
      statement: "Orders can be managed.",
      state: "accepted",
      authority: "person",
      confidence: 1,
    }));
    const service = new SpurService(repositoryForTest(), store, forbiddenAdapter, "none", "Test");
    try {
      expect((await service.getMemory(entity.id))).toMatchObject({
        title: "Restricted entity",
        statement: RESTRICTED_MESSAGE,
        subjects: [],
        evidence_ids: [],
        metadata: { sensitivity: "restricted" },
      });
      expect((await service.getMemory(entity.id))?.metadata).toEqual({ sensitivity: "restricted" });
      expect((await service.getMemory(ordinary.id))).toEqual(ordinary);
    } finally {
      (await service.close());
    }
  });

  it("unmasks restricted details only with restricted.read", async () => {
    const organization = `restricted-permission-${Date.now()}`;
    const writer = new MemoryStore(":memory:", organization);
    const restricted = await writer.upsertMemory({
      kind: "control",
      title: "Private request control",
      statement: "Requests use a private verification sequence.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      metadata: { sensitivity: "restricted" },
    });
    await writer.close();

    const reader = new SpurService(
      repositoryForTest(), new MemoryStore(":memory:", organization), forbiddenAdapter,
      "none", "reader", process.cwd(), { slug: organization, name: organization },
      [], "off", undefined, undefined, { restrictedRead: false, restrictedWrite: false },
    );
    const securityOwner = new SpurService(
      repositoryForTest(), new MemoryStore(":memory:", organization), forbiddenAdapter,
      "none", "security-owner", process.cwd(), { slug: organization, name: organization },
      [], "off", undefined, undefined, { restrictedRead: true, restrictedWrite: true },
    );
    try {
      expect((await reader.getMemory(restricted.id))?.title).toBe("Restricted security control");
      expect(await securityOwner.getMemory(restricted.id)).toMatchObject({
        title: restricted.title,
        statement: restricted.statement,
        metadata: { sensitivity: "restricted" },
      });
    } finally {
      await reader.close();
      await securityOwner.close();
    }
  });

  it("hides restricted observations from readers without restricted.read", async () => {
    const organization = `restricted-finding-${Date.now()}`;
    const store = new MemoryStore(":memory:", organization);
    const finding = await store.upsertMemory({
      kind: "observation",
      title: "Private request handling gap",
      statement: "Private request handling has an open gap.",
      state: "candidate",
      authority: "ai_inference",
      confidence: 0.8,
      metadata: { sensitivity: "restricted" },
    });
    const control = await store.upsertMemory({
      kind: "control",
      title: "Private request control",
      statement: "Private request handling uses a verification sequence.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      metadata: { sensitivity: "restricted" },
    });
    const reader = new SpurService(
      repositoryForTest(), store, forbiddenAdapter, "none", "reader", process.cwd(),
      { slug: organization, name: organization }, [], "off", undefined, undefined,
      { restrictedRead: false, restrictedWrite: false },
    );
    const securityOwner = new SpurService(
      repositoryForTest(), new MemoryStore(":memory:", organization), forbiddenAdapter,
      "none", "security-owner", process.cwd(), { slug: organization, name: organization },
      [], "off", undefined, undefined, { restrictedRead: true, restrictedWrite: true },
    );
    try {
      expect(await reader.getMemory(finding.id)).toBeNull();
      const ids = (await reader.searchMemory("private request handling")).map((item) => item.id);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(finding.id);
      expect((await reader.workspace()).memory.map((item) => item.id)).not.toContain(finding.id);
      const host = await reader.prepareHostInvestigation("How is private request handling protected?");
      expect([...host.recalled_memory, ...host.related_memory].map((item) => item.id))
        .not.toContain(finding.id);
      expect(host.answering_instructions.join(" ")).toContain("complete, partial, effective");
      expect((await securityOwner.getMemory(finding.id))?.title).toBe(finding.title);
    } finally {
      await reader.close();
      await securityOwner.close();
    }
  });

  it("allows a security owner to ask questions that recall restricted memory", async () => {
    const organization = `restricted-ask-${Date.now()}`;
    const store = new MemoryStore(":memory:", organization);
    const restricted = await store.upsertMemory({
      kind: "control",
      title: "Private request control",
      statement: "Requests use a private verification sequence.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      metadata: { sensitivity: "restricted" },
    });
    const service = new SpurService(
      repositoryForTest(), store, new EvidenceTestAdapter(), "openai", "security-owner",
      process.cwd(), { slug: organization, name: organization }, [], "off", undefined,
      undefined, { restrictedRead: true, restrictedWrite: true },
    );
    try {
      const result = await service.investigate("How do requests use a private verification sequence?");
      expect(result.answer).not.toBe(RESTRICTED_MESSAGE);
      expect(result.recalled_memory).toContainEqual(expect.objectContaining({
        id: restricted.id,
        title: restricted.title,
        statement: restricted.statement,
      }));
    } finally {
      await service.close();
    }
  });

  it("answers an ordinary question from unrestricted memory when restricted results also rank", async () => {
    const organization = `mixed-ask-${Date.now()}`;
    const store = new MemoryStore(":memory:", organization);
    const ordinary = await store.upsertMemory({
      kind: "capability",
      title: "Northstar Commerce campaign management",
      statement: "Northstar Commerce manages advertising campaigns.",
      state: "accepted",
      authority: "person",
      confidence: 1,
    });
    const restricted = await store.upsertMemory({
      kind: "control",
      title: "Northstar Commerce private signing control",
      statement: "Northstar Commerce uses a private signing control for service calls.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      metadata: { sensitivity: "restricted" },
    });
    const delegate = new EvidenceTestAdapter();
    let receivedMemoryIds: string[] = [];
    const adapter: AnalysisAdapter = {
      provider: "openai",
      async analyze(input) {
        receivedMemoryIds = input.memoryContext?.items.map((item) => item.id) ?? [];
        return delegate.analyze(input);
      },
    };
    const service = new SpurService(
      repositoryForTest(), store, adapter, "openai", "reader",
      process.cwd(), { slug: organization, name: organization }, [], "off", undefined,
      undefined, { restrictedRead: false, restrictedWrite: false },
    );
    try {
      const result = await service.investigate("What does Northstar do?");
      expect(result.answer).not.toBe(RESTRICTED_MESSAGE);
      expect(receivedMemoryIds).toContain(ordinary.id);
      expect(receivedMemoryIds).not.toContain(restricted.id);
      expect(result.recalled_memory.map((item) => item.id)).toContain(ordinary.id);
      expect(result.recalled_memory.map((item) => item.id)).not.toContain(restricted.id);

      const host = await service.prepareHostInvestigation("What does Northstar do?");
      expect(host.recalled_memory.map((item) => item.id)).toContain(ordinary.id);
      expect(host.recalled_memory.map((item) => item.id)).not.toContain(restricted.id);
      expect(host.answering_instructions.join(" ")).not.toContain("Say only that a security control exists");
    } finally {
      await service.close();
    }
  });

  it("does not drop restriction on re-ingest or merge", async () => {
    const store = new MemoryStore(":memory:");
    try {
      const restricted = (await store.upsertMemory({
        kind: "control",
        title: "Private control",
        statement: "A private control protects requests.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
        metadata: { sensitivity: "restricted" },
      }));
      const repeated = (await store.upsertMemory({
        kind: "control",
        title: "Re-ingested control",
        statement: "A private control protects requests.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
        metadata: {},
      }));
      expect(repeated.id).toBe(restricted.id);
      expect(repeated.metadata.sensitivity).toBe("restricted");

      const target = (await store.upsertMemory({
        kind: "control",
        title: "Public control",
        statement: "A different control protects requests.",
        state: "accepted",
        authority: "person",
        confidence: 1,
      }));
      const merged = (await store.mergeMemory(restricted.id, target.id, "Security owner"));
      expect(merged.metadata.sensitivity).toBe("restricted");
    } finally {
      (await store.close());
    }
  });
});

function repositoryForTest(): GitRepository {
  return new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
}
