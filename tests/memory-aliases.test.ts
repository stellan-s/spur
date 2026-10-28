import path from "node:path";

import { describe, expect, it } from "vitest";

import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";
import { TestMemoryStore } from "./support/postgres";

describe("memory aliases", () => {
  it("keeps user provenance while proposed aliases improve retrieval", async () => {
    const store = new TestMemoryStore();
    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      store,
      new EvidenceTestAdapter(),
      "none",
      "usr_alias_author",
    );
    try {
      const capability = await store.upsertMemory({
        kind: "capability",
        title: "Integrated search intelligence",
        statement: "The portal combines paid and organic search analysis.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.84,
      });

      const proposed = await service.proposeMemoryAlias({
        memory_id: capability.id,
        name: "Holistic search",
      });
      expect(proposed).toMatchObject({
        memory_id: capability.id,
        name: "Holistic search",
        status: "proposed",
        origin: "user",
        scope: "organization",
        actor: "usr_alias_author",
        metadata: { epistemic_status: "user_generated_suggestion" },
      });
      expect((await service.searchMemory("holistic search")).map((item) => item.id))
        .toContain(capability.id);

      await expect(service.reviewMemoryAlias({
        memory_id: capability.id,
        alias_id: proposed.id,
        action: "verify",
        note: "Confirmed in product documentation.",
        confirmation: "wrong-alias",
      })).rejects.toThrow("Confirmation must match the alias ID");

      const verified = await service.reviewMemoryAlias({
        memory_id: capability.id,
        alias_id: proposed.id,
        action: "verify",
        note: "Confirmed in product documentation.",
        confirmation: proposed.id,
      });
      expect(verified).toMatchObject({
        status: "verified",
        origin: "user",
        reviewed_by: "usr_alias_author",
        review_note: "Confirmed in product documentation.",
      });
    } finally {
      await service.close();
    }
  });

  it("excludes rejected aliases from retrieval and carries provenance through merges", async () => {
    const store = new TestMemoryStore();
    try {
      const target = await store.upsertMemory({
        kind: "capability",
        title: "Search intelligence",
        statement: "Search intelligence combines campaign analysis.",
        state: "accepted",
        authority: "person",
        confidence: 1,
      });
      const source = await store.upsertMemory({
        kind: "capability",
        title: "Search overview",
        statement: "Search overview presents paid and organic performance.",
        state: "candidate",
        authority: "ai_inference",
        confidence: 0.8,
      });
      const alias = await store.upsertMemoryAlias({
        memoryId: source.id,
        name: "Unified discoverability",
        status: "proposed",
        origin: "user",
        scope: "organization",
        actor: "usr_contributor",
      });

      expect((await store.searchMemory("unified discoverability")).map((item) => item.id))
        .toContain(source.id);
      await store.reviewMemoryAlias(source.id, alias.id, "rejected", "usr_reviewer", "Not an established term.");
      expect(await store.searchMemory("unified discoverability")).toEqual([]);

      const repository = await store.upsertSource({
        kind: "repository",
        name: "Portal",
        locator: "https://example.com/portal.git",
        status: "connected",
      });
      const acceptedAlias = await store.upsertMemoryAlias({
        memoryId: source.id,
        name: "Search command center",
        status: "verified",
        origin: "repository",
        scope: "repository",
        sourceId: repository.id,
        sourceVersion: "abc123",
        actor: "spur-model-repository",
      });
      const merged = await store.mergeMemory(source.id, target.id, "usr_reviewer");
      expect(merged.aliases).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: acceptedAlias.name,
          origin: "repository",
          status: "verified",
        }),
      ]));
      expect((await store.listMemoryAliases(source.id))).toEqual([]);
    } finally {
      await store.close();
    }
  });
});
