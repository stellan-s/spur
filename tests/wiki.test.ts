import path from "node:path";

import { describe, expect, it } from "vitest";

import { GitRepository } from "@/core/repository";
import { SpurService } from "@/core/spur-service";
import { renderWikiArticleMarkdown, renderWikiMarkdown } from "@/core/wiki";
import { TestMemoryStore as MemoryStore } from "./support/postgres";
import { EvidenceTestAdapter } from "./support/evidence-test-adapter";

describe("live wiki", () => {
  it("groups related knowledge under capabilities and masks restricted controls", async () => {
    const store = new MemoryStore(":memory:");
    const capability = await store.upsertMemory({
      kind: "capability",
      title: "Manage fulfilment",
      statement: "The organisation can fulfil customer orders.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      subjects: ["orders"],
    });
    const processMemory = await store.upsertMemory({
      kind: "process",
      title: "Dispatch an order",
      statement: "Operations dispatch an approved order.",
      state: "candidate",
      authority: "ai_inference",
      confidence: 0.8,
      subjects: ["orders"],
    });
    const control = await store.upsertMemory({
      kind: "control",
      title: "Confidential dispatch gate",
      statement: "Internal phrase orchard-lantern protects dispatch.",
      state: "accepted",
      authority: "person",
      confidence: 1,
      subjects: ["dispatch"],
      metadata: { sensitivity: "restricted" },
    });
    const entity = await store.upsertMemory({
      kind: "entity",
      title: "Warehouse",
      statement: "A warehouse stores inventory.",
      state: "candidate",
      authority: "ai_inference",
      confidence: 0.7,
      subjects: ["inventory"],
    });
    await store.link(capability.id, "implemented_by", processMemory.id);
    await store.link(processMemory.id, "constrained_by", control.id);

    const service = new SpurService(
      new GitRepository(path.resolve(process.cwd(), "fixture-repo")),
      store,
      new EvidenceTestAdapter(),
      "none",
      "Wiki reader",
      process.cwd(),
      { slug: "wiki-test", name: "Wiki test" },
      [],
      "off",
      undefined,
      "Security team",
      { restrictedRead: false, restrictedWrite: false },
    );
    try {
      const wiki = await service.wiki();
      expect(wiki.capabilities).toHaveLength(1);
      expect(wiki.articles).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: capability.id }),
        expect.objectContaining({ id: processMemory.id }),
      ]));
      expect(wiki.links).toEqual(expect.arrayContaining([
        expect.objectContaining({ from_id: capability.id, to_id: processMemory.id }),
      ]));
      expect(wiki.capabilities[0].capability).toMatchObject({
        title: "Manage fulfilment",
        state: "accepted",
      });
      expect(wiki.capabilities[0].processes).toEqual([
        expect.objectContaining({ id: processMemory.id, state: "candidate" }),
      ]);
      expect(wiki.capabilities[0].controls).toEqual([
        expect.objectContaining({
          id: control.id,
          title: "Restricted security control",
          statement: expect.stringContaining("Ask Security team"),
        }),
      ]);
      expect(wiki.ungrouped.entities).toEqual([expect.objectContaining({ id: entity.id })]);

      const markdown = renderWikiMarkdown(wiki);
      expect(markdown).toContain("**Status:** Confirmed");
      expect(markdown).toContain("Dispatch an order** — Candidate");
      expect(markdown).toContain("Restricted security control");
      expect(markdown).not.toContain("orchard-lantern");

      const articleMarkdown = renderWikiArticleMarkdown(wiki, capability.id);
      expect(articleMarkdown).toContain("# Manage fulfilment");
      expect(articleMarkdown).toContain("## Related pages");
      expect(articleMarkdown).toContain("Dispatch an order");
      expect(renderWikiArticleMarkdown(wiki, "missing")).toBeNull();
    } finally {
      await service.close();
    }
  });
});
