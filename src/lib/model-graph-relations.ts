import type { MemoryRelationship } from "@/core/memory-types";
import { NODE_HEIGHT, NODE_WIDTH, type ForceLink, type NodePosition } from "@/lib/model-graph-layout";

type Relation = Pick<MemoryRelationship, "id" | "from_id" | "to_id">;
export type HandleSide = "top" | "right" | "bottom" | "left";
export type LayoutLink = ForceLink & { source: string; target: string; distance: number; strength: number };
export type RelationshipRoute = {
  sourceSide: HandleSide;
  targetSide: HandleSide;
  points: NodePosition[];
  path: string;
  labelPosition: NodePosition;
  labelVisible: boolean;
};
type Rectangle = { left: number; right: number; top: number; bottom: number };
type Port = { side: HandleSide; point: NodePosition; exit: NodePosition };
type Segment = { a: NodePosition; b: NodePosition };

export function relationshipLayoutLinks(ids: Set<string>, relationships: Relation[]): LayoutLink[] {
  const pairs = new Map<string, [string, string]>();
  const neighbors = new Map([...ids].map((id) => [id, new Set<string>()]));
  for (const relationship of relationships) {
    const { from_id: from, to_id: to } = relationship;
    if (from === to || !ids.has(from) || !ids.has(to)) continue;
    const pair: [string, string] = from < to ? [from, to] : [to, from];
    pairs.set(JSON.stringify(pair), pair);
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  }
  return [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([, [source, target]]) => {
    const a = neighbors.get(source)!;
    const b = neighbors.get(target)!;
    const shared = [...a].filter((id) => b.has(id)).length;
    return {
      source, target,
      distance: 330 + Math.min(100, Math.sqrt(Math.max(a.size, b.size) - 1) * 18) - Math.min(24, shared * 6),
      strength: 0.08 / Math.sqrt(Math.min(a.size, b.size)),
    };
  });
}

function sides(source: NodePosition, target: NodePosition): [HandleSide, HandleSide] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  return Math.abs(dx) / NODE_WIDTH >= Math.abs(dy) / NODE_HEIGHT
    ? dx >= 0 ? ["right", "left"] : ["left", "right"]
    : dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function port(position: NodePosition, side: HandleSide, offset: number): Port {
  const point = {
    x: position.x + (side === "left" ? 0 : side === "right" ? NODE_WIDTH : NODE_WIDTH / 2 + offset),
    y: position.y + (side === "top" ? 0 : side === "bottom" ? NODE_HEIGHT : NODE_HEIGHT / 2 + offset),
  };
  return { side, point, exit: {
    x: point.x + (side === "right" ? 16 : side === "left" ? -16 : 0),
    y: point.y + (side === "bottom" ? 16 : side === "top" ? -16 : 0),
  } };
}

function segmentClear(a: NodePosition, b: NodePosition, obstacles: Rectangle[]): boolean {
  if (a.x !== b.x && a.y !== b.y) {
    return obstacles.every((rect) => {
      const enterX = (rect.left - a.x) / (b.x - a.x);
      const leaveX = (rect.right - a.x) / (b.x - a.x);
      const enterY = (rect.top - a.y) / (b.y - a.y);
      const leaveY = (rect.bottom - a.y) / (b.y - a.y);
      return Math.max(0, Math.min(enterX, leaveX), Math.min(enterY, leaveY)) >=
        Math.min(1, Math.max(enterX, leaveX), Math.max(enterY, leaveY)) - 1e-8;
    });
  }
  return obstacles.every((rect) => a.x === b.x
    ? a.x <= rect.left || a.x >= rect.right || Math.max(a.y, b.y) <= rect.top || Math.min(a.y, b.y) >= rect.bottom
    : a.y <= rect.top || a.y >= rect.bottom || Math.max(a.x, b.x) <= rect.left || Math.min(a.x, b.x) >= rect.right);
}

function simplify(points: NodePosition[]): NodePosition[] {
  const result: NodePosition[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const previous = result.at(-2);
    if (previous && last && (
      previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0 ||
      previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0
    )) result.pop();
    result.push(point);
  }
  return result;
}

const distance = (a: NodePosition, b: NodePosition) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const segments = (points: NodePosition[]): Segment[] => points.slice(1).map((b, index) => ({ a: points[index], b }));

function congestion(a: NodePosition, b: NodePosition, occupied: Segment[]): number {
  const horizontal = a.y === b.y;
  let cost = 0;
  for (const used of occupied) {
    if (a.x !== b.x && a.y !== b.y || used.a.x !== used.b.x && used.a.y !== used.b.y) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ux = used.b.x - used.a.x;
      const uy = used.b.y - used.a.y;
      const cross = dx * uy - dy * ux;
      const offsetX = used.a.x - a.x;
      const offsetY = used.a.y - a.y;
      if (Math.abs(cross) < 1e-6) {
        if (Math.abs(offsetX * dy - offsetY * dx) < 1e-6) {
          const lengthSquared = dx * dx + dy * dy;
          const start = (offsetX * dx + offsetY * dy) / lengthSquared;
          const end = start + (ux * dx + uy * dy) / lengthSquared;
          if (Math.min(1, Math.max(start, end)) - Math.max(0, Math.min(start, end)) > 1e-6) return Infinity;
        }
      } else {
        const t = (offsetX * uy - offsetY * ux) / cross;
        const u = (offsetX * dy - offsetY * dx) / cross;
        if (t > 0 && t < 1 && u > 0 && u < 1) cost += 16;
      }
      continue;
    }
    const parallel = horizontal === (used.a.y === used.b.y);
    if (parallel) {
      const overlap = horizontal
        ? Math.min(Math.max(a.x, b.x), Math.max(used.a.x, used.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(used.a.x, used.b.x))
        : Math.min(Math.max(a.y, b.y), Math.max(used.a.y, used.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(used.a.y, used.b.y));
      const gap = Math.abs(horizontal ? a.y - used.a.y : a.x - used.a.x);
      if (overlap > 0 && gap < 0.01) return Infinity;
      if (overlap > 0 && gap < 10) cost += overlap * (10 - gap);
    } else {
      const h = horizontal ? { a, b } : used;
      const v = horizontal ? used : { a, b };
      if (v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x) &&
        h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) cost += 16;
    }
  }
  return cost;
}

const pathCost = (points: NodePosition[], occupied: Segment[]) => segments(points).reduce((sum, { a, b }) =>
  sum + distance(a, b) + 18 + congestion(a, b, occupied), 0);

function findRoute(start: NodePosition, end: NodePosition, obstacles: Rectangle[], lane: number, occupied: Segment[]): NodePosition[] | null {
  if (segmentClear(start, end, obstacles) && congestion(start, end, occupied) === 0) return [start, end];
  const nearby = (values: number[], from: number, to: number, limit: number) => [...new Set(values)]
    .sort((a, b) => Math.min(Math.abs(a - from), Math.abs(a - to), Math.abs(a - (from + to) / 2)) -
      Math.min(Math.abs(b - from), Math.abs(b - to), Math.abs(b - (from + to) / 2)) || a - b).slice(0, limit);
  const detourXs = [...new Set([
    (start.x + end.x) / 2,
    ...obstacles.flatMap((rect) => [rect.left - lane, rect.right + lane]),
    ...nearby(occupied.filter(({ a, b }) => a.x === b.x).flatMap(({ a }) => [a.x - 12, a.x + 12]), start.x, end.x, 12),
  ])];
  const detourYs = [...new Set([
    (start.y + end.y) / 2,
    ...obstacles.flatMap((rect) => [rect.top - lane, rect.bottom + lane]),
    ...nearby(occupied.filter(({ a, b }) => a.y === b.y).flatMap(({ a }) => [a.y - 12, a.y + 12]), start.y, end.y, 12),
  ])];
  const candidates = [
    [start, end],
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    ...detourXs.map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...detourYs.map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ...obstacles.flatMap((rect) => {
      const corners = [
        { x: rect.left - lane, y: rect.top - lane }, { x: rect.right + lane, y: rect.top - lane },
        { x: rect.right + lane, y: rect.bottom + lane }, { x: rect.left - lane, y: rect.bottom + lane },
      ];
      return corners.flatMap((corner, index) => [
        [start, corner, end], [start, corner, corners[(index + 1) % 4], end],
        [start, corners[(index + 1) % 4], corner, end],
      ]);
    }),
  ].map(simplify).filter((points) => segments(points).every(({ a, b }) => segmentClear(a, b, obstacles)))
    .map((points) => ({ points, cost: pathCost(points, occupied) }))
    .filter(({ cost }) => Number.isFinite(cost)).sort((a, b) => a.cost - b.cost);
  if (candidates.length > 0) return candidates[0].points;

  // Use bounded routing around card boundaries when direct or one-card detours are blocked.
  const xs = [...new Set([start.x, end.x, ...detourXs])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...detourYs])].sort((a, b) => a - b);
  const startIndex = ys.indexOf(start.y) * xs.length + xs.indexOf(start.x);
  const endIndex = ys.indexOf(end.y) * xs.length + xs.indexOf(end.x);
  const pointAt = (index: number) => ({ x: xs[index % xs.length], y: ys[Math.floor(index / xs.length)] });
  const costs = new Map([[startIndex, 0]]);
  const previous = new Map<number, number>();
  const queue: Array<{ index: number; cost: number; priority: number }> = [];
  const push = (entry: typeof queue[number]) => {
    let index = queue.length;
    queue.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (queue[parent].priority <= entry.priority) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = entry;
  };
  const pop = () => {
    const first = queue[0];
    const last = queue.pop()!;
    if (queue.length > 0) {
      let index = 0;
      while (index * 2 + 1 < queue.length) {
        let child = index * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].priority < queue[child].priority) child += 1;
        if (queue[child].priority >= last.priority) break;
        queue[index] = queue[child];
        index = child;
      }
      queue[index] = last;
    }
    return first;
  };
  push({ index: startIndex, cost: 0, priority: distance(start, end) * 2 });
  let iterations = 0;
  while (queue.length > 0 && iterations++ < 1_500) {
    const current = pop();
    if (current.cost !== costs.get(current.index)) continue;
    if (current.index === endIndex) {
      const points = [end];
      let index = endIndex;
      while (previous.has(index)) { index = previous.get(index)!; points.push(pointAt(index)); }
      return simplify(points.reverse());
    }
    const x = current.index % xs.length;
    const y = Math.floor(current.index / xs.length);
    const neighbors = [
      ...(x > 0 ? [current.index - 1] : []),
      ...(x < xs.length - 1 ? [current.index + 1] : []),
      ...(y > 0 ? [current.index - xs.length] : []),
      ...(y < ys.length - 1 ? [current.index + xs.length] : []),
    ];
    const a = pointAt(current.index);
    for (const index of neighbors) {
      const b = pointAt(index);
      if (!segmentClear(a, b, obstacles)) continue;
      const cost = current.cost + distance(a, b) + congestion(a, b, occupied);
      if (cost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, cost);
      previous.set(index, current.index);
      push({ index, cost, priority: cost + distance(b, end) * 2 });
    }
  }
  return null;
}

function placeLabel(points: NodePosition[], width: number, obstacles: Rectangle[]): { position: NodePosition; bounds: Rectangle; visible: boolean } {
  const candidates = segments(points).sort((a, b) => distance(b.a, b.b) - distance(a.a, a.b)).flatMap(({ a, b }) =>
    [0.5, 0.25, 0.75].flatMap((fraction) => {
      const x = a.x + (b.x - a.x) * fraction;
      const y = a.y + (b.y - a.y) * fraction;
      return a.y === b.y ? [{ x, y: y - 14 }, { x, y: y + 14 }] : [{ x: x + width / 2 + 8, y }, { x: x - width / 2 - 8, y }];
    }));
  const choices = candidates.map((position) => ({
    position,
    bounds: { left: position.x - width / 2 - 4, right: position.x + width / 2 + 4, top: position.y - 12, bottom: position.y + 12 },
  }));
  const available = choices.find(({ bounds }) => obstacles.every((rect) =>
    bounds.right <= rect.left || bounds.left >= rect.right || bounds.bottom <= rect.top || bounds.top >= rect.bottom));
  return { ...(available ?? choices[0]), visible: Boolean(available) };
}

function roundedPath(points: NodePosition[]): string {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const at = points[index];
    const after = points[index + 1];
    const beforeLength = Math.hypot(before.x - at.x, before.y - at.y);
    const afterLength = Math.hypot(after.x - at.x, after.y - at.y);
    const radius = Math.min(6, beforeLength / 2, afterLength / 2);
    const enter = { x: at.x + (before.x - at.x) / beforeLength * radius, y: at.y + (before.y - at.y) / beforeLength * radius };
    const leave = { x: at.x + (after.x - at.x) / afterLength * radius, y: at.y + (after.y - at.y) / afterLength * radius };
    path += ` L ${enter.x} ${enter.y} Q ${at.x} ${at.y} ${leave.x} ${leave.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

export function routeRelationships(
  relationships: Array<Relation & { predicate?: string }>,
  positions: Map<string, NodePosition>,
): Map<string, RelationshipRoute> {
  const visible = relationships.filter((link) => link.from_id !== link.to_id && positions.has(link.from_id) && positions.has(link.to_id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const groups = new Map<string, Array<{ linkId: string; endpoint: "source" | "target"; position: NodePosition; side: HandleSide; order: number }>>();
  for (const link of visible) {
    const source = positions.get(link.from_id)!;
    const target = positions.get(link.to_id)!;
    const [sourceSide, targetSide] = sides(source, target);
    for (const [id, endpoint, position, other, side] of [
      [link.from_id, "source", source, target, sourceSide],
      [link.to_id, "target", target, source, targetSide],
    ] as const) {
      const key = JSON.stringify([id, side]);
      const group = groups.get(key) ?? [];
      group.push({ linkId: link.id, endpoint, position, side, order: side === "top" || side === "bottom" ? other.x : other.y });
      groups.set(key, group);
    }
  }
  const ports = new Map<string, Port>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order || a.linkId.localeCompare(b.linkId));
    const span = Math.min((group.length - 1) * 14, (group[0].side === "top" || group[0].side === "bottom" ? NODE_WIDTH : NODE_HEIGHT) - 32);
    group.forEach((entry, index) => {
      const offset = group.length > 1 ? -span / 2 + span * index / (group.length - 1) : 0;
      ports.set(JSON.stringify([entry.linkId, entry.endpoint]), port(entry.position, entry.side, offset));
    });
  }
  const obstacles = [...positions.values()].map((position) => ({
    left: position.x - 10, right: position.x + NODE_WIDTH + 10,
    top: position.y - 10, bottom: position.y + NODE_HEIGHT + 10,
  }));
  const routes = new Map<string, RelationshipRoute>();
  const occupied: Segment[] = [];
  const labelObstacles = [...obstacles];
  const terminalSegments = [...ports].map(([key, entry]) => ({ key, a: entry.point, b: entry.exit }));
  const lanes = new Map<string, number>();
  for (const link of visible) {
    const source = ports.get(JSON.stringify([link.id, "source"]))!;
    const target = ports.get(JSON.stringify([link.id, "target"]))!;
    const pair = JSON.stringify([link.from_id, link.to_id].sort());
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 6);
    const blocked = [...occupied, ...terminalSegments.filter(({ key }) =>
      key !== JSON.stringify([link.id, "source"]) && key !== JSON.stringify([link.id, "target"]))];
    const middle = findRoute(source.exit, target.exit, obstacles, lane, blocked) ??
      findRoute(source.exit, target.exit, obstacles, lane + 12, []);
    if (!middle) continue;
    const points = simplify([source.point, ...middle, target.point]);
    occupied.push(...segments(middle));
    const label = placeLabel(points, (link.predicate?.replaceAll("_", " ").length ?? 16) * 6 + 14, labelObstacles);
    if (label.visible) labelObstacles.push(label.bounds);
    routes.set(link.id, {
      sourceSide: source.side, targetSide: target.side, points, path: roundedPath(points),
      labelPosition: label.position, labelVisible: label.visible,
    });
  }
  return routes;
}
