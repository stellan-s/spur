import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/knowledge-gaps/route";
import { PATCH } from "@/app/api/knowledge-gaps/[id]/route";
import { setFeature } from "@/core/features";
import { localPrincipal } from "@/core/access-store";
import { knowledgeGapSchema } from "@/core/knowledge-gap-types";
import { BETA_NOTICE_ENGLISH } from "@/core/beta-notice";
import { createSpurMcpServer } from "@/mcp/server";
import { TestMemoryStore } from "./support/postgres";

const stores: TestMemoryStore[] = [];

function setup() {
  const store = new TestMemoryStore();
  stores.push(store);
  vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL!);
  vi.stubEnv("SPUR_ORGANIZATION_SLUG", store.organizationId);
  vi.stubEnv("SPUR_AUTH", "none");
  vi.stubEnv("SPUR_BIND_ADDRESS", "127.0.0.1");
  vi.stubEnv("SPUR_SYNTHESIS_PROVIDER", "none");
  vi.stubEnv("SPUR_REPOSITORY_ROOT", path.resolve("fixture-repo"));
  return store;
}

function patch(id: string, body: unknown) {
  return PATCH(new Request(`http://localhost/api/knowledge-gaps/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

async function verifiedMemory(store: TestMemoryStore, title: string, statement: string) {
  const source = await store.upsertSource({
    id: "src_gap_api", kind: "repository", name: "Planning service",
    locator: "https://github.com/example/planning", status: "connected", enabled: true,
  });
  const evidence = await store.storeEvidence(source.id, {
    id: title, kind: "code", repo: source.name, commit_sha: "a".repeat(40),
    path: "src/planning.ts", start_line: 1, end_line: 1,
    excerpt: "export const seasonalPlanning = true;", supports: ["observed_behavior"],
  });
  return store.upsertMemory({
    kind: "process", title, statement, state: "accepted", authority: "ai_inference", confidence: 1,
    evidenceIds: [evidence.id], sourceIds: [source.id], sourceVersion: "a".repeat(40),
    metadata: { evidence_status: "verified" },
  });
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  vi.unstubAllEnvs();
});

describe("knowledge gap HTTP API", () => {
  it("resolves, filters, and reopens a gap through the authenticated route", async () => {
    const store = setup();
    const gap = await store.recordKnowledgeGap("How does seasonal planning work?", "Not modelled.");
    const memory = await verifiedMemory(store, "Seasonal planning", "A planner schedules the campaign budget.");
    const response = await patch(gap.id, { action: "resolve", note: "The planning process describes the steps.", memory_ids: [memory.id], confirmation: gap.id });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "resolved", history: [{ action: "resolve", memory_ids: [memory.id] }] });
    const open = await GET(new Request("http://localhost/api/knowledge-gaps?status=open"));
    expect(await open.json()).toEqual({ gaps: [] });
    const resolved = await GET(new Request("http://localhost/api/knowledge-gaps?status=resolved"));
    expect((await resolved.json()).gaps).toHaveLength(1);
    expect((await patch(gap.id, { action: "reopen", note: "The exception flow is still unknown." })).status).toBe(200);
    expect((await store.getKnowledgeGap(gap.id))?.history).toHaveLength(2);
  });

  it("returns validation and not-found errors without mutating a gap", async () => {
    const store = setup();
    const gap = await store.recordKnowledgeGap("What can a project contain?", "Not modelled.");
    expect((await patch(gap.id, { action: "resolve", note: "Now known.", memory_ids: [], confirmation: gap.id })).status).toBe(400);
    expect((await patch("gap_missing", { action: "reopen", note: "Still missing." })).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/knowledge-gaps?status=invalid"))).status).toBe(400);
    expect(await store.getKnowledgeGap(gap.id)).toMatchObject({ status: "open", history: [] });
  });

  it("refuses a disabled feature and a missing Google session", async () => {
    const store = setup();
    const gap = await store.recordKnowledgeGap("What can a project contain?", "Not modelled.");
    await setFeature(store.organizationId, "knowledge_gaps", false, "local", process.env);
    expect((await patch(gap.id, { action: "reopen", note: "Still missing." })).status).toBe(403);
    vi.stubEnv("SPUR_AUTH", "google");
    vi.stubEnv("SPUR_GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("SPUR_GOOGLE_CLIENT_SECRET", "test-secret");
    expect((await patch(gap.id, { action: "reopen", note: "Still missing." })).status).toBe(401);
    expect(await store.getKnowledgeGap(gap.id)).toMatchObject({ status: "open", history: [] });
  });

  it("resolves and reopens through MCP without a model provider", async () => {
    const store = setup();
    const item = await verifiedMemory(store, "Planning", "Planning schedules seasonal budgets.");
    const gap = await store.recordKnowledgeGap("How does planning work?", "Not modelled.");
    type Server = {
      _registeredTools: Record<string, {
        handler: (input: unknown) => Promise<{ structuredContent: unknown; content: { text: string }[] }>;
      }>;
    };
    const server = await createSpurMcpServer({
      principal: localPrincipal(store.organizationId, "Test modeller"),
      features: { ask: true, code_search: "off", model_provider: "none", modelling_writes: true, isms: true, wiki: true, remote_mcp: false, knowledge_gaps: true },
    }) as unknown as Server;
    const result = await server._registeredTools.resolve_knowledge_gap.handler({
      id: gap.id, note: "The planning process now describes seasonal budgets.", memory_ids: [item.id], confirmation: gap.id,
    });
    expect(knowledgeGapSchema.parse(result.structuredContent)).toMatchObject({ status: "resolved", history: [{ memory_ids: [item.id] }] });
    expect(result.content.some((part) => part.text.includes(BETA_NOTICE_ENGLISH))).toBe(true);
    const open = await server._registeredTools.list_knowledge_gaps.handler({ limit: 100, status: "open" });
    expect(open.structuredContent).toEqual({ gaps: [] });
    const reopened = await server._registeredTools.reopen_knowledge_gap.handler({ id: gap.id, note: "Exceptions still need to be modelled." });
    expect(knowledgeGapSchema.parse(reopened.structuredContent).history.map((entry) => entry.action)).toEqual(["resolve", "reopen"]);
  });
});
