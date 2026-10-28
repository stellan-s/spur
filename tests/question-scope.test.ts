import path from "node:path";
import { describe, expect, it } from "vitest";

import { AnalysisService } from "@/core/analysis";
import { BETA_NOTICE_ENGLISH } from "@/core/beta-notice";
import {
  BROAD_QUALITY_ASSESSMENT_MESSAGE,
  requestsBroadQualityAssessment,
} from "@/core/question-scope";
import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import type { AnalysisAdapter } from "@/core/types";
import { createSpurMcpServer } from "@/mcp/server";
import { TestMemoryStore as MemoryStore } from "./support/postgres";

const repository = () => new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
const forbiddenAdapter: AnalysisAdapter = {
  provider: "none",
  async analyze() {
    throw new Error("An unsupported assessment must not reach the model.");
  },
};

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
};

type InspectableMcpServer = {
  _registeredTools: Record<string, {
    handler: (input: Record<string, unknown>) => Promise<ToolResult>;
  }>;
};

describe("broad quality assessment guard", () => {
  it("blocks broad judgments without blocking specific factual questions", () => {
    expect(requestsBroadQualityAssessment("Assess the quality of the app and the API")).toBe(true);
    expect(requestsBroadQualityAssessment("Can you assess the quality of the Example Corp app?")).toBe(true);
    expect(requestsBroadQualityAssessment("How reliable is the application overall?")).toBe(true);
    expect(requestsBroadQualityAssessment("Bedöm kvaliteten på appen och API:t")).toBe(true);
    expect(requestsBroadQualityAssessment("How does the API handle failed requests?")).toBe(false);
    expect(requestsBroadQualityAssessment("Which controls validate data quality?")).toBe(false);
    expect(requestsBroadQualityAssessment("What recorded API latency metrics exist?")).toBe(false);
  });

  it("returns the scope boundary without asking a model", async () => {
    const result = await new AnalysisService(repository(), forbiddenAdapter)
      .explain("Assess the quality of the app and the API");
    expect(result.summary).toBe(BROAD_QUALITY_ASSESSMENT_MESSAGE);
    expect(result.evidence).toEqual([]);
    expect(result.memory_ids).toEqual([]);
    expect(result.analysis.analyzed_files).toBe(0);
  });

  it("does not search or record a knowledge gap for MCP assessments", async () => {
    const service = new SpurService(
      repository(),
      new MemoryStore(":memory:"),
      forbiddenAdapter,
      "none",
      "Tester",
      process.cwd(),
      undefined,
      [],
      "on",
    );
    try {
      const result = await service.prepareHostInvestigation(
        "Assess the quality of the app and the API",
      );
      expect(result.recalled_memory).toEqual([]);
      expect(result.repository_evidence).toEqual([]);
      expect(result.code_search.searched).toBe(false);
      expect(result.answering_instructions[0]).toBe(BROAD_QUALITY_ASSESSMENT_MESSAGE);
      expect(await service.listKnowledgeGaps()).toEqual([]);
    } finally {
      await service.close();
    }
  });

  it("refuses broad assessments through raw MCP lookup tools", async () => {
    const server = await createSpurMcpServer({
      features: {
        ask: false,
        code_search: "off",
        model_provider: "none",
        modelling_writes: false,
        isms: false,
        wiki: false,
        remote_mcp: false,
        knowledge_gaps: false,
      },
    }) as unknown as InspectableMcpServer;

    const search = await server._registeredTools.search_memory.handler({
      query: "How reliable is the Example Corp application overall?",
      limit: 10,
    });
    expect(search.structuredContent).toEqual({ items: [] });
    expect(search.content.map((item) => item.text)).toEqual([
      BROAD_QUALITY_ASSESSMENT_MESSAGE,
      BETA_NOTICE_ENGLISH,
    ]);

    const trace = await server._registeredTools.trace_relationships.handler({
      query: "Assess the quality of the app and the API",
    });
    expect(trace.structuredContent).toEqual({ matches: [], related: [], relationships: [] });
    expect(trace.content.map((item) => item.text)).toEqual([
      BROAD_QUALITY_ASSESSMENT_MESSAGE,
      BETA_NOTICE_ENGLISH,
    ]);

    const repository = await server._registeredTools.search_repository.handler({
      query: "Review the overall quality of the codebase",
    });
    expect(repository.structuredContent).toEqual({ repositories: [], candidates: [] });
    expect(repository.content.map((item) => item.text)).toEqual([
      BROAD_QUALITY_ASSESSMENT_MESSAGE,
      BETA_NOTICE_ENGLISH,
    ]);
  });

  it("stores the refusal without turning it into a knowledge gap", async () => {
    const service = new SpurService(repository(), new MemoryStore(":memory:"), forbiddenAdapter, "none", "Tester");
    try {
      const result = await service.investigate("Assess the quality of the app and the API");
      expect(result.answer).toBe(`${BROAD_QUALITY_ASSESSMENT_MESSAGE}\n\n${BETA_NOTICE_ENGLISH}`);
      expect(result.recalled_memory).toEqual([]);
      expect((await service.listConversations())[0]?.title).toBe("Unsupported assessment request");
      expect(await service.listKnowledgeGaps()).toEqual([]);
    } finally {
      await service.close();
    }
  });
});
