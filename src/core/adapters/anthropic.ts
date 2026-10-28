import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

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

export class AnthropicAnalysisAdapter implements AnalysisAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    apiKey: string,
    private readonly maxOutputTokens: number,
    timeoutMs: number,
  ) {
    if (!model || !apiKey) {
      throw new ConfigurationError(
        "The Anthropic adapter requires ANTHROPIC_MODEL and ANTHROPIC_API_KEY.",
        "missing_credentials",
      );
    }
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
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
      const message = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        system: ANALYSIS_INSTRUCTIONS,
        messages: [{ role: "user", content: buildAnalysisInput(input) }],
        output_config: {
          format: zodOutputFormat(modelAnalysisSchema),
        },
      });

      if (!message.parsed_output) {
        throw new SpurError(
          "Claude did not return a usable structured analysis.",
          "model_output_unavailable",
          502,
        );
      }
      return modelAnalysisSchema.parse(message.parsed_output);
    } catch (error) {
      if (error instanceof SpurError) throw error;
      const message = error instanceof Error ? error.message : "Unknown model error";
      throw new SpurError(`Claude analysis failed: ${message}`, "model_error", 502);
    }
  }
}
