import { loadOrganizationConfig, LIMITS, type SpurConfig } from "./config";
import { ConfigurationError, InputError } from "./errors";
import { sourceProviderFromConfig, type SourceMetadata, type SourceProvider } from "./source-provider";
import { retrieveEvidence } from "./search";
import {
  containsSecurityIssue,
  isSecurityIssueEvidence,
  isSecurityIssueMemory,
  requestsSecurityIssues,
  SECURITY_WITHHELD_MESSAGE,
} from "./security-disclosure";
import {
  BROAD_QUALITY_ASSESSMENT_MESSAGE,
  requestsBroadQualityAssessment,
} from "./question-scope";
import {
  analysisResultSchema,
  modelAnalysisSchema,
  type AnalysisMemoryContext,
  type AnalysisAdapter,
  type AnalysisResult,
  type ConversationContextMessage,
  type Evidence,
  type EvidenceCandidate,
  type EvidenceSupports,
  type ModelProvider,
  type ModelAnalysis,
  type RepositorySnapshot,
} from "./types";
import { OpenAIAnalysisAdapter } from "./adapters/openai";
import { AnthropicAnalysisAdapter } from "./adapters/anthropic";

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function allowedIds(
  ids: string[],
  candidateMap: Map<string, EvidenceCandidate>,
  kinds: EvidenceCandidate["kind"][],
): string[] {
  return unique(ids).filter((id) => {
    const candidate = candidateMap.get(id);
    return candidate !== undefined && kinds.includes(candidate.kind);
  });
}

export async function finalizeAnalysis(input: {
  question: string;
  snapshot: RepositorySnapshot;
  rawAnalysis: ModelAnalysis;
  repository: SourceProvider;
  provider: ModelProvider;
  memoryContext?: AnalysisMemoryContext;
}): Promise<AnalysisResult> {
  const raw = modelAnalysisSchema.parse(input.rawAnalysis);
  const candidateMap = new Map(
    input.snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const availableMemoryIds = new Set(
    (input.memoryContext?.items ?? []).map((item) => item.id),
  );
  const memoryIds = unique(raw.memory_ids).filter((id) =>
    availableMemoryIds.has(id),
  );
  const requestedIds = unique([
    ...raw.observed_behavior.flatMap((claim) => claim.evidence_ids),
    ...raw.business_rationale.evidence_ids,
    ...raw.verified_rule.evidence_ids,
  ]);
  const verifiedIds = new Set<string>();

  await Promise.all(
    requestedIds.map(async (id) => {
      const candidate = candidateMap.get(id);
      if (!candidate || candidate.kind === "unapproved_context") return;
      const valid = await input.repository.verifyExcerpt({
        commitSha: input.snapshot.commitSha,
        path: candidate.path,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        excerpt: candidate.excerpt,
      });
      if (valid) verifiedIds.add(id);
    }),
  );

  const observations = raw.observed_behavior.flatMap((claim) => {
    const evidenceIds = allowedIds(claim.evidence_ids, candidateMap, ["code", "test"])
      .filter((id) => verifiedIds.has(id));
    return evidenceIds.length > 0
      ? [{ statement: claim.statement.trim(), evidence_ids: evidenceIds }]
      : [];
  });

  const rationaleIds = allowedIds(
    raw.business_rationale.evidence_ids,
    candidateMap,
    ["approved_document"],
  ).filter((id) => verifiedIds.has(id));
  const rationaleKnown =
    raw.business_rationale.status === "known" && rationaleIds.length > 0;
  const businessRationale = rationaleKnown
    ? {
        status: "known" as const,
        statement: raw.business_rationale.statement.trim(),
        evidence_ids: rationaleIds,
      }
    : {
        status: "unknown" as const,
        statement:
          "No approved repository document was found that establishes the business rationale.",
        evidence_ids: [],
      };

  const verificationIds = allowedIds(
    raw.verified_rule.evidence_ids,
    candidateMap,
    ["verification_record"],
  ).filter((id) => verifiedIds.has(id));
  const isVerified =
    raw.verified_rule.status === "verified" && verificationIds.length > 0;
  const verifiedRule = isVerified
    ? {
        status: "verified" as const,
        statement: raw.verified_rule.statement.trim(),
        verified_by_role: raw.verified_rule.verified_by_role,
        verified_on: raw.verified_rule.verified_on,
        evidence_ids: verificationIds,
      }
    : {
        status: "unverified" as const,
        statement: "No authorized human verification record was found for this rule.",
        verified_by_role: null,
        verified_on: null,
        evidence_ids: [],
      };

  const supports = new Map<string, Set<EvidenceSupports>>();
  const addSupport = (ids: string[], support: EvidenceSupports) => {
    for (const id of ids) {
      const current = supports.get(id) ?? new Set<EvidenceSupports>();
      current.add(support);
      supports.set(id, current);
    }
  };
  for (const claim of observations) addSupport(claim.evidence_ids, "observed_behavior");
  addSupport(businessRationale.evidence_ids, "business_rationale");
  addSupport(verifiedRule.evidence_ids, "verified_rule");

  const evidence: Evidence[] = input.snapshot.candidates.flatMap((candidate) => {
    const candidateSupports = supports.get(candidate.id);
    if (
      !candidateSupports ||
      candidate.kind === "unapproved_context" ||
      !verifiedIds.has(candidate.id)
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        kind: candidate.kind,
        repo: input.snapshot.repo,
        commit_sha: input.snapshot.commitSha,
        path: candidate.path,
        start_line: candidate.startLine,
        end_line: candidate.endLine,
        excerpt: candidate.excerpt,
        supports: [...candidateSupports],
      },
    ];
  });

  const uncertainties = [...raw.uncertainties];
  if (observations.length > 0 && !rationaleKnown) {
    uncertainties.push(
      "Business intent is unknown; implementation behavior alone is not evidence of intent.",
    );
  }
  if (observations.length > 0 && !isVerified) {
    uncertainties.push(
      "The observed behavior has not been promoted to a human-verified business rule.",
    );
  }
  if (requestedIds.some((id) => !verifiedIds.has(id))) {
    uncertainties.push(
      "One or more proposed citations were discarded because they failed source verification or evidence policy.",
    );
  }
  if (raw.memory_ids.some((id) => !availableMemoryIds.has(id))) {
    uncertainties.push(
      "One or more proposed memory references were discarded because they were not supplied to the analysis.",
    );
  }
  const status =
    observations.length > 0 || memoryIds.length > 0
      ? "supported"
      : evidence.length > 0
        ? "partial"
        : "no_evidence";
  const summary =
    (status !== "no_evidence" ? raw.answer.trim() : "") ||
    observations[0]?.statement ||
    (status === "no_evidence"
      ? "No relevant source evidence or organizational memory was found for this question."
      : "Relevant context was found, but no implementation behavior could be supported.");

  return analysisResultSchema.parse({
    question: input.question,
    summary,
    memory_ids: memoryIds,
    observed_behavior: observations,
    business_rationale: businessRationale,
    verified_rule: verifiedRule,
    evidence,
    uncertainties: unique(uncertainties),
    status,
    repository: {
      name: input.snapshot.repo,
      commit_sha: input.snapshot.commitSha,
    },
    analysis: {
      provider: input.provider,
      analyzed_files: input.snapshot.analyzedFiles,
    },
  });
}

export class AnalysisService {
  constructor(
    private readonly repository: SourceProvider,
    private readonly adapter: AnalysisAdapter,
  ) {}

  async explain(
    questionInput: string,
    options: {
      conversationContext?: ConversationContextMessage[];
      retrievalQuery?: string;
      memoryContext?: AnalysisMemoryContext;
      excludedPaths?: readonly string[];
      searchCode?: boolean;
      repositoryMetadata?: SourceMetadata;
    } = {},
  ): Promise<AnalysisResult> {
    const question = questionInput.trim();
    if (question.length < 5) {
      throw new InputError("Question must contain at least 5 characters.");
    }
    if (question.length > LIMITS.maxQuestionCharacters) {
      throw new InputError(
        `Question must not exceed ${LIMITS.maxQuestionCharacters} characters.`,
      );
    }

    const metadataForMemory = () => options.searchCode === false && options.repositoryMetadata
      ? Promise.resolve(options.repositoryMetadata)
      : this.repository.metadata();
    const unavailable = async (
      summary: string,
      detail: string,
    ): Promise<AnalysisResult> => {
      const metadata = await metadataForMemory();
      return analysisResultSchema.parse({
        question,
        summary,
        memory_ids: [],
        observed_behavior: [],
        business_rationale: { status: "unknown", statement: detail, evidence_ids: [] },
        verified_rule: {
          status: "unverified",
          statement: detail,
          verified_by_role: null,
          verified_on: null,
          evidence_ids: [],
        },
        evidence: [],
        uncertainties: [],
        status: "no_evidence",
        repository: { name: metadata.name, commit_sha: metadata.commitSha },
        analysis: { provider: this.adapter.provider, analyzed_files: 0 },
      });
    };
    const withhold = () => unavailable(SECURITY_WITHHELD_MESSAGE, "Not disclosed.");
    if (requestsSecurityIssues(question)) return withhold();
    if (requestsBroadQualityAssessment(question)) {
      return unavailable(BROAD_QUALITY_ASSESSMENT_MESSAGE, "Not applicable to this question.");
    }

    const safeResult = async (result: AnalysisResult): Promise<AnalysisResult> => {
      const claims = [
        result.summary,
        ...result.observed_behavior.map((claim) => claim.statement),
        result.business_rationale.statement,
        result.verified_rule.statement,
        ...result.uncertainties,
      ];
      return claims.some((claim) => containsSecurityIssue(claim)) ? withhold() : result;
    };

    // searchCode false keeps the answer to stored memory, as the code search switch requires.
    const searchCode = options.searchCode ?? true;
    const retrieved = searchCode
      ? await retrieveEvidence(this.repository, options.retrievalQuery?.trim() || question)
      : await metadataForMemory().then((metadata) => ({
        ...metadata, repo: metadata.name, candidates: [], analyzedFiles: 0,
      }));
    const snapshot = {
      ...retrieved,
      candidates: retrieved.candidates.filter((candidate) =>
        !isSecurityIssueEvidence(candidate) && !options.excludedPaths?.includes(candidate.path)),
    };
    const visibleItems = (options.memoryContext?.items ?? []).filter((item) =>
      !isSecurityIssueMemory(item),
    );
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const memoryContext: AnalysisMemoryContext = {
      items: visibleItems,
      relationships: (options.memoryContext?.relationships ?? []).filter((relationship) =>
        visibleIds.has(relationship.from_id) && visibleIds.has(relationship.to_id),
      ),
    };
    const memoryItems = memoryContext.items;
    if (snapshot.candidates.length === 0 && memoryItems.length === 0) {
      return safeResult(await finalizeAnalysis({
        question,
        snapshot,
        rawAnalysis: {
          answer: "No relevant source evidence or organizational memory was found for this question.",
          memory_ids: [],
          observed_behavior: [],
          business_rationale: {
            status: "unknown",
            statement: "No approved rationale was found.",
            evidence_ids: [],
          },
          verified_rule: {
            status: "unverified",
            statement: "No verification record was found.",
            verified_by_role: null,
            verified_on: null,
            evidence_ids: [],
          },
          uncertainties: [
            searchCode
              ? "No repository text matched the business-language question within the configured search budget."
              : "This has not been modelled in Spur yet, and code search is turned off.",
          ],
        },
        repository: this.repository,
        provider: this.adapter.provider,
        memoryContext,
      }));
    }

    if (snapshot.candidates.length === 0 && this.adapter.provider === "none") {
      const strongest = memoryItems.find((item) => item.state === "accepted") ?? memoryItems[0];
      return safeResult(await finalizeAnalysis({
        question,
        snapshot,
        rawAnalysis: {
          answer: strongest?.statement ?? "No relevant organizational memory was found for this question.",
          memory_ids: strongest ? [strongest.id] : [],
          observed_behavior: [],
          business_rationale: {
            status: "unknown",
            statement: "No approved rationale was found.",
            evidence_ids: [],
          },
          verified_rule: {
            status: "unverified",
            statement: "No verification record was found.",
            verified_by_role: null,
            verified_on: null,
            evidence_ids: [],
          },
          uncertainties: strongest?.state === "accepted"
            ? []
            : ["The answer is based on candidate organizational memory."],
        },
        repository: this.repository,
        provider: this.adapter.provider,
        memoryContext,
      }));
    }

    const rawAnalysis = await this.adapter.analyze({
      question,
      repository: snapshot.repo,
      commitSha: snapshot.commitSha,
      candidates: snapshot.candidates,
      conversationContext: options.conversationContext?.filter((message) =>
        !containsSecurityIssue(message.content),
      ),
      memoryContext,
    });
    return safeResult(await finalizeAnalysis({
      question,
      snapshot,
      rawAnalysis,
      repository: this.repository,
      provider: this.adapter.provider,
      memoryContext,
    }));
  }
}

export function createAdapter(config: SpurConfig): AnalysisAdapter {
  if (config.synthesisProvider === "openai") {
    return new OpenAIAnalysisAdapter(
      config.openAIModel ?? "",
      config.openAIKey ?? "",
      config.openAIReasoningEffort,
      config.maxOutputTokens,
      config.modelTimeoutMs,
    );
  }
  if (config.synthesisProvider === "anthropic") {
    return new AnthropicAnalysisAdapter(
      config.anthropicModel ?? "",
      config.anthropicKey ?? "",
      config.maxOutputTokens,
      config.modelTimeoutMs,
    );
  }
  return {
    provider: "none",
    async analyze() {
      throw new ConfigurationError(
        "No model provider is configured. Connect through MCP or configure Anthropic/OpenAI.",
        "model_provider_not_configured",
      );
    },
  };
}

export function createConfiguredService(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
  organizationSlug?: string,
): AnalysisService {
  const config = loadOrganizationConfig(organizationSlug, env, projectRoot);
  return new AnalysisService(
    sourceProviderFromConfig(config),
    createAdapter(config),
  );
}
