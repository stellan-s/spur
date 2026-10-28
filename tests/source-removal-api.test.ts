import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "@/app/api/sources/route";
import { GET as repositoryStatus } from "@/app/api/repository/route";
import * as auth from "@/core/auth";
import { localPrincipal } from "@/core/access-store";
import { loadConfig } from "@/core/config";
import { TestMemoryStore } from "./support/postgres";

const stores: TestMemoryStore[] = [];

async function setup() {
  const store = new TestMemoryStore();
  stores.push(store);
  vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL!);
  vi.stubEnv("SPUR_ORGANIZATION_SLUG", store.organizationId);
  vi.stubEnv("SPUR_AUTH", "none");
  vi.stubEnv("SPUR_BIND_ADDRESS", "127.0.0.1");
  vi.stubEnv("SPUR_SYNTHESIS_PROVIDER", "none");
  vi.stubEnv("SPUR_REPOSITORY_ROOT", path.resolve("fixture-repo"));
  const source = await store.upsertSource({
    kind: "document", name: "Documentation", locator: "https://example.com/docs", status: "configured",
  });
  return { store, source };
}

function remove(body: unknown, headers: Record<string, string> = {}) {
  return DELETE(new Request("http://localhost/api/sources", {
    method: "DELETE", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("source removal HTTP API", () => {
  it("removes a source and safely accepts repeated requests", async () => {
    const { store, source } = await setup();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await remove({ id: source.id });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: source.id, removed: true });
    }
    expect(await store.listSources()).toEqual([]);
    expect((await store.getSource(source.id))?.metadata.removed_at).toBeTypeOf("string");
  });

  it("reports a removed main repository as disconnected", async () => {
    await setup();
    const before = await repositoryStatus(new Request("http://localhost/api/repository"));
    expect((await before.json()).ready).toBe(true);
    const store = stores[0];
    const primary = (await store.listSources()).find((source) => source.metadata.active)!;
    expect((await remove({ id: primary.id })).status).toBe(200);
    const after = await repositoryStatus(new Request("http://localhost/api/repository"));
    expect(after.status).toBe(200);
    expect((await after.json()).ready).toBe(false);
    expect((await store.listSources()).map((source) => source.id)).not.toContain(primary.id);
  });

  it("rejects malformed input and returns 404 for unavailable sources", async () => {
    const { store, source } = await setup();
    expect((await remove({})).status).toBe(400);
    expect((await remove({ id: " " })).status).toBe(400);
    expect((await remove({ id: "unknown" })).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/sources", { method: "DELETE", body: "{" }))).status).toBe(400);
    const other = new TestMemoryStore();
    stores.push(other);
    await other.upsertSource({ id: "src_other_org", kind: "document", name: "Other", locator: "https://example.com/other", status: "configured" });
    expect((await remove({ id: "src_other_org" })).status).toBe(404);
    expect(await store.listSources()).toEqual([source]);
    expect(await other.listSources()).toHaveLength(1);
  });

  it("requires sources.manage permission", async () => {
    const { store, source } = await setup();
    const principal = localPrincipal(store.organizationId, "Reader");
    principal.permissions = new Set(["memory.read"]);
    vi.spyOn(auth, "authenticateRequest").mockResolvedValue({ principal, config: loadConfig() });
    expect((await remove({ id: source.id })).status).toBe(403);
    expect(await store.listSources()).toEqual([source]);
    principal.permissions.add("sources.manage");
    expect((await remove({ id: source.id })).status).toBe(200);
  });

  it("refuses cross-origin requests and missing Google sessions", async () => {
    const { store, source } = await setup();
    expect((await remove({ id: source.id }, { origin: "https://other.example" })).status).toBe(403);
    vi.stubEnv("SPUR_AUTH", "google");
    vi.stubEnv("SPUR_GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("SPUR_GOOGLE_CLIENT_SECRET", "test-secret");
    expect((await remove({ id: source.id })).status).toBe(401);
    expect(await store.listSources()).toEqual([source]);
  });
});
