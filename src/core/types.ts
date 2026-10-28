import { z } from "zod";

export const modelProviderSchema = z.enum(["none", "openai", "anthropic"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const evidenceKindSchema = z.enum([
  "code",
  "test",
  "approved_document",
  "verification_record",
]);

export const evidenceSupportsSchema = z.enum([
  "observed_behavior",
  "business_rationale",
  "verified_rule",
]);

export const evidenceSchema = z.object({
  id: z.string(),
  kind: evidenceKindSchema,
  repo: z.string(),
  commit_sha: z.string(),
  path: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  excerpt: z.string(),
  supports: z.array(evidenceSupportsSchema).min(1),
});

export const observedClaimSchema = z.object({
  statement: z.string(),
  evidence_ids: z.array(z.string()).min(1),
});

export const businessRationaleSchema = z.object({
  status: z.enum(["known", "unknown"]),
  statement: z.string(),
  evidence_ids: z.array(z.string()),
});

export const verifiedRuleSchema = z.object({
  status: z.enum(["verified", "unverified"]),
  statement: z.string(),
  verified_by_role: z.string().nullable(),
  verified_on: z.string().nullable(),
  evidence_ids: z.array(z.string()),
});

export const analysisResultSchema = z.object({
  question: z.string(),
  summary: z.string(),
  memory_ids: z.array(z.string()).default([]),
  observed_behavior: z.array(observedClaimSchema),
  business_rationale: businessRationaleSchema,
  verified_rule: verifiedRuleSchema,
  evidence: z.array(evidenceSchema),
  uncertainties: z.array(z.string()),
  status: z.enum(["supported", "partial", "no_evidence"]),
  repository: z.object({
    name: z.string(),
    commit_sha: z.string(),
  }),
  analysis: z.object({
    provider: modelProviderSchema,
    analyzed_files: z.number().int().nonnegative(),
  }),
});

export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type EvidenceSupports = z.infer<typeof evidenceSupportsSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const modelAnalysisSchema = z.object({
  answer: z.string().min(1),
  memory_ids: z.array(z.string()),
  observed_behavior: z.array(
    z.object({
      statement: z.string().min(1),
      evidence_ids: z.array(z.string()),
    }),
  ),
  business_rationale: businessRationaleSchema,
  verified_rule: verifiedRuleSchema,
  uncertainties: z.array(z.string()),
});

export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;

export type CandidateKind = EvidenceKind | "unapproved_context";

export type EvidenceCandidate = {
  id: string;
  kind: CandidateKind;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
};

export type RepositorySnapshot = {
  repo: string;
  commitSha: string;
  candidates: EvidenceCandidate[];
  analyzedFiles: number;
};

export type ConversationContextMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AnalysisMemoryItem = {
  id: string;
  kind: string;
  title: string;
  statement: string;
  state: string;
  authority: string;
  confidence: number;
  subjects: string[];
  aliases: Array<{
    name: string;
    status: "proposed" | "verified" | "rejected";
    origin: "repository" | "document" | "user" | "system";
    scope: "organization" | "repository";
    actor: string | null;
  }>;
  metadata: Record<string, unknown>;
};

export type AnalysisMemoryRelationship = {
  from_id: string;
  predicate: string;
  to_id: string;
  metadata: Record<string, unknown>;
};

export type AnalysisMemoryContext = {
  items: AnalysisMemoryItem[];
  relationships: AnalysisMemoryRelationship[];
};

export interface AnalysisAdapter {
  readonly provider: ModelProvider;
  analyze(input: {
    question: string;
    repository: string;
    commitSha: string;
    candidates: EvidenceCandidate[];
    conversationContext?: ConversationContextMessage[];
    memoryContext?: AnalysisMemoryContext;
  }): Promise<ModelAnalysis>;
}
