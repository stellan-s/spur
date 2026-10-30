import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelNetworkNode } from "@/components/model-network-node";
import { memoryKindSchema, type MemoryObject } from "@/core/memory-types";
import { NODE_WIDTH, type NodePosition } from "@/lib/model-graph-layout";
import { modelKindColor } from "@/lib/model-map-theme";
import { MODEL_KIND_COLORS, NETWORK_DOT_Y, networkNodeRadius, networkRelationshipRoutes } from "@/lib/model-network";

const positions = new Map([
  ["A", { x: 0, y: 0 }], ["B", { x: 400, y: 200 }], ["C", { x: 700, y: -100 }],
]);
const counts = new Map([["A", 5], ["B", 2], ["C", 1]]);
const links = [
  { id: "a-b", from_id: "A", to_id: "B" },
  { id: "b-c", from_id: "B", to_id: "C" },
];
const center = (position: NodePosition) => ({ x: position.x + NODE_WIDTH / 2, y: position.y + NETWORK_DOT_Y });
const distance = (a: NodePosition, b: NodePosition) => Math.hypot(a.x - b.x, a.y - b.y);

describe("network presentation", () => {
  it("gives every catalog kind a stable, distinct color", () => {
    expect(Object.keys(MODEL_KIND_COLORS).sort()).toEqual([...memoryKindSchema.options].sort());
    expect(new Set(Object.values(MODEL_KIND_COLORS)).size).toBe(memoryKindSchema.options.length);
    for (const color of Object.values(MODEL_KIND_COLORS)) expect(color).toMatch(/^#[a-f0-9]{6}$/);
  });

  it("makes connected hubs slightly larger without unbounded growth", () => {
    expect(networkNodeRadius(-1)).toBe(14);
    expect(networkNodeRadius(0)).toBe(14);
    expect(networkNodeRadius(5)).toBeGreaterThan(networkNodeRadius(1));
    expect(networkNodeRadius(10_000)).toBe(20);
  });

  it("connects circle boundaries in the original direction, not the invisible card bounds", () => {
    const routes = networkRelationshipRoutes(links, positions, counts);
    expect([...routes.keys()]).toEqual(links.map((link) => link.id));
    for (const link of links) {
      const route = routes.get(link.id)!;
      expect(route.path).toContain(" L ");
      expect(distance(route.points[0], center(positions.get(link.from_id)!))).toBeCloseTo(networkNodeRadius(counts.get(link.from_id)!) + 2);
      expect(distance(route.points[2], center(positions.get(link.to_id)!))).toBeCloseTo(networkNodeRadius(counts.get(link.to_id)!) + 3);
      expect(route.sourceSide).not.toBe(route.targetSide);
    }
  });

  it("separates parallel and reciprocal links deterministically without changing the graph", () => {
    const parallel = [links[0], { id: "second", from_id: "A", to_id: "B" }, { id: "reverse", from_id: "B", to_id: "A" }];
    const original = structuredClone({ parallel, positions, counts });
    const routes = networkRelationshipRoutes(parallel, positions, counts);
    expect(routes.size).toBe(3);
    expect(new Set([...routes.values()].map((route) => JSON.stringify(route.labelPosition))).size).toBe(3);
    expect([...routes.values()].filter((route) => route.path.includes(" Q "))).toHaveLength(2);
    expect(networkRelationshipRoutes([...parallel].reverse(), positions, counts)).toEqual(routes);
    expect({ parallel, positions, counts }).toEqual(original);
    expect(distance(routes.get("reverse")!.points[0], center(positions.get("B")!))).toBeCloseTo(networkNodeRadius(2) + 2);
  });

  it("keeps two opposite directions on different curves", () => {
    const routes = networkRelationshipRoutes([links[0], { id: "back", from_id: "B", to_id: "A" }], positions, counts);
    expect(routes.get("a-b")!.points[1]).not.toEqual(routes.get("back")!.points[1]);
    expect([...routes.values()].every((route) => route.path.includes(" Q "))).toBe(true);
  });

  it("reconnects to the circle when a node is dragged", () => {
    const moved = new Map(positions);
    moved.set("B", { x: -300, y: 500 });
    const before = networkRelationshipRoutes(links, positions, counts);
    const after = networkRelationshipRoutes(links, moved, counts);
    expect(after.get("a-b")!.path).not.toBe(before.get("a-b")!.path);
    expect(distance(after.get("a-b")!.points[2], center(moved.get("B")!))).toBeCloseTo(networkNodeRadius(2) + 3);
    expect(after.get("a-b")!.sourceSide).toBe("bottom");
  });

  it("handles missing, self and coincident endpoints without invalid geometry", () => {
    const coincident = new Map([["A", { x: 0, y: 0 }], ["B", { x: 0, y: 0 }]]);
    const routes = networkRelationshipRoutes([
      links[0], { id: "self", from_id: "A", to_id: "A" }, { id: "missing", from_id: "A", to_id: "missing" },
    ], coincident, counts);
    expect(routes.size).toBe(0);
    expect(networkRelationshipRoutes([], new Map(), new Map()).size).toBe(0);
  });

  it("routes every connection in a large hub without mutating positions", () => {
    const hubPositions = new Map(Array.from({ length: 80 }, (_, index) => [
      `node-${index}`, { x: Math.cos(index) * index * 80, y: Math.sin(index) * index * 80 },
    ]));
    const hubLinks = [...hubPositions.keys()].slice(1).map((id) => ({ id, from_id: "node-0", to_id: id }));
    const original = structuredClone(hubPositions);
    const routes = networkRelationshipRoutes(hubLinks, hubPositions, new Map([["node-0", 79]]));
    expect(routes.size).toBe(79);
    for (const route of routes.values()) {
      expect(route.path).not.toMatch(/NaN|Infinity/);
      expect(route.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
    expect(hubPositions).toEqual(original);
  });
});

describe("network node labels", () => {
  const item: MemoryObject = {
    id: "portal", kind: "system", title: "Northstar Commerce portal", statement: "", state: "candidate",
    authority: "ai_inference", confidence: 0.9, subjects: [], evidence_ids: [], source_ids: [],
    source_version: null, actor: null, metadata: {}, created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:00:00Z",
  };

  it("shows the name and type without card chrome or confidence scores", () => {
    const html = renderToStaticMarkup(createElement(ModelNetworkNode, { item, muted: false, connectionCount: 1 }));
    expect(html).toContain("Northstar Commerce portal");
    expect(html).toContain("system · 1 connection");
    expect(html).toContain(`background-color:${modelKindColor("system")}`);
    expect(html).not.toContain("confidence");
    expect(html).not.toContain("90%");
    expect(html).not.toContain("<button");
  });

  it("keeps selected and muted states and an accessible drill-down action", () => {
    const html = renderToStaticMarkup(createElement(ModelNetworkNode, {
      item, selected: true, muted: true, connectionCount: 25, hiddenConnectionCount: 7, onExplore: () => {},
    }));
    expect(html).toContain("ring-4");
    expect(html).toContain("opacity-35");
    expect(html).toContain("Explore</button>");
    expect(html).not.toContain("+7 more");
    expect(html).toContain('aria-label="Explore connections for Northstar Commerce portal (7 hidden)"');
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("marks the current focus while keeping its details available", () => {
    const html = renderToStaticMarkup(createElement(ModelNetworkNode, {
      item, focused: true, muted: false, connectionCount: 25, onDetails: vi.fn(),
    }));
    expect(html).toContain("Current focus");
    expect(html).toContain('aria-label="View details for Northstar Commerce portal"');
    expect(html).not.toContain("Explore</button>");
  });

  it("keeps Details independent of exploration and stops the click reaching the node", () => {
    const onDetails = vi.fn();
    const onExplore = vi.fn();
    const buttons: Record<string, unknown>[] = [];
    function visit(node: ReactNode): void {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!isValidElement<Record<string, unknown>>(node)) return;
      if (node.type === "button") buttons.push(node.props);
      visit(node.props.children as ReactNode);
    }
    visit(ModelNetworkNode({ item, muted: false, connectionCount: 25, onDetails, onExplore }));
    const stopPropagation = vi.fn();
    const details = buttons.find((button) => button["aria-label"] === "View details for Northstar Commerce portal")!;
    (details.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onDetails).toHaveBeenCalledOnce();
    expect(onExplore).not.toHaveBeenCalled();
  });
});
