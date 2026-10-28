import type {
  AnalysisAdapter,
  AnalysisMemoryContext,
  EvidenceCandidate,
  ModelAnalysis,
} from "@/core/types";

export class EvidenceTestAdapter implements AnalysisAdapter {
  readonly provider = "none" as const;

  async analyze(input: {
    question: string;
    candidates: EvidenceCandidate[];
    memoryContext?: AnalysisMemoryContext;
  }): Promise<ModelAnalysis> {
    const implementation = input.candidates.filter((candidate) =>
      candidate.score > 1 && (candidate.kind === "code" || candidate.kind === "test")
    );
    const approvedDocument = input.candidates.find(
      (candidate) => candidate.score > 1 && candidate.kind === "approved_document",
    );
    const verificationRecord = input.candidates.find(
      (candidate) => candidate.score > 1 && candidate.kind === "verification_record",
    );

    return {
      answer: implementation.length > 0
        ? `Test observation for ${input.question}`
        : input.memoryContext?.items[0]?.statement ?? "No relevant information was found.",
      memory_ids: input.memoryContext?.items.map((item) => item.id) ?? [],
      observed_behavior: implementation.length > 0 ? [{
        statement: `Test observation for ${input.question}`,
        evidence_ids: implementation.map((candidate) => candidate.id),
      }] : [],
      business_rationale: approvedDocument ? {
        status: "known",
        statement: `Test rationale from ${approvedDocument.path}`,
        evidence_ids: [approvedDocument.id],
      } : {
        status: "unknown",
        statement: "No approved test document was selected.",
        evidence_ids: [],
      },
      verified_rule: verificationRecord ? {
        status: "verified",
        statement: `Test verification from ${verificationRecord.path}`,
        verified_by_role: "Test owner",
        verified_on: "2025-03-03",
        evidence_ids: [verificationRecord.id],
      } : {
        status: "unverified",
        statement: "No test verification record was selected.",
        verified_by_role: null,
        verified_on: null,
        evidence_ids: [],
      },
      uncertainties: [],
    };
  }
}
