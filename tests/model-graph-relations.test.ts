import { describe, expect, it } from "vitest";

import { layoutCardCluster, NODE_HEIGHT, NODE_WIDTH, type NodePosition } from "@/lib/model-graph-layout";
import { relationshipLayoutLinks, routeRelationships, type RelationshipRoute } from "@/lib/model-graph-relations";

const relation = (id: string, from_id: string, to_id: string) => ({ id, from_id, to_id });

function expectClear(route: RelationshipRoute, positions: Map<string, NodePosition>) {
  expect(route.path).not.toMatch(/NaN|undefined|Infinity/);
  expect(route.points.length).toBeGreaterThanOrEqual(2);
  for (let index = 1; index < route.points.length; index += 1) {
    const a = route.points[index - 1];
    const b = route.points[index];
    for (const position of positions.values()) {
      if (a.x !== b.x && a.y !== b.y) {
        const xs = [(position.x - a.x) / (b.x - a.x), (position.x + NODE_WIDTH - a.x) / (b.x - a.x)];
        const ys = [(position.y - a.y) / (b.y - a.y), (position.y + NODE_HEIGHT - a.y) / (b.y - a.y)];
        expect(Math.max(0, Math.min(...xs), Math.min(...ys))).toBeGreaterThanOrEqual(
          Math.min(1, Math.max(...xs), Math.max(...ys)) - 1e-8,
        );
        continue;
      }
      const intersects = a.x === b.x
        ? a.x > position.x && a.x < position.x + NODE_WIDTH && Math.max(a.y, b.y) > position.y && Math.min(a.y, b.y) < position.y + NODE_HEIGHT
        : a.y > position.y && a.y < position.y + NODE_HEIGHT && Math.max(a.x, b.x) > position.x && Math.min(a.x, b.x) < position.x + NODE_WIDTH;
      expect(intersects).toBe(false);
    }
  }
}

describe("relationship-aware layout", () => {
  it("uses one spring per pair without changing the actual relationships", () => {
    const ids = new Set(["A", "B", "C"]);
    const links = [relation("one", "A", "B"), relation("two", "B", "C")];
    const repeated = [...links, relation("reverse", "B", "A"), relation("another", "A", "B")];
    const snapshot = structuredClone(repeated);
    expect(relationshipLayoutLinks(ids, repeated)).toEqual(relationshipLayoutLinks(ids, links));
    expect(repeated).toEqual(snapshot);
  });

  it("gives hubs more room and dense groups less pull per connection", () => {
    const ids = new Set(["A", "B", "C", "D", "E"]);
    const simple = relationshipLayoutLinks(ids, [relation("ab", "A", "B")])[0];
    const hub = relationshipLayoutLinks(ids, [
      relation("ab", "A", "B"), relation("ac", "A", "C"), relation("ad", "A", "D"), relation("ae", "A", "E"),
    ])[0];
    expect(hub.distance).toBeGreaterThan(simple.distance);
    const triangle = relationshipLayoutLinks(ids, [relation("ab", "A", "B"), relation("ac", "A", "C"), relation("bc", "B", "C")]);
    expect(triangle[0].strength).toBeLessThan(simple.strength);
  });

  it("is deterministic and ignores missing endpoints and self-links for layout only", () => {
    const ids = new Set(["A", "B", "C"]);
    const links = [relation("bc", "B", "C"), relation("ab", "A", "B"), relation("self", "A", "A"), relation("missing", "A", "X")];
    expect(relationshipLayoutLinks(ids, links)).toEqual(relationshipLayoutLinks(ids, [...links].reverse()));
    expect(relationshipLayoutLinks(ids, links)).toHaveLength(2);
  });
});

function expectDistinctTracks(routes: Map<string, RelationshipRoute>) {
  const segments = [...routes].flatMap(([id, route]) => route.points.slice(1).map((b, index) => ({ id, a: route.points[index], b })));
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const a = segments[first];
      const b = segments[second];
      if (a.id === b.id) continue;
      const dx = a.b.x - a.a.x;
      const dy = a.b.y - a.a.y;
      const ux = b.b.x - b.a.x;
      const uy = b.b.y - b.a.y;
      const ox = b.a.x - a.a.x;
      const oy = b.a.y - a.a.y;
      if (Math.abs(dx * uy - dy * ux) > 1e-6 || Math.abs(ox * dy - oy * dx) > 1e-6) continue;
      const lengthSquared = dx * dx + dy * dy;
      const start = (ox * dx + oy * dy) / lengthSquared;
      const end = start + (ux * dx + uy * dy) / lengthSquared;
      expect(Math.min(1, Math.max(start, end)) - Math.max(0, Math.min(start, end))).toBeLessThanOrEqual(1e-6);
    }
  }
}

describe("relationship routing", () => {
  it("connects the facing card boundaries with the original direction", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 500, y: 0 }]]);
    const route = routeRelationships([relation("ab", "A", "B")], positions).get("ab")!;
    expectClear(route, positions);
    expect(route.points[0]).toEqual({ x: NODE_WIDTH, y: NODE_HEIGHT / 2 });
    expect(route.points.at(-1)).toEqual({ x: 500, y: NODE_HEIGHT / 2 });
    expect(route.sourceSide).toBe("right");
    expect(route.targetSide).toBe("left");
  });

  it("routes around an intervening card instead of through its text", () => {
    const positions = new Map([
      ["A", { x: 0, y: 0 }], ["Blocker", { x: 350, y: 0 }], ["B", { x: 700, y: 0 }],
    ]);
    const route = routeRelationships([relation("ab", "A", "B")], positions).get("ab")!;
    expectClear(route, positions);
    expect(route.points.some((point) => point.y <= -10 || point.y >= NODE_HEIGHT + 10)).toBe(true);
  });

  it("finds a multi-bend route when the simple detours are blocked", () => {
    const positions = new Map([
      ["A", { x: 0, y: 0 }], ["B", { x: 1_000, y: 0 }],
      ["middle", { x: 360, y: -20 }], ["upper", { x: 180, y: -128 }],
      ["lower", { x: 180, y: 128 }], ["upper-right", { x: 800, y: -128 }],
    ]);
    const route = routeRelationships([relation("ab", "A", "B")], positions).get("ab")!;
    expect(route).toBeDefined();
    expectClear(route, positions);
    expect(route.points.length).toBeGreaterThan(4);
  });

  it("keeps parallel and reverse relationships individually identifiable", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 500, y: 0 }]]);
    const links = [relation("owns", "A", "B"), relation("uses", "A", "B"), relation("belongs", "B", "A")];
    const routes = routeRelationships(links, positions);
    expect([...routes.keys()].sort()).toEqual(links.map((link) => link.id).sort());
    expect(new Set([...routes.values()].map((route) => route.path)).size).toBe(3);
    for (const route of routes.values()) expectClear(route, positions);
    expect(routes.get("belongs")!.points[0].x).toBe(500);
    expect(routes.get("belongs")!.points.at(-1)!.x).toBe(NODE_WIDTH);
  });

  it("fans hub connections out in the same order as their neighbours", () => {
    const positions = new Map([
      ["hub", { x: 0, y: 0 }], ["above", { x: 600, y: -128 }],
      ["level", { x: 600, y: 0 }], ["below", { x: 600, y: 128 }],
    ]);
    const routes = routeRelationships([
      relation("above", "hub", "above"), relation("level", "hub", "level"), relation("below", "hub", "below"),
    ], positions);
    expect(routes.get("above")!.points[0].y).toBeLessThan(routes.get("level")!.points[0].y);
    expect(routes.get("level")!.points[0].y).toBeLessThan(routes.get("below")!.points[0].y);
    for (const route of routes.values()) expectClear(route, positions);
  });

  it("uses separate detour lanes for parallel relationships around a card", () => {
    const positions = new Map([
      ["A", { x: 0, y: 0 }], ["blocker", { x: 350, y: 0 }], ["B", { x: 700, y: 0 }],
    ]);
    const routes = routeRelationships([
      relation("a", "A", "B"), relation("b", "A", "B"), relation("c", "B", "A"),
    ], positions);
    expect(routes.size).toBe(3);
    const lanes = new Set([...routes.values()].map((route) => {
      expectClear(route, positions);
      return route.points.find((point) => point.y < 0 || point.y > NODE_HEIGHT)!.y;
    }));
    expect(lanes.size).toBe(3);
  });

  it("reroutes when cards move, including cards not at the ends of a relationship", () => {
    const positions = new Map([
      ["A", { x: 0, y: 0 }], ["B", { x: 700, y: 0 }], ["moving", { x: 350, y: 300 }],
    ]);
    const links = [relation("ab", "A", "B")];
    const before = routeRelationships(links, positions).get("ab")!;
    positions.set("moving", { x: 350, y: 0 });
    const after = routeRelationships(links, positions).get("ab")!;
    expect(after.path).not.toBe(before.path);
    expectClear(after, positions);
  });

  it("is stable across input order and does not mutate objects or relations", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 500, y: 0 }]]);
    const links = [relation("uses", "A", "B"), relation("belongs", "B", "A")];
    const snapshot = structuredClone({ positions, links });
    expect(routeRelationships(links, positions)).toEqual(routeRelationships([...links].reverse(), new Map([...positions].reverse())));
    expect({ positions, links }).toEqual(snapshot);
    expect(routeRelationships([], positions).size).toBe(0);
    expect(routeRelationships([relation("missing", "A", "X")], positions).size).toBe(0);
  });

  it("separates tracks from a shared hub instead of stacking relations along one trunk", () => {
    const positions = new Map([
      ["hub", { x: 0, y: 0 }],
      ...Array.from({ length: 12 }, (_, index): [string, NodePosition] => [String(index), { x: 600, y: index * 180 - 1000 }]),
    ]);
    const links = [...positions.keys()].slice(1).map((id) => relation(id, "hub", id));
    const routes = routeRelationships(links, positions);
    expect(routes.size).toBe(links.length);
    expectDistinctTracks(routes);
    for (const route of routes.values()) expectClear(route, positions);
  });

  it("prefers a direct connection when a diagonal route is clear", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 600, y: 300 }]]);
    const route = routeRelationships([relation("ab", "A", "B")], positions).get("ab")!;
    expect(route.points.some((point, index) => index > 0 && point.x !== route.points[index - 1].x && point.y !== route.points[index - 1].y)).toBe(true);
    expectClear(route, positions);
  });

  it("keeps visible labels separated from each other", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 600, y: 0 }]]);
    const links = Array.from({ length: 8 }, (_, index) => ({ ...relation(String(index), "A", "B"), predicate: "references" }));
    const routes = routeRelationships(links, positions);
    expectDistinctTracks(routes);
    const visible = [...routes.values()].filter((route) => route.labelVisible);
    expect(visible.length).toBeGreaterThan(0);
    for (let first = 0; first < visible.length; first += 1) {
      for (let second = first + 1; second < visible.length; second += 1) {
        expect(Math.abs(visible[first].labelPosition.x - visible[second].labelPosition.x) >= 82 ||
          Math.abs(visible[first].labelPosition.y - visible[second].labelPosition.y) >= 24).toBe(true);
      }
    }
  });

  it("retains every relationship in a crowded 80-card map", () => {
    const ids = Array.from({ length: 80 }, (_, index) => String(index));
    const links = ids.slice(1).map((id) => relation(id, "0", id));
    const positions = layoutCardCluster(ids, relationshipLayoutLinks(new Set(ids), links));
    const routes = routeRelationships(links, positions);
    expect(routes.size).toBe(links.length);
    for (const route of routes.values()) expectClear(route, positions);
  }, 10_000);
});
