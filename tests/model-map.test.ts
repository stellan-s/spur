import { describe, expect, it } from "vitest";

import type { MemoryObject, MemoryRelationship, Source } from "@/core/memory-types";
import { MAP_NEIGHBORHOOD_LIMIT, MAP_NEIGHBORHOOD_PAGE_SIZE, MAP_OVERVIEW_LIMIT, modelData, projectModelMap } from "@/lib/model-map";

function entity(id: string): MemoryObject {
  return {
    id, kind: "entity", title: id, statement: "", state: "candidate",
    authority: "ai_inference", confidence: 0.9, subjects: [], evidence_ids: [],
    source_ids: [], source_version: null, actor: null, metadata: {},
    created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z",
  };
}

function link(from: string, to: string, id = `${from}-${to}`): MemoryRelationship {
  return {
    id, from_id: from, to_id: to, predicate: "has", metadata: {},
    created_at: "2026-10-21T00:00:00Z",
  };
}

const entities = [entity("Project"), ...Array.from({ length: 48 }, (_, i) => entity(`Detail ${String(i).padStart(2, "0")}`))];
const links = entities.slice(1).map((item) => link("Project", item.id));

describe("modeled knowledge visibility", () => {
  const source: Source = {
    id: "portal", kind: "repository", name: "Portal", locator: "https://example.com/portal",
    status: "connected", enabled: true, last_synced_at: null,
    created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z",
    metadata: { active: true },
  };
  const user: MemoryObject = {
    ...entity("User"), source_ids: ["portal", "api"],
    metadata: { epistemic_status: "agent_modeled_from_code" },
  };
  const project: MemoryObject = {
    ...entity("Project"), source_ids: ["portal"],
    metadata: { epistemic_status: "agent_modeled_from_code" },
  };
  const relationships = [link("User", "Project")];

  it("keeps User and its relationships visible and focusable after promotion", () => {
    const workspace = { sources: [source], memory: [user, project], relationships };
    const before = modelData(workspace);
    const promoted: MemoryObject = {
      ...user, state: "accepted", authority: "person", confidence: 1,
      metadata: { ...user.metadata, epistemic_status: "human_verified" },
    };
    const after = modelData({ ...workspace, memory: [promoted, project] });
    expect(after.objects.map((item) => item.id)).toEqual(before.objects.map((item) => item.id));
    expect(after.objects[0]).toEqual(promoted);
    expect(after.relationships).toEqual(before.relationships);
    const focused = projectModelMap(after.objects, after.relationships, { focusId: "User" });
    expect(focused.focus).toEqual(promoted);
    expect(focused.objects.map((item) => item.id)).toEqual(["User", "Project"]);
    expect(focused.relationships).toEqual(relationships);
  });

  it.each(["entity", "system", "capability"] as const)("includes human-verified %s objects", (kind) => {
    const verified = { ...user, kind, metadata: { epistemic_status: "human_verified" } };
    expect(modelData({ sources: [source], memory: [verified], relationships: [] }).objects).toEqual([verified]);
  });

  it("preserves source filtering and removes links to excluded objects", () => {
    const elsewhere = { ...project, source_ids: ["api"], metadata: { epistemic_status: "human_verified" } };
    const unmodeled = entity("Unmodeled");
    const data = modelData({
      sources: [source], memory: [user, elsewhere, unmodeled],
      relationships: [...relationships, link("User", "Unmodeled"), link("User", "Missing")],
    });
    expect(data.objects).toEqual([user]);
    expect(data.relationships).toEqual([]);
  });

  it("includes modeled and verified objects across sources when none is active", () => {
    const verified = { ...project, source_ids: ["api"], metadata: { epistemic_status: "human_verified" } };
    const data = modelData({ sources: [{ ...source, enabled: false }], memory: [user, verified], relationships });
    expect(data.objects).toEqual([user, verified]);
    expect(data.relationships).toEqual(relationships);
  });
});

describe("progressive model map", () => {
  it("starts with a bounded overview that keeps the most connected entity", () => {
    const map = projectModelMap(entities, links);
    expect(map.objects).toHaveLength(MAP_OVERVIEW_LIMIT);
    expect(map.objects.some((item) => item.id === "Project")).toBe(true);
    expect(map.connectionCounts.get("Project")).toBe(48);
    expect(map.hiddenConnectionCounts.get("Project")).toBe(entities.length - MAP_OVERVIEW_LIMIT);
    expect(map.totalCount).toBe(49);
    for (const item of map.objects) {
      expect(map.relationships.some((edge) => edge.from_id === item.id || edge.to_id === item.id)).toBe(true);
    }
  });

  it("pages through every neighbour without growing the canvas", () => {
    const focused = projectModelMap(entities, links, { focusId: "Project" });
    expect(focused.objects).toHaveLength(MAP_NEIGHBORHOOD_LIMIT);
    expect(focused.availableCount).toBe(49);
    expect(focused.pageCount).toBe(6);
    const seen = new Set<string>();
    for (let page = 0; page < focused.pageCount; page++) {
      const view = projectModelMap(entities, links, { focusId: "Project", page });
      expect(view.objects).toHaveLength(MAP_NEIGHBORHOOD_LIMIT);
      expect(view.objects.some((item) => item.id === "Project")).toBe(true);
      expect(view.relationships).toHaveLength(MAP_NEIGHBORHOOD_PAGE_SIZE);
      expect(view.neighborStart).toBe(page * 8 + 1);
      expect(view.neighborEnd).toBe((page + 1) * 8);
      for (const item of view.objects.filter((item) => item.id !== "Project")) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
    expect(seen.size).toBe(48);
    const hidden = projectModelMap(entities, links, { focusId: "Detail 47" });
    expect(hidden.objects.map((item) => item.id)).toEqual(["Project", "Detail 47"]);
    expect(hidden.hiddenConnectionCounts.get("Project")).toBe(47);
  });

  it("shows only direct connections in focus, revealing cross-links when following a neighbour", () => {
    const objects = [entity("A"), entity("B"), entity("C"), entity("D")];
    const relationships = [link("A", "B"), link("A", "C"), link("B", "C"), link("C", "D")];
    const map = projectModelMap(objects, relationships, { focusId: "A" });
    expect(map.relationships.map((edge) => edge.id)).toEqual(["A-B", "A-C"]);
    expect(map.hiddenConnectionCounts.get("C")).toBe(1);
    expect(projectModelMap(objects, relationships, { focusId: "B" }).relationships.map((edge) => edge.id)).toEqual(["A-B", "B-C"]);
  });

  it("starts a large architecture model with eight connected objects, not the complete graph", () => {
    const objects: MemoryObject[] = Array.from({ length: 95 }, (_, i) => ({
      ...entity(`Object ${i}`), kind: i === 0 ? "system" : i % 2 ? "capability" : "process",
    }));
    const relationships = objects.slice(1).map((item) => link(objects[0].id, item.id));
    const overview = projectModelMap(objects, relationships);
    expect(overview.objects).toHaveLength(8);
    expect(overview.relationships).toHaveLength(7);
    expect(overview.objects.some((item) => item.id === objects[0].id)).toBe(true);
    expect(overview.totalCount).toBe(95);
    const focused = projectModelMap(objects, relationships, { focusId: objects[0].id });
    expect(focused.objects).toHaveLength(9);
    expect(focused.relationships).toHaveLength(8);
    const last = projectModelMap(objects, relationships, { focusId: objects[0].id, page: 11 });
    expect(last.objects).toHaveLength(7);
    expect(last.neighborEnd).toBe(94);
    expect(last.pageCount).toBe(12);
  });

  it("keeps a densely linked neighborhood readable without changing the stored graph", () => {
    const objects = Array.from({ length: 16 }, (_, i) => entity(`Entity ${i}`));
    const relationships = objects.flatMap((from, i) => objects.slice(i + 1).map((to) => link(from.id, to.id)));
    const original = structuredClone({ objects, relationships });
    const focused = projectModelMap(objects, relationships, { focusId: objects[0].id });
    expect(focused.objects).toHaveLength(9);
    expect(focused.relationships).toHaveLength(8);
    expect(focused.relationships.every((edge) => edge.from_id === objects[0].id || edge.to_id === objects[0].id)).toBe(true);
    const next = projectModelMap(objects, relationships, { focusId: objects[0].id, page: 1 });
    expect(next.objects).toHaveLength(8);
    expect(next.relationships).toHaveLength(7);
    expect({ objects, relationships }).toEqual(original);
  });

  it("counts distinct neighbors, excluding duplicates, self-links and missing endpoints", () => {
    const objects = [entity("A"), entity("B"), entity("Isolated")];
    const relationships = [link("A", "B"), link("B", "A", "reverse"), link("A", "A"), link("A", "Missing")];
    const map = projectModelMap(objects, relationships);
    expect(map.connectionCounts.get("A")).toBe(1);
    expect(map.objects.map((item) => item.id)).toEqual(["A", "B"]);
    expect(map.relationships).toHaveLength(2);
  });

  it("keeps disconnected clusters connected in the overview, regardless of input order", () => {
    const objects = Array.from({ length: 20 }, (_, i) => entity(`Entity ${i}`));
    const relationships = Array.from({ length: 10 }, (_, i) => link(objects[i * 2].id, objects[i * 2 + 1].id));
    const map = projectModelMap(objects, relationships);
    const reordered = projectModelMap([...objects].reverse(), [...relationships].reverse());
    expect(map.objects).toHaveLength(MAP_OVERVIEW_LIMIT);
    expect(new Set(map.objects.map((item) => item.id))).toEqual(new Set(reordered.objects.map((item) => item.id)));
    expect(map.relationships).toHaveLength(MAP_OVERVIEW_LIMIT / 2);
  });

  it("safely handles stale links, empty data and old full-map parameters", () => {
    const legacy = { scope: "all", limit: 999, focusId: "Project" };
    expect(projectModelMap(entities, links, legacy).objects).toHaveLength(MAP_NEIGHBORHOOD_LIMIT);
    expect(projectModelMap(entities, links, { focusId: "removed" }).objects).toHaveLength(MAP_OVERVIEW_LIMIT);
    expect(projectModelMap([], []).objects).toEqual([]);
    expect(projectModelMap(entities, links, { focusId: "Project", page: NaN }).page).toBe(0);
  });

  it.each([-1, 1.5, Infinity, NaN])("normalizes invalid page %s", (page) => {
    expect(projectModelMap(entities, links, { focusId: "Project", page }).page).toBe(0);
  });

  it("clamps a stale page after the graph shrinks and uses stable neighbour ordering", () => {
    const view = projectModelMap(entities, links.slice(0, 10), { focusId: "Project", page: 100 });
    expect(view.page).toBe(1);
    expect(view.objects).toHaveLength(3);
    expect(view.neighborStart).toBe(9);
    expect(view.neighborEnd).toBe(10);
    const reordered = projectModelMap([...entities].reverse(), [...links].reverse(), { focusId: "Project", page: 2 });
    const original = projectModelMap(entities, links, { focusId: "Project", page: 2 });
    expect(new Set(reordered.objects.map((item) => item.id))).toEqual(new Set(original.objects.map((item) => item.id)));
  });
});
