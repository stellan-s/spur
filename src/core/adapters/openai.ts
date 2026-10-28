import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { ConfigurationError, SpurError } from "../errors";
import {
  modelAnalysisSchema,
  type AnalysisMemoryContext,
  type AnalysisAdapter,
  type ConversationContextMessage,
  type EvidenceCandidate,
  type ModelAnalysis,
} from "../types";
import { ANALYSIS_INSTRUCTIONS, buildAnalysisInput } from "./prompt";
import type { OpenAIReasoningEffort } from "../config";

export class OpenAIAnalysisAdapter implements AnalysisAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(
    private readonly model: string,
    apiKey: string,
    private readonly reasoningEffort: OpenAIReasoningEffort | undefined,
    private readonly maxOutputTokens: number,
    timeoutMs: number,
  ) {
    if (!model || !apiKey) {
      throw new ConfigurationError(
        "The OpenAI adapter requires OPENAI_MODEL and OPENAI_API_KEY.",
        "missing_credentials",
      );
    }
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async analyze(input: {
    question: string;
    repository: string;
    commitSha: string;
    candidates: EvidenceCandidate[];
    conversationContext?: ConversationContextMessage[];
    memoryContext?: AnalysisMemoryContext;
  }): Promise<ModelAnalysis> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        instructions: ANALYSIS_INSTRUCTIONS,
        input: buildAnalysisInput(input),
        reasoning: this.reasoningEffort
          ? { effort: this.reasoningEffort }
          : undefined,
        text: {
          format: zodTextFormat(modelAnalysisSchema, "spur_business_rule_analysis"),
        },
        max_output_tokens: this.maxOutputTokens,
        store: false,
      });

      if (!response.output_parsed) {
        throw new SpurError(
          "The model did not return a usable structured analysis.",
          "model_output_unavailable",
          502,
        );
      }
      return modelAnalysisSchema.parse(response.output_parsed);
    } catch (error) {
      if (error instanceof SpurError) throw error;
      const message = error instanceof Error ? error.message : "Unknown model error";
      throw new SpurError(`Model analysis failed: ${message}`, "model_error", 502);
    }
  }
}
