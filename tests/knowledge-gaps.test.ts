import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localPrincipal } from "@/core/access-store";
import { authorizePrincipalForApiRequest } from "@/core/auth";
import { knowledgeGapSchema, updateKnowledgeGapInputSchema } from "@/core/knowledge-gap-types";
import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import { createSpurMcpServer, recordKnowledgeGapToolInputSchema } from "@/mcp/server";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";
import { TestMemoryStore } from "./support/postgres";

const stores: TestMemoryStore[] = [];

function setup() {
  const store = new TestMemoryStore();
  stores.push(store);
  const service = new SpurService(
    new GitRepository(path.resolve("fixture-repo")), store,
    new EvidenceTestAdapter(), "none", "Test reviewer",
  );
  return { store, service };
}

function memory(store: TestMemoryStore, overrides = {}) {
  return store.upsertMemory({
    kind: "capability", title: "Campaign planning",
    statement: "Campaign planning supports scheduled seasonal budgets.",
    state: "candidate", authority: "ai_inference", confidence: 0.85,
    ...overrides,
  });
}

const question = "How are seasonal budgets planned?";

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  vi.unstubAllEnvs();
});

describe("knowledge gap resolution", () => {
  it("requires two distinct retrieval phrasings before MCP can record a gap", () => {
    const base = {
      question,
      reason: "Neither search returned knowledge that answered the question.",
    };
    expect(() => recordKnowledgeGapToolInputSchema.parse({
      ...base,
      queries_tried: [question],
    })).toThrow();
    expect(() => recordKnowledgeGapToolInputSchema.parse({
      ...base,
      queries_tried: [question, `  ${question.toUpperCase()}  `],
    })).toThrow();
    expect(recordKnowledgeGapToolInputSchema.parse({
      ...base,
      queries_tried: [question, "seasonal budget planning"],
    }).queries_tried).toHaveLength(2);
  });

  it("resolves against catalog items and retains an attributed history without promoting them", async () => {
    const { store, service } = setup();
    const item = await memory(store);
    const gap = await service.recordKnowledgeGap(question, "Not modelled yet.");
    expect(gap).toMatchObject({ status: "open", history: [], times_asked: 1 });
    const resolved = await service.updateKnowledgeGap(gap.id, {
      action: "resolve", note: "The planning capability now describes seasonal budgets.", memory_ids: [item.id, item.id],
    });
    expect(knowledgeGapSchema.parse(resolved)).toMatchObject({
      status: "resolved", question, times_asked: 1,
      history: [{ action: "resolve", memory_ids: [item.id], actor: "Test reviewer", created_at: expect.any(String) }],
    });
    expect((await store.getMemory(item.id))?.state).toBe("candidate");
    expect(await service.listKnowledgeGaps(100, "open")).toEqual([]);
    expect(await service.listKnowledgeGaps(100, "resolved")).toEqual([resolved]);
    expect(await service.listKnowledgeGaps()).toEqual([resolved]);
  });

  it("reopens manually, preserves earlier notes and supports another resolution", async () => {
    const { store, service } = setup();
    const item = await memory(store);
    const gap = await service.recordKnowledgeGap(question, "Not modelled.");
    const input = { action: "resolve" as const, note: "The seasonal planning flow is documented.", memory_ids: [item.id] };
    await service.updateKnowledgeGap(gap.id, input);
    const reopened = await service.updateKnowledgeGap(gap.id, { action: "reopen", note: "Weekend exceptions are still missing." });
    expect(reopened.status).toBe("open");
    expect(reopened.history.map((entry) => entry.action)).toEqual(["resolve", "reopen"]);
    expect(reopened.history[0].memory_ids).toEqual([item.id]);
    expect(reopened.history[1].note).toBe("Weekend exceptions are still missing.");
    const resolved = await service.updateKnowledgeGap(gap.id, input);
    expect(resolved.history.map((entry) => entry.action)).toEqual(["resolve", "reopen", "resolve"]);
  });

  it("reopens a resolved gap when the unanswered question recurs, without duplicate gaps or lost counts", async () => {
    const { store, service } = setup();
    const item = await memory(store);
    const gap = await service.recordKnowledgeGap(question, "Not modelled.");
    await service.updateKnowledgeGap(gap.id, { action: "resolve", note: "Planning is now modelled.", memory_ids: [item.id] });
    const repeated = await service.recordKnowledgeGap("How are  seasonal budgets planned?", "The stored answer was insufficient.");
    expect(repeated).toMatchObject({ id: gap.id, status: "open", times_asked: 2, first_asked_at: gap.first_asked_at });
    expect(repeated.history).toHaveLength(2);
    expect(repeated.history[1]).toMatchObject({ action: "reopen", actor: "Test reviewer" });
    const third = await service.recordKnowledgeGap(question, "Still not modelled.");
    expect(third.history).toHaveLength(2);
    expect(third.times_asked).toBe(3);
    expect(await service.listKnowledgeGaps()).toHaveLength(1);
  });

  it("requires a note and supporting knowledge for resolution", () => {
    expect(() => updateKnowledgeGapInputSchema.parse({ action: "resolve", note: "   ", memory_ids: ["mem_a"] })).toThrow();
    expect(() => updateKnowledgeGapInputSchema.parse({ action: "resolve", note: "Now documented.", memory_ids: [] })).toThrow();
    expect(() => updateKnowledgeGapInputSchema.parse({ action: "reopen", note: " " })).toThrow();
  });

  it("rejects missing, unavailable and restricted knowledge without changing the gap", async () => {
    const { store, service } = setup();
    const gap = await service.recordKnowledgeGap(question, "Not modelled.");
    const ids = ["mem_missing"];
    for (const state of ["stale", "disputed", "deleted"]) {
      ids.push((await memory(store, { state, statement: `Unavailable ${state} planning knowledge.` })).id);
    }
    ids.push((await memory(store, { statement: "Restricted planning knowledge.", metadata: { sensitivity: "restricted" } })).id);
    ids.push((await memory(store, { statement: "Legacy archived planning knowledge.", metadata: { deleted_at: "2026-01-01" } })).id);
    for (const id of ids) {
      await expect(service.updateKnowledgeGap(gap.id, { action: "resolve", note: "Now documented.", memory_ids: [id] })).rejects.toThrow();
      expect(await store.getKnowledgeGap(gap.id)).toMatchObject({ status: "open", history: [] });
    }
  });

  it("isolates gap updates and supporting knowledge by organization", async () => {
    const first = setup();
    const second = setup();
    const firstGap = await first.service.recordKnowledgeGap(question, "First organization's gap.");
    const secondItem = await memory(second.store);
    await expect(second.service.updateKnowledgeGap(firstGap.id, { action: "reopen", note: "Not answered." })).rejects.toMatchObject({ status: 404 });
    await expect(first.service.updateKnowledgeGap(firstGap.id, { action: "resolve", note: "Now documented.", memory_ids: [secondItem.id] })).rejects.toThrow();
    const secondGap = await second.service.recordKnowledgeGap(question, "Second organization's gap.");
    expect(secondGap.id).toBe(firstGap.id);
    await second.service.updateKnowledgeGap(secondGap.id, { action: "resolve", note: "Now documented.", memory_ids: [secondItem.id] });
    expect((await first.store.getKnowledgeGap(firstGap.id))?.status).toBe("open");
    expect((await second.store.getKnowledgeGap(secondGap.id))?.status).toBe("resolved");
  });

  it("serializes simultaneous resolutions instead of overwriting history", async () => {
    const { store, service } = setup();
    const item = await memory(store);
    const gap = await service.recordKnowledgeGap(question, "Not modelled.");
    const input = { action: "resolve" as const, note: "Now documented.", memory_ids: [item.id] };
    const results = await Promise.allSettled([service.updateKnowledgeGap(gap.id, input), service.updateKnowledgeGap(gap.id, input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await store.getKnowledgeGap(gap.id))?.history).toHaveLength(1);
  });

  it("returns a newly recorded gap even outside the top 100 questions", async () => {
    const { store } = setup();
    await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      await store.recordKnowledgeGap(`Previously asked question ${index}`, "No answer.");
      await store.recordKnowledgeGap(`Previously asked question ${index}`, "No answer.");
    }));
    const gap = await store.recordKnowledgeGap("Another new question", "No answer.");
    expect(gap.question).toBe("Another new question");
    expect(gap.status).toBe("open");
  });

  it("requires write permission for the API and MCP resolution tools", async () => {
    const principal = localPrincipal("demo", "Reader");
    principal.permissions = new Set(["memory.read", "knowledge_gaps.read", "mcp.connect"]);
    const request = new Request("http://localhost/api/knowledge-gaps/gap_test", { method: "PATCH" });
    expect(() => authorizePrincipalForApiRequest(request, principal)).toThrow();
    const features = { ask: true, code_search: "off" as const, model_provider: "none" as const, modelling_writes: true, isms: true, wiki: true, remote_mcp: false, knowledge_gaps: true };
    type Server = { _registeredTools: Record<string, { enabled: boolean }> };
    const reader = await createSpurMcpServer({ principal, features }) as unknown as Server;
    expect(reader._registeredTools.list_knowledge_gaps.enabled).toBe(true);
    expect(reader._registeredTools.resolve_knowledge_gap.enabled).toBe(false);
    expect(reader._registeredTools.reopen_knowledge_gap.enabled).toBe(false);
    principal.permissions.add("knowledge_gaps.write");
    expect(() => authorizePrincipalForApiRequest(request, principal)).not.toThrow();
    const writer = await createSpurMcpServer({ principal, features }) as unknown as Server;
    expect(writer._registeredTools.resolve_knowledge_gap.enabled).toBe(true);
    expect(writer._registeredTools.reopen_knowledge_gap.enabled).toBe(true);
    const disabled = await createSpurMcpServer({ principal, features: { ...features, knowledge_gaps: false } }) as unknown as Server;
    expect(disabled._registeredTools.resolve_knowledge_gap.enabled).toBe(false);
    expect(disabled._registeredTools.reopen_knowledge_gap.enabled).toBe(false);
  });
});
