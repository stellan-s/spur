import path from "node:path";
import { describe, expect, it } from "vitest";

import { TestMemoryStore as MemoryStore } from "./support/postgres";
import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import type { AnalysisAdapter } from "@/core/types";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";

function createService(codeSearch: "off" | "ask" | "on" = "ask"): SpurService {
  return new SpurService(
    new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
    new MemoryStore(":memory:"),
    new EvidenceTestAdapter(),
    "none",
    "Test architect",
    process.cwd(),
    undefined,
    [],
    codeSearch,
  );
}

describe("AI-first Spur service", () => {
  it("can inspect the workspace without synchronizing repository records", async () => {
    const store = new MemoryStore(":memory:");
    const repository = new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
    const service = new SpurService(
      repository,
      store,
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
      process.cwd(),
    );
    try {
      const workspace = await service.workspace({ synchronizeRepository: false });
      expect(workspace.repository).toMatchObject({
        ready: true,
        name: "fixture-repo",
      });
      expect(workspace.mcp).toMatchObject({
        server_name: "spur-demo",
        command: process.execPath,
        args: [
          path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
          path.resolve(process.cwd(), "src/mcp/server.ts"),
        ],
        cwd: process.cwd(),
        repository_root: repository.root,
      });
      expect(await store.listSources()).toEqual([]);
      expect(workspace.memory).toEqual([]);
    } finally {
      await service.close();
    }
  });

  it("shows Northstar Commerce for legacy Northstar memory while leaving source evidence untouched", async () => {
    const store = new MemoryStore(":memory:");
    const repository = new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
    const metadata = await repository.metadata();
    const source = (await store.upsertSource({
      kind: "repository",
      name: "Northstar",
      locator: metadata.remoteUrl ?? repository.root,
      status: "connected",
    }));
    const legacyApplication = (await store.upsertMemory({
      kind: "application",
      title: "Northstar",
      statement: "Northstar is the application currently connected to Spur for evidence-backed investigation.",
      state: "accepted",
      authority: "system",
      confidence: 1,
      subjects: ["Northstar"],
      sourceIds: [source.id],
      sourceVersion: metadata.commitSha,
      metadata: { configured_source: true },
    }));
    const legacy = (await store.upsertMemory({
      kind: "capability",
      title: "Northstar campaign optimization",
      statement: "Northstar adjusts campaign budgets.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      subjects: ["Northstar"],
    }));
    const service = new SpurService(
      repository,
      store,
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
      process.cwd(),
      { slug: "northstar", name: "Northstar Commerce" },
      [],
      "ask",
      { canonicalName: "Northstar Commerce", aliases: ["Northstar"] },
    );
    try {
      const workspace = await service.workspace();
      const configuredApplications = workspace.memory.filter((item) => item.metadata.configured_source);
      expect(configuredApplications).toHaveLength(1);
      expect(configuredApplications[0]).toMatchObject({ id: legacyApplication.id, title: "Northstar Commerce" });
      expect((await service.searchMemory("Northstar Commerce campaign")).find((item) => item.id === legacy.id)).toMatchObject({
        id: legacy.id,
        title: "Northstar Commerce campaign optimization",
        statement: "Northstar Commerce adjusts campaign budgets.",
        subjects: ["Northstar Commerce"],
      });
      expect((await store.getMemory(legacy.id))?.statement).toBe("Northstar adjusts campaign budgets.");

      const decision = (await service.recordDecision({
        title: "Northstar budget owner",
        statement: "Northstar owns the budget process.",
        rationale: "The product team approved this ownership.",
        owner: "Product owner",
        related_to: ["Northstar"],
      }));
      expect(decision.title).toBe("Northstar Commerce budget owner");
      expect(decision.statement).toContain("Northstar Commerce owns the budget process.");
      expect((await store.getMemory(decision.id))?.subjects).toEqual(["Northstar Commerce"]);
    } finally {
      (await service.close());
    }
  });

  it("returns commit-pinned repository excerpts for an MCP host model", async () => {
    const service = createService();
    try {
      const result = await service.searchRepository("shipping address dispatch");

      expect(result.repo).toBe("fixture-repo");
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
      expect(result.candidates.some((item) => item.path === "src/orders.ts")).toBe(true);
    } finally {
      (await service.close());
    }
  });

  it("prepares an MCP investigation without a Spur model provider", async () => {
    const forbiddenAdapter: AnalysisAdapter = {
      provider: "none",
      async analyze() {
        throw new Error("The MCP host investigation must not invoke a Spur model adapter.");
      },
    };
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      new MemoryStore(":memory:"),
      forbiddenAdapter,
      "none",
      "Claude Code",
    );
    try {
      const result = await service.prepareHostInvestigation(
        "Why can't a shipping address change after dispatch?",
        { searchCode: true },
      );

      expect(result.code_search.repositories[0]?.name).toBe("fixture-repo");
      expect(result.code_search.repositories[0]?.commit_sha).toMatch(/^[a-f0-9]{40}$/);
      expect(result.repository_evidence.some((item) => item.path === "src/orders.ts")).toBe(true);
      expect(result.answering_instructions[0]).toContain("MCP host model");
      expect(result.answering_instructions.join(" ")).toContain("2–4 sentences");
      expect(result.answering_instructions.join(" ")).toContain("expand when the user requests detail");
      expect(result.answering_instructions.join(" ")).toContain("does not prove that a feature is absent");
    } finally {
      (await service.close());
    }
  });

  it("accepts a provider-independent, commit-verified modeling run", async () => {
    const repository = new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
    const forbiddenAdapter: AnalysisAdapter = {
      provider: "none",
      async analyze() {
        throw new Error("The ingestion workflow must not invoke a Spur model adapter.");
      },
    };
    const service = new SpurService(
      repository,
      new MemoryStore(":memory:"),
      forbiddenAdapter,
      "none",
      "Test architect",
    );

    try {
      const search = await service.searchRepository("shipping address dispatch");
      const evidence = search.candidates.find((item) => item.path === "src/orders.ts");
      expect(evidence).toBeDefined();

      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "claude-code-shipping-model-v1",
        client_name: "Claude Code",
        client_version: "test",
        model: "claude-test",
      });
      const sameRun = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "claude-code-shipping-model-v1",
        client_name: "Claude Code",
        client_version: "test",
        model: "claude-test",
      });
      expect(sameRun.id).toBe(run.id);

      const objects = await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [
          {
            external_id: "process.shipping-address-update",
            kind: "process",
            title: "Shipping address update",
            statement: "The order workflow allows a shipping address to be updated before dispatch.",
            confidence: 0.91,
            subjects: ["orders", "shipping"],
            evidence: [{
              kind: evidence!.kind === "test" ? "test" : "code",
              path: evidence!.path,
              start_line: evidence!.startLine,
              end_line: evidence!.endLine,
              excerpt: evidence!.excerpt,
            }],
          },
          {
            external_id: "control.dispatched-address-lock",
            kind: "control",
            title: "Dispatched order address lock",
            statement: "A control prevents shipping-address changes after an order has been dispatched.",
            confidence: 0.94,
            subjects: ["orders", "shipping"],
            evidence: [{
              kind: evidence!.kind === "test" ? "test" : "code",
              path: evidence!.path,
              start_line: evidence!.startLine,
              end_line: evidence!.endLine,
              excerpt: evidence!.excerpt,
            }],
          },
        ],
      });
      expect(objects.items).toHaveLength(2);
      expect(objects.items.every((item) => item.state === "candidate")).toBe(true);
      expect(objects.items.every((item) => item.authority === "ai_inference")).toBe(true);
      expect(objects.items.every((item) => item.actor === "Claude Code")).toBe(true);

      const linked = (await service.proposeRelationships({
        run_id: run.id,
        relationships: [{
          from_external_id: "process.shipping-address-update",
          predicate: "governed_by",
          to_external_id: "control.dispatched-address-lock",
        }],
      }));
      expect(linked.relationships).toHaveLength(1);
      expect(linked.run.relationship_count).toBe(1);

      const completed = (await service.completeSourceAnalysis(run.id));
      expect(completed.status).toBe("completed");
      expect(completed.object_count).toBe(2);
      expect(completed.relationship_count).toBe(1);
      expect(completed.evidence_count).toBe(1);
    } finally {
      (await service.close());
    }
  });

  it("stores entities with classified attributes, locations, and typed entity relationships", async () => {
    const service = createService();
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const evidence = search.candidates.find((item) => item.path === "src/orders.ts");
      expect(evidence).toBeDefined();
      const cited = [{
        kind: evidence!.kind === "test" ? "test" as const : "code" as const,
        path: evidence!.path,
        start_line: evidence!.startLine,
        end_line: evidence!.endLine,
        excerpt: evidence!.excerpt,
      }];
      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "classified-order-entity-model",
        client_name: "Claude Code",
      });
      const objects = await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [
          {
            external_id: "entity.customer",
            kind: "entity",
            title: "Customer",
            statement: "A customer owns orders and provides shipping information.",
            confidence: 0.9,
            subjects: ["customer"],
            evidence: cited,
            entity_definition: {
              technical_name: "Customer",
              information_classification: "confidential",
              attributes: [{
                name: "id",
                data_type: "string",
                required: true,
                identifier: true,
                unique: true,
              }],
              data_locations: [{
                system: "Order service",
                storage_type: "database table",
                locator: "customers",
                role: "system_of_record",
              }],
            },
          },
          {
            external_id: "entity.order",
            kind: "entity",
            title: "Order",
            statement: "An order records its customer and shipping address.",
            confidence: 0.92,
            subjects: ["orders"],
            evidence: cited,
            entity_definition: {
              technical_name: "Order",
              information_classification: "confidential",
              attributes: [{
                name: "customerId",
                data_type: "string",
                required: true,
                identifier: false,
                unique: false,
                information_classification: "confidential",
              }],
              data_locations: [{
                system: "Order service",
                storage_type: "database table",
                locator: "orders",
                role: "system_of_record",
              }],
            },
          },
        ],
      });

      expect(objects.items[0]!.metadata.entity_definition).toMatchObject({
        information_classification: "confidential",
        data_locations: [{ locator: "customers" }],
      });

      const linked = (await service.proposeRelationships({
        run_id: run.id,
        relationships: [{
          from_external_id: "entity.order",
          predicate: "belongs_to",
          to_external_id: "entity.customer",
          cardinality: "many_to_one",
          source_attribute: "customerId",
          target_attribute: "id",
        }],
      }));
      expect(linked.relationships[0]!.metadata).toEqual({
        cardinality: "many_to_one",
        source_attribute: "customerId",
        target_attribute: "id",
      });

      await expect(service.proposeRelationships({
        run_id: run.id,
        relationships: [{
          from_external_id: "entity.customer",
          predicate: "has_orders",
          to_external_id: "entity.order",
          cardinality: "one_to_many",
        }],
      })).rejects.toThrow(/not in the vocabulary/);
      await expect(service.proposeRelationships({
        run_id: run.id,
        relationships: [{
          from_external_id: "entity.customer",
          predicate: "uses",
          to_external_id: "entity.order",
          cardinality: "one_to_many",
        }],
      })).rejects.toThrow(/belongs_to or references/);
    } finally {
      (await service.close());
    }
  });

  it("rejects agent evidence that does not match the pinned commit", async () => {
    const repository = new GitRepository(path.resolve(process.cwd(), "fixture-repo"));
    const service = new SpurService(
      repository,
      new MemoryStore(":memory:"),
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
    );
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const evidence = search.candidates.find((item) => item.path === "src/orders.ts")!;
      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "invalid-evidence-run",
        client_name: "Claude Code",
      });

      await expect(service.proposeMemoryObjects({
        run_id: run.id,
        objects: [{
          external_id: "control.invalid",
          kind: "control",
          title: "Invalid evidence",
          statement: "This statement must not be persisted because its evidence was altered.",
          confidence: 0.8,
          subjects: [],
          evidence: [{
            kind: evidence.kind === "test" ? "test" : "code",
            path: evidence.path,
            start_line: evidence.startLine,
            end_line: evidence.endLine,
            excerpt: `${evidence.excerpt}\naltered`,
          }],
        }],
      })).rejects.toThrow(/do not exactly match/);
    } finally {
      (await service.close());
    }
  });

  it("lists every rejected excerpt with its reason in one error", async () => {
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      new MemoryStore(":memory:"),
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
    );
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const evidence = search.candidates.find((item) => item.path === "src/orders.ts")!;
      const run = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "multiple-invalid-evidence-run",
        client_name: "Claude Code",
      });
      const valid = {
        kind: "code" as const,
        path: evidence.path,
        start_line: evidence.startLine,
        end_line: evidence.endLine,
        excerpt: evidence.excerpt,
      };

      const error = await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [
          {
            external_id: "rule.valid",
            kind: "rule",
            title: "Valid evidence",
            statement: "This object has valid evidence but shares a batch with invalid ones.",
            confidence: 0.8,
            subjects: [],
            evidence: [valid],
          },
          {
            external_id: "rule.altered",
            kind: "rule",
            title: "Altered evidence",
            statement: "This object's excerpt was altered on its first line.",
            confidence: 0.8,
            subjects: [],
            evidence: [{ ...valid, excerpt: `altered${valid.excerpt}` }],
          },
          {
            external_id: "rule.missing-file",
            kind: "rule",
            title: "Missing file",
            statement: "This object cites a file that does not exist at the commit.",
            confidence: 0.8,
            subjects: [],
            evidence: [{ ...valid, path: "src/does-not-exist.ts" }],
          },
        ],
      }).catch((caught: Error) => caught);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/^2 excerpt\(s\) do not exactly match/);
      expect(message).toContain(`rule.altered: src/orders.ts:${valid.start_line}-${valid.end_line}: Line ${valid.start_line} differs.`);
      expect(message).toContain("rule.missing-file: src/does-not-exist.ts");
      expect(message).not.toContain("rule.valid:");
      expect(
        (await service.searchMemory("valid evidence")).filter((item) => item.title === "Valid evidence"),
      ).toHaveLength(0);
    } finally {
      (await service.close());
    }
  });

  it("links a run's objects to memory stored by an earlier run", async () => {
    const service = createService();
    try {
      const search = await service.searchRepository("shipping address dispatch");
      const evidence = search.candidates.find((item) => item.path === "src/orders.ts")!;
      const cited = [{
        kind: "code" as const,
        path: evidence.path,
        start_line: evidence.startLine,
        end_line: evidence.endLine,
        excerpt: evidence.excerpt,
      }];

      const firstRun = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "cross-run-first",
        client_name: "Claude Code",
      });
      const earlier = await service.proposeMemoryObjects({
        run_id: firstRun.id,
        objects: [{
          external_id: "control.dispatch-lock",
          kind: "control",
          title: "Dispatch lock",
          statement: "Dispatched orders cannot change their shipping address.",
          confidence: 0.9,
          subjects: [],
          evidence: cited,
        }],
      });
      (await service.completeSourceAnalysis(firstRun.id));
      const earlierId = earlier.items[0]!.id;

      const secondRun = await service.beginSourceAnalysis({
        commit_sha: search.commitSha,
        idempotency_key: "cross-run-second",
        client_name: "Claude Code",
      });
      await service.proposeMemoryObjects({
        run_id: secondRun.id,
        objects: [{
          external_id: "process.address-update",
          kind: "process",
          title: "Address update",
          statement: "Customers update a shipping address before dispatch.",
          confidence: 0.9,
          subjects: [],
          evidence: cited,
        }],
      });

      const linked = (await service.proposeRelationships({
        run_id: secondRun.id,
        relationships: [{
          from_external_id: "process.address-update",
          predicate: "governed_by",
          to_external_id: earlierId,
        }],
      }));
      expect(linked.relationships).toHaveLength(1);
      expect(linked.relationships[0]!.to_id).toBe(earlierId);

      await expect(service.proposeRelationships({
        run_id: secondRun.id,
        relationships: [{
          from_external_id: "process.address-update",
          predicate: "governed_by",
          to_external_id: "mem_does_not_exist",
        }],
      })).rejects.toThrow(/Not found: mem_does_not_exist/);

      (await service.archiveMemory(earlierId, earlierId));
      await expect(service.proposeRelationships({
        run_id: secondRun.id,
        relationships: [{
          from_external_id: "process.address-update",
          predicate: "related_to",
          to_external_id: earlierId,
        }],
      })).rejects.toThrow(new RegExp(`Not found: ${earlierId}`));
    } finally {
      (await service.close());
    }
  });

  it("registers repository authentication by environment-variable reference only", async () => {
    const service = createService();
    try {
      const source = (await service.registerSource({
        kind: "repository",
        name: "Harbour Services",
        locator: "https://github.com/example/harbour-services.git",
        authentication: "bearer_env",
        credential_env: "GITHUB_TOKEN",
      }));

      expect(source.status).toBe("configured");
      expect(source.metadata.authentication).toBe("bearer_env");
      expect(source.metadata.credential_env).toBe("GITHUB_TOKEN");
      expect(source.locator).not.toContain("token");
    } finally {
      (await service.close());
    }
  });

  it("investigates without turning every question into modeled knowledge", async () => {
    const service = createService("on");
    try {
      const first = await service.investigate(
        "Why can't a shipping address change after dispatch?",
      );
      expect(first.analysis.status).toBe("supported");
      expect(first.learned_memory).toEqual([]);

      const second = await service.investigate(
        "Why can't a shipping address change after dispatch?",
        first.conversation_id,
      );
      expect(second.learned_memory).toEqual([]);
      expect(second.conversation_id).toBe(first.conversation_id);
      expect((await service.getConversation(first.conversation_id)).turns).toHaveLength(2);
      expect((await service.workspace()).counts.memory).toBe(1);
    } finally {
      (await service.close());
    }
  });

  it("does not read the code in Ask unless code search is on", async () => {
    const calls: Array<Parameters<AnalysisAdapter["analyze"]>[0]> = [];
    const delegate = new EvidenceTestAdapter();
    for (const mode of ["off", "ask"] as const) {
      const service = new SpurService(
        new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
        new MemoryStore(":memory:"),
        { provider: "none", async analyze(input) { calls.push(input); return delegate.analyze(input); } },
        "none",
        "Test architect",
        process.cwd(),
        undefined,
        [],
        mode,
      );
      try {
        const result = await service.investigate("Why can't a shipping address change after dispatch?");
        expect(result.analysis.analysis.analyzed_files).toBe(0);
        expect(result.analysis.evidence).toEqual([]);
      } finally {
        await service.close();
      }
    }
    expect(calls).toEqual([]);
  });

  it("records a knowledge gap when Ask cannot answer", async () => {
    const service = createService("off");
    try {
      await service.investigate("Why can't a shipping address change after dispatch?");
      await service.investigate("What security vulnerabilities exist?");
      const gaps = await service.listKnowledgeGaps();
      expect(gaps.map((gap) => gap.question)).toEqual(["Why can't a shipping address change after dispatch?"]);
    } finally {
      await service.close();
    }
  });

  it("answers with typed memory and its connected model neighborhood", async () => {
    const store = new MemoryStore(":memory:");
    const delegate = new EvidenceTestAdapter();
    const calls: Array<Parameters<AnalysisAdapter["analyze"]>[0]> = [];
    const adapter: AnalysisAdapter = {
      provider: "openai",
      async analyze(input) {
        calls.push(input);
        return delegate.analyze(input);
      },
    };
    const entity = (await store.upsertMemory({
      kind: "entity",
      title: "Campaign budget",
      statement: "Campaign budget contains optimization limits.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      metadata: {
        entity_definition: {
          technical_name: "CampaignBudget",
          information_classification: "internal",
          attributes: [{ name: "customerBudgetLimit", data_type: "decimal" }],
          data_locations: [{
            system: "Northstar API",
            storage_type: "PostgreSQL",
            locator: "campaign_budget",
          }],
        },
      },
    }));
    const capability = (await store.upsertMemory({
      kind: "capability",
      title: "Campaign optimization",
      statement: "The organization can optimize campaign spend within a budget.",
      state: "accepted",
      authority: "person",
      confidence: 1,
    }));
    (await store.link(capability.id, "uses", entity.id));
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      store,
      adapter,
      "openai",
      "Test architect",
    );

    try {
      const result = await service.investigate(
        "Where is the customer budget limit stored?",
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.memoryContext?.items.map((item) => item.kind)).toEqual(
        expect.arrayContaining(["entity", "capability"]),
      );
      expect(calls[0]?.memoryContext?.relationships).toEqual([
        expect.objectContaining({
          from_id: capability.id,
          predicate: "uses",
          to_id: entity.id,
        }),
      ]);
      expect(result.analysis.memory_ids).toEqual(
        expect.arrayContaining([entity.id, capability.id]),
      );
      expect(result.learned_memory).toEqual([]);
    } finally {
      (await service.close());
    }
  });

  it("bounds prior conversation turns and supplies them as non-evidence context", async () => {
    const delegate = new EvidenceTestAdapter();
    const calls: Array<Parameters<AnalysisAdapter["analyze"]>[0]> = [];
    const adapter: AnalysisAdapter = {
      provider: "none",
      async analyze(input) {
        calls.push(input);
        return delegate.analyze(input);
      },
    };
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      new MemoryStore(":memory:"),
      adapter,
      "none",
      "Test architect",
      process.cwd(),
      undefined,
      [],
      "on",
    );
    try {
      const first = await service.investigate(
        "Why can't a shipping address change after dispatch?",
      );
      await service.investigate(
        "What about before dispatch?",
        first.conversation_id,
      );

      expect(calls).toHaveLength(2);
      expect(calls[1]?.conversationContext).toEqual([
        { role: "user", content: "Why can't a shipping address change after dispatch?" },
        { role: "assistant", content: first.answer.replace(/\s+/g, " ").trim() },
      ]);
      expect(calls[1]?.candidates.length).toBeGreaterThan(0);
    } finally {
      (await service.close());
    }
  });

  it("records a human-owned decision and relates it to existing memory", async () => {
    const service = createService();
    try {
      await service.workspace();
      const decision = (await service.recordDecision({
        title: "Fixture ownership",
        statement: "The fixture application is owned by Customer Operations.",
        rationale: "The team owns the customer-order workflow.",
        owner: "Enterprise Architect",
        related_to: ["fixture-repo"],
      }));
      const trace = (await service.traceRelationships("fixture ownership"));

      expect(decision.authority).toBe("person");
      expect(decision.state).toBe("accepted");
      expect(trace.matches[0]?.id).toBe(decision.id);
      expect(trace.relationships.some((item) => item.predicate === "affects")).toBe(true);
    } finally {
      (await service.close());
    }
  });

  it("requires an exact source confirmation before merging decisions", async () => {
    const service = createService();
    try {
      const target = (await service.recordDecision({
        title: "Budget policy", statement: "Budget changes require manager approval.",
        rationale: "The finance owner approved this rule.", owner: "Finance owner", related_to: ["budget"],
      }));
      const source = (await service.recordDecision({
        title: "Budget change decision", statement: "Managers approve material budget changes.",
        rationale: "Recorded during a review.", owner: "Finance owner", related_to: ["approval"],
      }));
      await expect(service.mergeMemory(source.id, target.id, "wrong ID"))
        .rejects.toThrow("Confirmation must match");
      expect((await service.getMemory(source.id))).not.toBeNull();
      const merged = (await service.mergeMemory(source.id, target.id, source.id));
      expect(merged.id).toBe(target.id);
      expect((await service.getMemory(source.id))).toBeNull();
      expect(merged.subjects).toEqual(["budget", "approval"]);
    } finally {
      (await service.close());
    }
  });

  it("edits, promotes, and recoverably deletes managed memory", async () => {
    const store = new MemoryStore(":memory:");
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      store,
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
    );
    try {
      const candidate = (await store.upsertMemory({
        kind: "rule",
        title: "Budget guardrail",
        statement: "Large budget changes require approval.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.82,
      }));

      const edited = (await service.editMemory(candidate.id, {
        action: "edit",
        kind: "control",
        title: "Budget change guardrail",
        statement: "Budget increases above the configured threshold require approval.",
        subjects: ["budget", "approval"],
      }));
      expect(edited.kind).toBe("control");
      expect(edited.metadata.last_edited_by).toBe("Test architect");

      const promoted = (await service.promoteMemory(candidate.id));
      expect(promoted).toMatchObject({ state: "accepted", authority: "person", confidence: 1 });
      expect(promoted.metadata.epistemic_status).toBe("human_verified");

      (await service.archiveMemory(candidate.id, candidate.id));
      expect((await service.getMemory(candidate.id))).toBeNull();
      expect((await store.getMemory(candidate.id))?.metadata.deleted_at).toBeDefined();
    } finally {
      (await service.close());
    }
  });

  it("answers from accepted memory when the live source has no matching evidence", async () => {
    const service = createService();
    try {
      (await service.recordDecision({
        title: "Customer identity master",
        statement: "CRM is the customer identity master.",
        rationale: "Customer Operations approved one authoritative identity source.",
        owner: "Customer Operations Owner",
        related_to: ["CRM", "customer identity"],
      }));

      const result = await service.investigate(
        "Which system is the customer identity master?",
      );
      expect(result.analysis.status).toBe("supported");
      expect(result.answer).toContain("CRM is the customer identity master");
    } finally {
      (await service.close());
    }
  });
});

describe("additional repositories", () => {
  it("verifies a run's excerpts against the repository it was opened for", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const root = mkdtempSync(path.join(tmpdir(), "spur-billing-"));
    writeFileSync(path.join(root, "invoice.py"), "def total(lines):\n    return sum(lines)\n");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
        cwd: root,
      }).toString().trim();
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    const commit = git("rev-parse", "HEAD");
    const store = new MemoryStore(":memory:");
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      store,
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
      process.cwd(),
      undefined,
      [new GitRepository(root)],
    );
    const object = {
      external_id: "rule.invoice-total",
      kind: "rule" as const,
      title: "Invoice total",
      statement: "An invoice total is the sum of its lines.",
      confidence: 0.9,
      subjects: [],
      evidence: [{
        kind: "code" as const,
        path: "invoice.py",
        start_line: 1,
        end_line: 2,
        excerpt: "def total(lines):\n    return sum(lines)",
      }],
    };
    try {
      await service.workspace();
      await expect(service.beginSourceAnalysis({
        commit_sha: commit,
        repository: "missing",
        idempotency_key: "additional-missing",
        client_name: "Claude Code",
      })).rejects.toThrow(/not configured/);

      const run = await service.beginSourceAnalysis({
        commit_sha: commit,
        repository: path.basename(root),
        idempotency_key: "additional-run",
        client_name: "Claude Code",
      });
      const result = await service.proposeMemoryObjects({ run_id: run.id, objects: [object] });
      expect(result.items).toHaveLength(1);

      const primary = (await store.listSources()).find((source) => source.metadata.active === true);
      expect(primary?.name).toBe("fixture-repo");

      const stored = result.items[0]!;
      const second = await service.beginSourceAnalysis({
        commit_sha: (await new GitRepository(path.resolve(process.cwd(), "fixture-repo")).metadata()).commitSha,
        idempotency_key: "primary-evidence",
        client_name: "Claude Code",
      });
      await expect(service.addEvidence({
        run_id: second.id,
        memory_id: stored.id,
        evidence: object.evidence,
      })).rejects.toThrow(/do not exactly match/);

      const search = await service.searchRepository("shipping address dispatch");
      const orders = search.candidates.find((item) => item.path === "src/orders.ts")!;
      const updated = await service.addEvidence({
        run_id: second.id,
        memory_id: stored.id,
        evidence: [{
          kind: "code",
          path: orders.path,
          start_line: orders.startLine,
          end_line: orders.endLine,
          excerpt: orders.excerpt,
        }],
      });
      expect(updated.evidence_ids).toHaveLength(2);
      expect(updated.evidence_ids).toContain(stored.evidence_ids[0]);
      expect(updated.source_ids).toHaveLength(2);
    } finally {
      (await service.close());
    }
  });
});

describe("code search modes", () => {
  function serviceWith(mode: "off" | "ask" | "on") {
    return new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      new MemoryStore(":memory:"),
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
      process.cwd(),
      undefined,
      [],
      mode,
    );
  }
  const question = "Why can't a shipping address change after dispatch?";

  it("answers from memory only and logs the gap when code search is off", async () => {
    const service = serviceWith("off");
    try {
      const result = await service.prepareHostInvestigation(question);
      expect(result.code_search).toMatchObject({ mode: "off", searched: false });
      expect(result.repository_evidence).toEqual([]);
      await expect(service.prepareHostInvestigation(question, { searchCode: true }))
        .rejects.toThrow(/Code search is off/);
      await expect(service.searchCode("shipping")).rejects.toThrow(/Code search is off/);
      expect((await service.listKnowledgeGaps())).toMatchObject([{ question, times_asked: 1 }]);
    } finally {
      (await service.close());
    }
  });

  it("searches code only after the user agrees when set to ask", async () => {
    const service = serviceWith("ask");
    try {
      const first = await service.prepareHostInvestigation(question);
      expect(first.code_search.searched).toBe(false);
      expect(first.answering_instructions.join(" ")).toContain("search_code true");

      const agreed = await service.prepareHostInvestigation(question, { searchCode: true });
      expect(agreed.code_search.searched).toBe(true);
      expect(agreed.repository_evidence.some((item) => item.path === "src/orders.ts")).toBe(true);
      expect(agreed.repository_evidence[0]?.repo).toBe("fixture-repo");
    } finally {
      (await service.close());
    }
  });

  it("always searches code when set to on", async () => {
    const service = serviceWith("on");
    try {
      const result = await service.prepareHostInvestigation(question);
      expect(result.code_search.searched).toBe(true);
      expect(result.answering_instructions.join(" ")).toContain("not yet modelled");
    } finally {
      (await service.close());
    }
  });

  it("counts a repeated knowledge gap instead of duplicating it", async () => {
    const service = serviceWith("ask");
    try {
      (await service.recordKnowledgeGap("How do peak-period events change budgets?", "Not modelled."));
      (await service.recordKnowledgeGap("How do  peak-period events change budgets?", "Not modelled."));
      expect((await service.listKnowledgeGaps())).toMatchObject([{ times_asked: 2 }]);
    } finally {
      (await service.close());
    }
  });
});

describe("pinned commits", () => {
  it("models an earlier commit without switching the checkout", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const root = mkdtempSync(path.join(tmpdir(), "spur-pinned-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
        cwd: root,
      }).toString().trim();
    git("init", "-q");
    writeFileSync(path.join(root, "rule.py"), "LIMIT = 7000\n");
    git("add", ".");
    git("commit", "-qm", "first");
    const first = git("rev-parse", "HEAD");
    writeFileSync(path.join(root, "rule.py"), "LIMIT = 10000\n");
    git("commit", "-qam", "second");
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      new MemoryStore(":memory:"),
      new EvidenceTestAdapter(),
      "none",
      "Test architect",
      process.cwd(),
      undefined,
      [new GitRepository(root)],
    );
    try {
      await expect(service.beginSourceAnalysis({
        commit_sha: "0".repeat(40),
        repository: path.basename(root),
        idempotency_key: "pinned-missing",
        client_name: "Claude Code",
      })).rejects.toThrow(/not in the repository/);

      const run = await service.beginSourceAnalysis({
        commit_sha: first,
        repository: path.basename(root),
        idempotency_key: "pinned-first",
        client_name: "Claude Code",
      });
      expect(run.source_version).toBe(first);
      const result = await service.proposeMemoryObjects({
        run_id: run.id,
        objects: [{
          external_id: "rule.limit",
          kind: "rule",
          title: "Limit",
          statement: "The limit is 7,000.",
          confidence: 0.9,
          subjects: [],
          evidence: [{ kind: "code", path: "rule.py", start_line: 1, end_line: 1, excerpt: "LIMIT = 7000" }],
        }],
      });
      expect(result.items).toHaveLength(1);
    } finally {
      (await service.close());
    }
  });
});
