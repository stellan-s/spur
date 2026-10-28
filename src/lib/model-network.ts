import type { MemoryKind, MemoryRelationship } from "@/core/memory-types";
import { NODE_WIDTH, type NodePosition } from "@/lib/model-graph-layout";
import type { HandleSide, RelationshipRoute } from "@/lib/model-graph-relations";

export type MapPresentation = "network" | "cards";
export const NETWORK_DOT_Y = 22;

export const MODEL_KIND_COLORS: Record<MemoryKind, string> = {
  application: "#a855f7",
  system: "#3b82f6",
  integration: "#f59e0b",
  information: "#06b6d4",
  entity: "#14b8a6",
  capability: "#22c55e",
  process: "#f97316",
  control: "#ef4444",
  decision: "#6366f1",
  rule: "#eab308",
  observation: "#94a3b8",
};

export function networkNodeRadius(connections: number): number {
  return 14 + Math.min(6, Math.log2(Math.max(0, connections) + 1) * 1.5);
}

function facingSide(dx: number, dy: number): HandleSide {
  return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
}

export function networkRelationshipRoutes(
  relationships: Pick<MemoryRelationship, "id" | "from_id" | "to_id">[],
  positions: Map<string, NodePosition>,
  connectionCounts: Map<string, number>,
): Map<string, RelationshipRoute> {
  const groups = new Map<string, typeof relationships>();
  for (const link of relationships) {
    if (link.from_id === link.to_id || !positions.has(link.from_id) || !positions.has(link.to_id)) continue;
    const key = JSON.stringify([link.from_id, link.to_id].sort());
    const group = groups.get(key) ?? [];
    group.push(link);
    groups.set(key, group);
  }
  const routes = new Map<string, RelationshipRoute>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((link, index) => {
      const from = positions.get(link.from_id)!;
      const to = positions.get(link.to_id)!;
      const source = { x: from.x + NODE_WIDTH / 2, y: from.y + NETWORK_DOT_Y };
      const target = { x: to.x + NODE_WIDTH / 2, y: to.y + NETWORK_DOT_Y };
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return;
      const orientation = link.from_id < link.to_id ? 1 : -1;
      const offset = (index - (group.length - 1) / 2) * 48 * orientation;
      const control = { x: (source.x + target.x) / 2 - dy / length * offset, y: (source.y + target.y) / 2 + dx / length * offset };
      const boundary = (center: NodePosition, radius: number) => {
        const distance = Math.hypot(control.x - center.x, control.y - center.y);
        const inset = Math.min(radius, distance * 0.4);
        return { x: center.x + (control.x - center.x) / distance * inset, y: center.y + (control.y - center.y) / distance * inset };
      };
      const start = boundary(source, networkNodeRadius(connectionCounts.get(link.from_id) ?? 0) + 2);
      const end = boundary(target, networkNodeRadius(connectionCounts.get(link.to_id) ?? 0) + 3);
      routes.set(link.id, {
        sourceSide: facingSide(dx, dy), targetSide: facingSide(-dx, -dy),
        points: [start, control, end],
        path: offset === 0 ? `M ${start.x} ${start.y} L ${end.x} ${end.y}` : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        labelPosition: { x: start.x / 4 + control.x / 2 + end.x / 4, y: start.y / 4 + control.y / 2 + end.y / 4 - 12 },
        labelVisible: true,
      });
    });
  }
  return routes;
}
