import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import { TestMemoryStore } from "./support/postgres";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";

const stores: TestMemoryStore[] = [];

function setup(additional: GitRepository[] = []) {
  const store = new TestMemoryStore();
  stores.push(store);
  const repository = new GitRepository(path.resolve("fixture-repo"));
  const service = new SpurService(repository, store, new EvidenceTestAdapter(), "none", "Test architect",
    process.cwd(), { slug: store.organizationId, name: "Test" }, additional, "on");
  return { store, repository, service };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  vi.restoreAllMocks();
});

describe("source removal", () => {
  it("hides only the selected source and keeps its evidence, memory, relationships and analysis runs", async () => {
    const { store, service } = setup();
    const workspace = await service.workspace();
    const source = await store.upsertSource({
      id: "src_configured_repository", kind: "repository", name: "Harbour Services", locator: "https://github.com/example/harbour",
      status: "configured", enabled: false, metadata: { active: false },
    });
    const evidence = await store.storeEvidence(source.id, {
      id: "test", kind: "code", repo: source.name, commit_sha: "a".repeat(40),
      path: "project.ts", start_line: 1, end_line: 1, excerpt: "export const project = {};", supports: ["observed_behavior"],
    });
    const item = await store.upsertMemory({
      kind: "entity", title: "Project", statement: "A project holds a budget.",
      state: "accepted", authority: "system", confidence: 1,
      sourceIds: [source.id], evidenceIds: [evidence.id],
    });
    const relationship = await store.link(workspace.memory[0].id, "uses", item.id);
    const run = await store.beginSourceAnalysis({
      sourceId: source.id, sourceVersion: "a".repeat(40), idempotencyKey: "old-run", clientName: "Test",
    });
    expect(await service.removeSource(source.id)).toEqual({ id: source.id, removed: true });
    const after = await service.workspace();
    expect(after.sources.map((entry) => entry.id)).toEqual(workspace.sources.map((entry) => entry.id));
    expect(after.counts.sources).toBe(workspace.counts.sources);
    expect(after.memory).toContainEqual(item);
    expect(after.relationships).toContainEqual(relationship);
    expect(await service.getEvidence(evidence.id)).toEqual(evidence);
    expect(await store.getSourceAnalysisRun(run.id)).toEqual(run);
    expect(await store.getSource(source.id)).toMatchObject({
      enabled: false, status: "disabled", metadata: { active: false, removed_at: expect.any(String), removed_by: "Test architect" },
    });
    expect(await service.removeSource(source.id)).toEqual({ id: source.id, removed: true });
  });

  it("scopes removal to the organization even when IDs are identical", async () => {
    const first = setup();
    const other = setup();
    const input = { id: "src_shared", kind: "document" as const, name: "Documents", locator: "https://example.com/docs", status: "configured" as const };
    await first.store.upsertSource(input);
    const untouched = await other.store.upsertSource(input);
    await first.service.removeSource(input.id);
    expect(await first.store.listSources()).toEqual([]);
    expect(await other.store.getSource(input.id)).toEqual(untouched);
    await expect(other.service.removeSource("src_missing")).rejects.toThrow("Source was not found.");
  });

  it.each(["repository", "mcp_server", "document"] as const)("requires explicit re-registration to restore a removed %s", async (kind) => {
    const { store, service } = setup();
    const input = {
      kind, name: "Example", locator: kind === "repository" ? "https://github.com/example/portal" : "https://example.com/source",
      authentication: "bearer_env" as const, credential_env: "EXAMPLE_TOKEN",
    };
    const source = await service.registerSource(input);
    await service.removeSource(source.id);
    await store.upsertSource({ ...source, enabled: true, status: "connected", metadata: {} });
    expect(await store.listSources()).toEqual([]);
    await expect(service.setSourceEnabled(source.id, true)).rejects.toThrow("Source was not found.");
    expect(await store.setSourceEnabled(source.id, true)).toBeNull();
    const restored = await service.registerSource(input);
    expect(restored.id).toBe(source.id);
    expect(restored.enabled).toBe(true);
    expect(restored.metadata).not.toHaveProperty("removed_at");
    expect(await store.listSources()).toEqual([restored]);
  });

  it("does not read or resurrect the main repository on refresh, restart or a memory-based answer", async () => {
    const { store, service, repository } = setup();
    const workspace = await service.workspace();
    const source = workspace.sources[0];
    const item = await store.upsertMemory({
      kind: "entity", title: "Project budget", statement: "A project has a budget for planning campaigns.",
      state: "accepted", authority: "person", confidence: 1,
    });
    await service.removeSource(source.id);
    const metadata = vi.spyOn(repository, "metadata").mockRejectedValue(new Error("Removed repository must not be accessed"));
    const restarted = new SpurService(repository, store, new EvidenceTestAdapter(), "none", "Test architect",
      process.cwd(), { slug: store.organizationId, name: "Test" }, [], "on");
    expect(await restarted.workspace()).toMatchObject({ sources: [], repository: { ready: false }, counts: { sources: 0 } });
    expect((await restarted.investigate("What is a project budget?")).answer).toContain(item.statement);
    expect(await restarted.searchCode("project budget")).toEqual({ repositories: [], candidates: [] });
    expect((await restarted.prepareHostInvestigation("What is a project budget?", { searchCode: true })).recalled_memory)
      .toContainEqual(item);
    await expect(restarted.searchRepository("project budget")).rejects.toThrow("source has been removed");
    await expect(restarted.beginSourceAnalysis({
      commit_sha: String(source.metadata.commit_sha), idempotency_key: "removed-source", client_name: "Test",
    })).rejects.toThrow("source has been removed");
    expect(metadata).not.toHaveBeenCalled();
  });

  it("excludes configured additional repositories and blocks writes from their open modelling runs", async () => {
    const additional = new GitRepository("/not-accessed/payments");
    const metadata = vi.spyOn(additional, "metadata").mockResolvedValue({ name: "Payments", commitSha: "a".repeat(40), remoteUrl: null });
    const { store, service } = setup([additional]);
    const run = await service.beginSourceAnalysis({
      repository: "Payments", commit_sha: "a".repeat(40), idempotency_key: "payments", client_name: "Test",
    });
    await service.removeSource(run.source_id);
    metadata.mockClear().mockRejectedValue(new Error("Removed repository must not be accessed"));
    const searched = await service.searchCode("project budget");
    expect(searched.repositories.map((entry) => entry.name)).not.toContain("Payments");
    await expect(service.beginSourceAnalysis({
      repository: "Payments", commit_sha: "a".repeat(40), idempotency_key: "payments-2", client_name: "Test",
    })).rejects.toThrow("not configured");
    await expect(service.proposeMemoryObjects({ run_id: run.id, objects: [{
      external_id: "project", kind: "entity", title: "Project", statement: "A project has a budget.", confidence: 1,
      entity_definition: { attributes: [], data_locations: [] },
      subjects: [], evidence: [{ path: "project.ts", kind: "code", start_line: 1, end_line: 1, excerpt: "project" }],
    }] })).rejects.toThrow("source has been removed");
    expect((await store.getSource(run.source_id))?.enabled).toBe(false);
    expect(metadata).not.toHaveBeenCalled();
  });
});
