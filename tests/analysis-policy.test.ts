import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { finalizeAnalysis } from "@/core/analysis";
import { GitRepository } from "@/core/repository";
import { retrieveEvidence } from "@/core/search";
import type { ModelAnalysis, RepositorySnapshot } from "@/core/types";

const fixtureRoot = path.resolve(process.cwd(), "fixture-repo");
const repository = new GitRepository(fixtureRoot);
let discountSnapshot: RepositorySnapshot;

const unverified = {
  status: "unverified" as const,
  statement: "No verification.",
  verified_by_role: null,
  verified_on: null,
  evidence_ids: [],
};

beforeAll(async () => {
  discountSnapshot = await retrieveEvidence(
    repository,
    "Why does a discount above twenty percent need manager approval?",
  );
});

describe("epistemic policy", () => {
  it("returns no_evidence when the adapter supplies no supported observation", async () => {
    const emptySnapshot: RepositorySnapshot = {
      repo: "empty",
      commitSha: discountSnapshot.commitSha,
      candidates: [],
      analyzedFiles: 0,
    };
    const result = await finalizeAnalysis({
      question: "What is the rule?",
      snapshot: emptySnapshot,
      rawAnalysis: {
        answer: "No relevant information was found.",
        memory_ids: [],
        observed_behavior: [],
        business_rationale: {
          status: "unknown",
          statement: "Unknown.",
          evidence_ids: [],
        },
        verified_rule: unverified,
        uncertainties: [],
      },
      repository,
      provider: "none",
    });
    expect(result.status).toBe("no_evidence");
    expect(result.summary).toBe(
      "No relevant source evidence or organizational memory was found for this question.",
    );
    expect(result.summary.toLowerCase()).not.toContain("commit");
    expect(result.evidence).toEqual([]);
    expect(result.observed_behavior).toEqual([]);
  });

  it("downgrades a rationale that cites implementation instead of an approved document", async () => {
    const source = discountSnapshot.candidates.find(
      (candidate) => candidate.path === "src/discounts.ts",
    );
    expect(source).toBeDefined();
    const raw: ModelAnalysis = {
      answer: "Large discounts need approval.",
      memory_ids: [],
      observed_behavior: [
        { statement: "Large discounts need approval.", evidence_ids: [source!.id] },
      ],
      business_rationale: {
        status: "known",
        statement: "The code proves that this protects margin.",
        evidence_ids: [source!.id],
      },
      verified_rule: unverified,
      uncertainties: [],
    };
    const result = await finalizeAnalysis({
      question: "Why is approval needed?",
      snapshot: discountSnapshot,
      rawAnalysis: raw,
      repository,
      provider: "openai",
    });
    expect(result.business_rationale.status).toBe("unknown");
    expect(result.business_rationale.evidence_ids).toEqual([]);
    expect(result.observed_behavior).toHaveLength(1);
  });

  it("does not promote an approved intent document to human verification", async () => {
    const policy = discountSnapshot.candidates.find(
      (candidate) => candidate.path === "docs/discount-policy.md",
    );
    expect(policy?.kind).toBe("approved_document");
    const raw: ModelAnalysis = {
      answer: "The threshold protects contribution margin.",
      memory_ids: [],
      observed_behavior: [],
      business_rationale: {
        status: "known",
        statement: "The threshold protects contribution margin.",
        evidence_ids: [policy!.id],
      },
      verified_rule: {
        status: "verified",
        statement: "A manager must approve discounts above 20%.",
        verified_by_role: "Commercial Director",
        verified_on: "2025-02-12",
        evidence_ids: [policy!.id],
      },
      uncertainties: [],
    };
    const result = await finalizeAnalysis({
      question: "Is the discount rule verified?",
      snapshot: discountSnapshot,
      rawAnalysis: raw,
      repository,
      provider: "openai",
    });
    expect(result.business_rationale.status).toBe("known");
    expect(result.verified_rule.status).toBe("unverified");
    expect(result.evidence[0]?.supports).toEqual(["business_rationale"]);
  });

  it("drops concrete behavioral claims with no code or test citation", async () => {
    const policy = discountSnapshot.candidates.find(
      (candidate) => candidate.path === "docs/discount-policy.md",
    );
    const result = await finalizeAnalysis({
      question: "What does the code enforce?",
      snapshot: discountSnapshot,
      rawAnalysis: {
        answer: "The system blocks the discount.",
        memory_ids: [],
        observed_behavior: [
          {
            statement: "The system blocks the discount.",
            evidence_ids: policy ? [policy.id] : [],
          },
        ],
        business_rationale: {
          status: "unknown",
          statement: "Unknown.",
          evidence_ids: [],
        },
        verified_rule: unverified,
        uncertainties: [],
      },
      repository,
      provider: "openai",
    });
    expect(result.observed_behavior).toEqual([]);
    expect(result.status).toBe("no_evidence");
  });
});
