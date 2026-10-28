import path from "node:path";
import { describe, expect, it } from "vitest";

import { AnalysisService } from "@/core/analysis";
import { GitRepository } from "@/core/repository";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";

const fixtureRoot = path.resolve(process.cwd(), "fixture-repo");
const service = new AnalysisService(
  new GitRepository(fixtureRoot),
  new EvidenceTestAdapter(),
);

describe("fixture integration", () => {
  it("explains a genuine code rule with exact citations and unknown rationale", async () => {
    const result = await service.explain(
      "Why can't a shipping address change after dispatch?",
    );
    expect(result.status).toBe("supported");
    expect(result.observed_behavior[0]?.statement).toContain("shipping address");
    expect(result.business_rationale.status).toBe("unknown");
    expect(result.verified_rule.status).toBe("unverified");
    expect(result.evidence.map((item) => item.path)).toEqual(
      expect.arrayContaining(["src/orders.ts", "tests/orders.test.ts"]),
    );
    expect(result.evidence.every((item) => item.commit_sha === result.repository.commit_sha)).toBe(
      true,
    );
    expect(result.evidence.every((item) => item.start_line <= item.end_line)).toBe(true);
  });

  it("keeps approved intent separate from a verification record", async () => {
    const discount = await service.explain(
      "Why does a 25% discount require manager approval?",
    );
    expect(discount.business_rationale.status).toBe("known");
    expect(discount.verified_rule.status).toBe("unverified");
    expect(discount.evidence.some((item) => item.kind === "approved_document")).toBe(true);

    const returns = await service.explain("How long can a customer return an order?");
    expect(returns.business_rationale.status).toBe("unknown");
    expect(returns.verified_rule.status).toBe("verified");
    expect(returns.verified_rule.verified_by_role).toBe("Test owner");
    expect(returns.evidence.some((item) => item.kind === "verification_record")).toBe(true);
  });

  it("returns a clear no-evidence result for an unrelated question", async () => {
    const result = await service.explain(
      "Which currencies can customers use to pay an invoice?",
    );
    expect(result.status).toBe("no_evidence");
    expect(result.observed_behavior).toEqual([]);
    expect(result.business_rationale.status).toBe("unknown");
  });
});
