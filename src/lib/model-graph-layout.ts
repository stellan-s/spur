import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Force, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 92;
export const CARD_HORIZONTAL_GAP = 64;
export const CARD_VERTICAL_GAP = 64;

export type ForceNode = SimulationNodeDatum & { id: string };
export type ForceLink = SimulationLinkDatum<ForceNode>;
export type NodePosition = { x: number; y: number };

export function layoutCardCluster(
  ids: string[],
  links: Array<{ source: string; target: string; distance: number; strength: number }>,
): Map<string, NodePosition> {
  const neighbors = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const link of links) {
    neighbors.get(link.source)?.add(link.target);
    neighbors.get(link.target)?.add(link.source);
  }
  const ordered = [...ids].sort((a, b) => neighbors.get(b)!.size - neighbors.get(a)!.size || a.localeCompare(b));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const nodes: ForceNode[] = ordered.map((id, index) => {
    const radius = 160 * Math.sqrt(index);
    return { id, x: Math.cos(index * goldenAngle) * radius, y: Math.sin(index * goldenAngle) * radius };
  });
  const simulation = forceSimulation(nodes)
    .force("link", forceLink<ForceNode, ForceLink & { distance: number; strength: number }>(links.map((link) => ({ ...link }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)))
      .id((node) => node.id).distance((link) => link.distance).strength((link) => link.strength))
    .force("charge", forceManyBody<ForceNode>().strength(-1_100).distanceMin(80).distanceMax(900))
    .force("x", forceX<ForceNode>(0).strength(0.012))
    .force("y", forceY<ForceNode>(0).strength(0.012))
    .force("collision", forceRectangleCollide())
    .velocityDecay(0.52)
    .stop();
  simulation.tick(Math.min(420, 240 + nodes.length * 6));
  return separateCards(new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }])));
}

export function separateCards(
  positions: Map<string, NodePosition>,
  options: { pinnedId?: string; horizontalGap?: number; verticalGap?: number; passes?: number } = {},
): Map<string, NodePosition> {
  const {
    pinnedId,
    horizontalGap = CARD_HORIZONTAL_GAP,
    verticalGap = CARD_VERTICAL_GAP,
    passes = 96,
  } = options;
  const width = NODE_WIDTH + horizontalGap;
  const height = NODE_HEIGHT + verticalGap;
  const entries = [...positions].map(([id, position]) => ({ id, ...position }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (let first = 0; first < entries.length; first += 1) {
      for (let second = first + 1; second < entries.length; second += 1) {
        const a = entries[first];
        const b = entries[second];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = width - Math.abs(dx);
        const overlapY = height - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        const moveA = a.id === pinnedId ? 0 : b.id === pinnedId ? 1 : 0.5;
        const moveB = 1 - moveA;
        if (overlapX / width < overlapY / height || dx === 0 && dy === 0 && first % 2 === 0) {
          const direction = dx === 0 ? (first % 2 === 0 ? 1 : -1) : Math.sign(dx);
          const distance = overlapX + 0.5;
          a.x -= direction * distance * moveA;
          b.x += direction * distance * moveB;
        } else {
          const direction = dy === 0 ? (first % 2 === 0 ? 1 : -1) : Math.sign(dy);
          const distance = overlapY + 0.5;
          a.y -= direction * distance * moveA;
          b.y += direction * distance * moveB;
        }
      }
    }
    if (!moved) break;
  }

  // A crowded cluster may not converge within the interactive pass budget.
  const placed: Array<NodePosition & { id: string }> = [];
  const overlaps = (a: NodePosition, b: NodePosition) =>
    Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height;
  const ordered = [...entries].sort((a, b) =>
    Number(b.id === pinnedId) - Number(a.id === pinnedId));
  for (const entry of ordered) {
    if (placed.some((other) => overlaps(entry, other))) {
      const candidates = placed.flatMap((other) => [
        { x: other.x - width - 0.5, y: entry.y },
        { x: other.x + width + 0.5, y: entry.y },
        { x: entry.x, y: other.y - height - 0.5 },
        { x: entry.x, y: other.y + height + 0.5 },
      ]).sort((a, b) =>
        (a.x - entry.x) ** 2 + (a.y - entry.y) ** 2 -
        (b.x - entry.x) ** 2 - (b.y - entry.y) ** 2);
      const free = candidates.find((candidate) => !placed.some((other) => overlaps(candidate, other)))!;
      entry.x = free.x;
      entry.y = free.y;
    }
    placed.push(entry);
  }
  return new Map(entries.map(({ id, x, y }) => [id, { x, y }]));
}

export function forceRectangleCollide(
  width = NODE_WIDTH,
  height = NODE_HEIGHT,
  horizontalGap = CARD_HORIZONTAL_GAP,
  verticalGap = CARD_VERTICAL_GAP,
): Force<ForceNode, ForceLink> {
  let nodes: ForceNode[] = [];
  const force: Force<ForceNode, ForceLink> = () => {
    // Collision protection must not cool down with the attractive forces.
    for (let pass = 0; pass < 3; pass += 1) {
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const a = nodes[first];
          const b = nodes[second];
          const dx = (b.fx ?? (b.x ?? 0) + (b.vx ?? 0)) - (a.fx ?? (a.x ?? 0) + (a.vx ?? 0));
          const dy = (b.fy ?? (b.y ?? 0) + (b.vy ?? 0)) - (a.fy ?? (a.y ?? 0) + (a.vy ?? 0));
          const overlapX = width + horizontalGap - Math.abs(dx);
          const overlapY = height + verticalGap - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          const canMoveX = a.fx == null || b.fx == null;
          const canMoveY = a.fy == null || b.fy == null;
          if (!canMoveX && !canMoveY) continue;
          if (canMoveX && (!canMoveY || overlapX / (width + horizontalGap) < overlapY / (height + verticalGap))) {
            const direction = dx === 0 ? (first % 2 === 0 ? 1 : -1) : Math.sign(dx);
            const impulse = (overlapX + 0.5) * 0.9 * direction;
            const shareA = a.fx != null ? 0 : b.fx != null ? 1 : 0.5;
            a.vx = (a.vx ?? 0) - impulse * shareA;
            b.vx = (b.vx ?? 0) + impulse * (1 - shareA);
          } else {
            const direction = dy === 0 ? (first % 2 === 0 ? 1 : -1) : Math.sign(dy);
            const impulse = (overlapY + 0.5) * 0.9 * direction;
            const shareA = a.fy != null ? 0 : b.fy != null ? 1 : 0.5;
            a.vy = (a.vy ?? 0) - impulse * shareA;
            b.vy = (b.vy ?? 0) + impulse * (1 - shareA);
          }
        }
      }
    }
  };
  force.initialize = (nextNodes) => { nodes = nextNodes; };
  return force;
}

export function interpolateSeparatedPositions(
  start: Map<string, NodePosition>,
  target: Map<string, NodePosition>,
  progress: number,
  pinnedId: string,
): Map<string, NodePosition> {
  const amount = Math.max(0, Math.min(1, progress));
  return separateCards(new Map([...start].map(([id, position]) => {
    const end = id === pinnedId ? position : target.get(id) ?? position;
    return [id, {
      x: position.x + (end.x - position.x) * amount,
      y: position.y + (end.y - position.y) * amount,
    }];
  })), { pinnedId, passes: 12 });
}
