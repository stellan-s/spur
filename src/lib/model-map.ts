import type { MemoryObject, MemoryRelationship, Workspace } from "@/core/memory-types";

export const MAP_OVERVIEW_LIMIT = 8;
export const MAP_NEIGHBORHOOD_PAGE_SIZE = 8;
export const MAP_NEIGHBORHOOD_LIMIT = 1 + MAP_NEIGHBORHOOD_PAGE_SIZE;

export function modelData(workspace: Pick<Workspace, "sources" | "memory" | "relationships">): {
  objects: MemoryObject[];
  relationships: MemoryRelationship[];
} {
  const activeSource = workspace.sources.find(
    (source) => source.enabled && source.metadata.active === true,
  );
  const objects = workspace.memory.filter(
    (item) =>
      (item.metadata.epistemic_status === "agent_modeled_from_code" ||
        item.metadata.epistemic_status === "human_verified") &&
      (!activeSource || item.source_ids.includes(activeSource.id)),
  );
  const ids = new Set(objects.map((item) => item.id));
  return {
    objects,
    relationships: workspace.relationships.filter(
      (relationship) => ids.has(relationship.from_id) && ids.has(relationship.to_id),
    ),
  };
}

export function projectModelMap(
  objects: MemoryObject[],
  relationships: MemoryRelationship[],
  options: { focusId?: string; page?: number } = {},
) {
  const neighbors = new Map(objects.map((item) => [item.id, new Set<string>()]));
  const links = relationships.filter((link) =>
    link.from_id !== link.to_id && neighbors.has(link.from_id) && neighbors.has(link.to_id));
  for (const link of links) {
    neighbors.get(link.from_id)!.add(link.to_id);
    neighbors.get(link.to_id)!.add(link.from_id);
  }
  const ranked = objects.filter((item) => neighbors.get(item.id)!.size > 0).sort((a, b) =>
    neighbors.get(b.id)!.size - neighbors.get(a.id)!.size ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const focus = ranked.find((item) => item.id === options.focusId);
  const visibleIds = new Set<string>();
  let availableCount = ranked.length;
  let page = 0;
  let pageCount = 1;
  let neighborStart = 0;
  let neighborEnd = 0;

  if (focus) {
    const adjacent = ranked.filter((item) => neighbors.get(focus.id)!.has(item.id));
    availableCount = adjacent.length + 1;
    pageCount = Math.ceil(adjacent.length / MAP_NEIGHBORHOOD_PAGE_SIZE);
    page = Number.isSafeInteger(options.page)
      ? Math.max(0, Math.min(options.page!, pageCount - 1))
      : 0;
    const offset = page * MAP_NEIGHBORHOOD_PAGE_SIZE;
    neighborStart = offset + 1;
    neighborEnd = Math.min(offset + MAP_NEIGHBORHOOD_PAGE_SIZE, adjacent.length);
    visibleIds.add(focus.id);
    for (const item of adjacent.slice(offset, neighborEnd)) visibleIds.add(item.id);
  } else if (ranked.length <= MAP_OVERVIEW_LIMIT) {
    for (const item of ranked) visibleIds.add(item.id);
  } else {
    // Include a real neighbor with each new cluster, so the overview has no
    // floating hubs or invented links between otherwise unrelated entities.
    for (const item of ranked) {
      if (visibleIds.has(item.id)) continue;
      if (visibleIds.size >= MAP_OVERVIEW_LIMIT) break;
      const adjacent = neighbors.get(item.id)!;
      if ([...adjacent].some((id) => visibleIds.has(id))) {
        visibleIds.add(item.id);
      } else if (visibleIds.size + 2 <= MAP_OVERVIEW_LIMIT) {
        const neighbor = ranked.find((candidate) => adjacent.has(candidate.id));
        if (neighbor) {
          visibleIds.add(item.id);
          visibleIds.add(neighbor.id);
        }
      }
    }
  }

  return {
    objects: objects.filter((item) => visibleIds.has(item.id)),
    relationships: links.filter((link) => visibleIds.has(link.from_id) && visibleIds.has(link.to_id) &&
      (!focus || link.from_id === focus.id || link.to_id === focus.id)),
    focus,
    page,
    pageCount,
    neighborStart,
    neighborEnd,
    availableCount,
    totalCount: ranked.length,
    connectionCounts: new Map([...neighbors].map(([id, adjacent]) => [id, adjacent.size])),
    hiddenConnectionCounts: new Map([...neighbors].map(([id, adjacent]) =>
      [id, [...adjacent].filter((neighborId) => !visibleIds.has(neighborId)).length])),
  };
}
