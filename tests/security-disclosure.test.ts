import path from "node:path";
import { describe, expect, it } from "vitest";

import { AnalysisService } from "@/core/analysis";
import { BETA_NOTICE_ENGLISH } from "@/core/beta-notice";
import { TestMemoryStore as MemoryStore } from "./support/postgres";
import { GitRepository } from "@/core/repository";
import {
  containsSecurityIssue,
  isSecurityIssueMemory,
  requestsSecurityIssues,
  SECURITY_WITHHELD_MESSAGE,
} from "@/core/security-disclosure";
import { SpurService } from "@/core/spur-service";
import type { AnalysisAdapter } from "@/core/types";

const repository = () => new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
const forbiddenAdapter: AnalysisAdapter = {
  provider: "none",
  async analyze() {
    throw new Error("A withheld question must not reach the model.");
  },
};

describe("security finding disclosure guard", () => {
  it("distinguishes a normal control from a security finding", async () => {
    expect(requestsSecurityIssues("What security vulnerabilities exist?")).toBe(true);
    expect(requestsSecurityIssues("Which permission checks are missing?")).toBe(true);
    expect(requestsSecurityIssues("How do permissions work?")).toBe(false);
    expect(containsSecurityIssue("Budget updates skip the org access check.")).toBe(true);
    expect(containsSecurityIssue("AUTO_APPLY trusts organizationId from the form.")).toBe(true);
    expect(containsSecurityIssue("bypasses_auth")).toBe(true);
    expect(containsSecurityIssue("Authorization tests pass regardless of the real implementation.")).toBe(true);
    expect(containsSecurityIssue("Deactivated accounts have no permissions.")).toBe(false);
    expect(isSecurityIssueMemory({
      title: "Role change",
      statement: "The role changes are checked before saving.",
      subjects: [],
      metadata: { security_issue: true },
    })).toBe(true);
  });

  it("lets controls and rules describe a check but still withholds findings", async () => {
    const control = {
      title: "Webhook signature check",
      statement: "Requests without a valid signature are rejected before the token is read.",
      subjects: [],
      metadata: {},
    };
    expect(isSecurityIssueMemory({ ...control, kind: "control" })).toBe(false);
    expect(isSecurityIssueMemory({ ...control, kind: "rule" })).toBe(false);
    expect(isSecurityIssueMemory({ ...control, kind: "observation" })).toBe(true);
    expect(isSecurityIssueMemory({ ...control })).toBe(true);
    expect(isSecurityIssueMemory({
      ...control,
      kind: "control",
      statement: "This control has a privilege escalation vulnerability.",
    })).toBe(true);
    expect(isSecurityIssueMemory({ ...control, kind: "control", metadata: { security_issue: true } }))
      .toBe(true);
  });

  it("withholds an explicit security question before asking a model", async () => {
    const service = new AnalysisService(repository(), forbiddenAdapter);
    const result = await service.explain("What security vulnerabilities exist?");
    expect(result.summary).toBe(SECURITY_WITHHELD_MESSAGE);
    expect(result.evidence).toEqual([]);
    expect(result.memory_ids).toEqual([]);
  });

  it("withholds a security finding produced for an ordinary question", async () => {
    const adapter: AnalysisAdapter = {
      provider: "openai",
      async analyze({ candidates }) {
        const evidenceId = candidates.find((candidate) => candidate.kind === "code")?.id;
        if (!evidenceId) throw new Error("Expected a code excerpt for the test.");
        return {
          answer: "Budget updates bypass the organization access check.",
          memory_ids: [],
          observed_behavior: [{
            statement: "Budget updates bypass the organization access check.",
            evidence_ids: [evidenceId],
          }],
          business_rationale: { status: "unknown", statement: "Not established.", evidence_ids: [] },
          verified_rule: {
            status: "unverified",
            statement: "Not established.",
            verified_by_role: null,
            verified_on: null,
            evidence_ids: [],
          },
          uncertainties: [],
        };
      },
    };
    const result = await new AnalysisService(repository(), adapter)
      .explain("shipping address dispatch");
    expect(result.summary).toBe(SECURITY_WITHHELD_MESSAGE);
    expect(result.evidence).toEqual([]);
  });

  it("does not include stored findings in an ordinary MCP investigation", async () => {
    const store = new MemoryStore(":memory:");
    (await store.upsertMemory({
      kind: "observation",
      title: "Budget authorization gap",
      statement: "Budget updates skip the org access check.",
      state: "candidate",
      authority: "ai_inference",
      confidence: 0.9,
      subjects: ["budget"],
    }));
    const service = new SpurService(repository(), store, forbiddenAdapter, "none", "Tester");
    try {
      const result = await service.prepareHostInvestigation("How do budget updates work?");
      expect(result.recalled_memory).toEqual([]);
      expect(result.related_memory).toEqual([]);
      expect(result.memory_evidence).toEqual([]);
    } finally {
      (await service.close());
    }
  });

  it("returns no source or memory evidence for an explicit MCP security question", async () => {
    const service = new SpurService(repository(), new MemoryStore(":memory:"), forbiddenAdapter, "none", "Tester");
    try {
      const result = await service.prepareHostInvestigation("Which authorization checks are missing?");
      expect(result.recalled_memory).toEqual([]);
      expect(result.repository_evidence).toEqual([]);
      expect(result.answering_instructions[0]).toBe(SECURITY_WITHHELD_MESSAGE);
      expect((await service.searchRepository("security vulnerabilities")).candidates).toEqual([]);
    } finally {
      (await service.close());
    }
  });

  it("keeps a blocked Ask turn and its conversation title generic", async () => {
    const service = new SpurService(repository(), new MemoryStore(":memory:"), forbiddenAdapter, "none", "Tester");
    try {
      const answer = await service.investigate("What security vulnerabilities exist?");
      expect(answer.answer).toBe(`${SECURITY_WITHHELD_MESSAGE}\n\n${BETA_NOTICE_ENGLISH}`);
      expect(answer.analysis.evidence).toEqual([]);
      expect(answer.recalled_memory).toEqual([]);
      expect((await service.listConversations())[0]?.title).toBe("Security review request");
      expect((await service.getConversation(answer.conversation_id)).turns[0]?.answer)
        .toBe(`${SECURITY_WITHHELD_MESSAGE}\n\n${BETA_NOTICE_ENGLISH}`);
    } finally {
      (await service.close());
    }
  });
});
