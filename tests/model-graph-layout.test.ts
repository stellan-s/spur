import { forceSimulation } from "d3-force";
import { describe, expect, it } from "vitest";

import {
  CARD_HORIZONTAL_GAP,
  CARD_VERTICAL_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  forceRectangleCollide,
  interpolateSeparatedPositions,
  layoutCardCluster,
  separateCards,
  type ForceNode,
  type NodePosition,
} from "@/lib/model-graph-layout";
import { relationshipLayoutLinks } from "@/lib/model-graph-relations";

function expectSeparated(positions: Map<string, NodePosition>) {
  const entries = [...positions.values()];
  for (let first = 0; first < entries.length; first += 1) {
    expect(Number.isFinite(entries[first].x) && Number.isFinite(entries[first].y)).toBe(true);
    for (let second = first + 1; second < entries.length; second += 1) {
      const dx = Math.abs(entries[first].x - entries[second].x);
      const dy = Math.abs(entries[first].y - entries[second].y);
      expect(dx >= NODE_WIDTH + CARD_HORIZONTAL_GAP || dy >= NODE_HEIGHT + CARD_VERTICAL_GAP).toBe(true);
    }
  }
}

describe("map card separation", () => {
  it("preserves already separated positions and does not mutate its input", () => {
    const positions = new Map([
      ["A", { x: 0, y: 0 }], ["B", { x: 500, y: 0 }], ["C", { x: 0, y: 400 }],
    ]);
    const original = structuredClone(positions);
    expect(separateCards(positions)).toEqual(original);
    expect(positions).toEqual(original);
    expect(separateCards(new Map())).toEqual(new Map());
  });

  it.each([0, 1, 24, 96])("clears a dense cluster even with a %i-pass budget", (passes) => {
    const positions = new Map(Array.from({ length: 80 }, (_, index) => [
      `node-${index}`, { x: index % 8 * 40, y: Math.floor(index / 8) * 16 },
    ]));
    const original = structuredClone(positions);
    const result = separateCards(positions, { passes, pinnedId: "node-39" });
    expectSeparated(result);
    expect(result.get("node-39")).toEqual(original.get("node-39"));
    expect(positions).toEqual(original);
    expect(separateCards(result)).toEqual(result);
  });

  it("resolves coincident cards deterministically regardless of input order", () => {
    const positions = new Map(Array.from({ length: 30 }, (_, index) => [`node-${index}`, { x: 0, y: 0 }]));
    const result = separateCards(positions, { pinnedId: "node-5" });
    expectSeparated(result);
    expect(result).toEqual(separateCards(new Map([...positions].reverse()), { pinnedId: "node-5" }));
    expect(result.get("node-5")).toEqual({ x: 0, y: 0 });
  });

  it("pushes a row of neighbours aside without moving a distant cluster", () => {
    const positions = new Map([
      ["dragged", { x: 200, y: 0 }], ["next", { x: 280, y: 0 }],
      ["last", { x: 560, y: 0 }], ["distant", { x: 5_000, y: 5_000 }],
    ]);
    const result = separateCards(positions, { pinnedId: "dragged" });
    expectSeparated(result);
    expect(result.get("dragged")).toEqual(positions.get("dragged"));
    expect(result.get("next")!.x).toBeGreaterThan(positions.get("next")!.x);
    expect(result.get("last")!.x).toBeGreaterThan(positions.get("last")!.x);
    expect(result.get("distant")).toEqual(positions.get("distant"));
  });

  it("protects every sampled animation frame, not just the final layout", () => {
    const start = new Map([
      ["pinned", { x: 0, y: 0 }], ["A", { x: -400, y: 0 }], ["B", { x: 400, y: 0 }],
    ]);
    const target = new Map([
      ["pinned", { x: 80, y: 80 }], ["A", { x: 400, y: 0 }], ["B", { x: -400, y: 0 }],
    ]);
    for (let frame = 0; frame <= 20; frame += 1) {
      const positions = interpolateSeparatedPositions(start, target, frame / 20, "pinned");
      expectSeparated(positions);
      expect(positions.get("pinned")).toEqual(start.get("pinned"));
    }
  });
});

describe("rectangle collision force", () => {
  it("keeps collision strength when the simulation has cooled to zero", () => {
    const run = (alpha: number) => {
      const nodes: ForceNode[] = [{ id: "A", x: 0, y: 0 }, { id: "B", x: 20, y: 20 }];
      const simulation = forceSimulation(nodes).alpha(alpha).force("collision", forceRectangleCollide()).stop();
      simulation.tick(60);
      return new Map(nodes.map((node) => [node.id, { x: node.x!, y: node.y! }]));
    };
    const cold = run(0);
    expectSeparated(cold);
    expect(cold).toEqual(run(1));
  });

  it("gives the movable card the full correction while the dragged card stays pinned", () => {
    const nodes: ForceNode[] = [
      { id: "pinned", x: 0, y: 0, fx: 0, fy: 0 }, { id: "other", x: 0, y: 0 },
    ];
    const simulation = forceSimulation(nodes).alpha(0).force("collision", forceRectangleCollide()).stop();
    simulation.tick(60);
    expect(nodes[0]).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0 });
    expectSeparated(new Map(nodes.map((node) => [node.id, { x: node.x!, y: node.y! }])));
  });

  it("respects axis-specific pins and leaves two fixed cards alone", () => {
    const nodes: ForceNode[] = [
      { id: "A", x: 0, y: 0, fx: 0 }, { id: "B", x: 200, y: 0, fx: 200 },
    ];
    const simulation = forceSimulation(nodes).alpha(0).force("collision", forceRectangleCollide()).stop();
    simulation.tick(60);
    expect(nodes.map((node) => node.x)).toEqual([0, 200]);
    expectSeparated(new Map(nodes.map((node) => [node.id, { x: node.x!, y: node.y! }])));
    nodes.forEach((node) => { node.fy = 0; });
    simulation.tick(10);
    expect(nodes.map((node) => node.y)).toEqual([0, 0]);
  });

  it("settles a crowded connected neighbourhood with usable card spacing", () => {
    const ids = Array.from({ length: 40 }, (_, index) => String(index));
    const links = relationshipLayoutLinks(new Set(ids), ids.slice(1).map((id) => ({ id, from_id: "0", to_id: id })));
    const positions = layoutCardCluster(ids, links);
    expectSeparated(positions);
    const values = [...positions.values()];
    expect(Math.max(...values.map((position) => Math.abs(position.x)))).toBeLessThan(2_000);
    expect(Math.max(...values.map((position) => Math.abs(position.y)))).toBeLessThan(2_000);
  });

  it("uses equal card clearance and settles deterministically without changing input relationships", () => {
    expect(CARD_HORIZONTAL_GAP).toBe(CARD_VERTICAL_GAP);
    const ids = Array.from({ length: 12 }, (_, index) => String(index));
    const links = relationshipLayoutLinks(new Set(ids), ids.slice(1).map((id) => ({ id, from_id: "0", to_id: id })));
    const original = structuredClone(links);
    const positions = layoutCardCluster(ids, links);
    expectSeparated(positions);
    expect(layoutCardCluster([...ids].reverse(), [...links].reverse())).toEqual(positions);
    expect(links).toEqual(original);
    const centers = [...positions.values()];
    const width = Math.max(...centers.map((point) => point.x)) - Math.min(...centers.map((point) => point.x));
    const height = Math.max(...centers.map((point) => point.y)) - Math.min(...centers.map((point) => point.y));
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(1.7);
    expect(layoutCardCluster([], [])).toEqual(new Map());
  });
});
