"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dagre from "@dagrejs/dagre";
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force,
} from "d3-force";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { ModelMapToolbar, type LayoutMode } from "@/components/model-map-toolbar";
import { ModelNetworkNode } from "@/components/model-network-node";
import type { MemoryObject, MemoryRelationship } from "@/core/memory-types";
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  CARD_HORIZONTAL_GAP,
  CARD_VERTICAL_GAP,
  forceRectangleCollide,
  interpolateSeparatedPositions,
  layoutCardCluster,
  separateCards,
  type ForceNode,
  type ForceLink,
  type NodePosition,
} from "@/lib/model-graph-layout";
import {
  relationshipLayoutLinks,
  routeRelationships,
  type HandleSide,
  type LayoutLink,
  type RelationshipRoute,
} from "@/lib/model-graph-relations";
import { isMapThemeId, MAP_THEME_STORAGE_KEY, modelKindColor, type MapThemeId } from "@/lib/model-map-theme";
import { networkRelationshipRoutes, type MapPresentation } from "@/lib/model-network";
import { MAP_OVERVIEW_LIMIT } from "@/lib/model-map";
import { cn } from "@/lib/utils";

const DEFAULT_OVERVIEW_ZOOM = 0.8;
const MAP_VIEWPORT_PADDING = { top: "32px", bottom: "80px", left: "32px", right: "32px" } as const;

type ArchitectureNodeData = {
  item: MemoryObject;
  muted: boolean;
  connectionCount: number;
  hiddenConnectionCount?: number;
  focused?: boolean;
  onExplore?: () => void;
  onDetails?: () => void;
};

type ArchitectureNode = Node<ArchitectureNodeData, "architecture" | "network">;
type ArchitectureEdge = Edge<{
  relationship: MemoryRelationship;
  route?: RelationshipRoute;
  description?: string;
}>;

const KIND_LABELS: Record<MemoryObject["kind"], string> = {
  application: "Application",
  system: "System",
  integration: "Integration",
  information: "Information",
  entity: "Entity",
  capability: "Capability",
  process: "Process",
  control: "Control",
  decision: "Decision",
  rule: "Rule",
  observation: "Observation",
};

const HANDLE_POSITIONS: Array<{ side: HandleSide; position: Position }> = [
  { side: "top", position: Position.Top },
  { side: "right", position: Position.Right },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
];

function ArchitectureNodeCard({ data, selected }: NodeProps<ArchitectureNode>) {
  const { item, muted, connectionCount, hiddenConnectionCount = 0, onExplore } = data;
  return (
    <div
      className={cn(
        "h-[92px] w-[232px] rounded-lg border bg-card px-4 py-3 shadow-sm transition-[border-color,box-shadow,opacity,transform] duration-200",
        selected ? "border-primary shadow-md ring-2 ring-primary/10" : "hover:border-primary/45 hover:shadow-md",
        muted && "opacity-45",
      )}
    >
      {HANDLE_POSITIONS.map(({ side, position }) => (
        <span key={side}>
          <Handle
            id={`target-${side}`}
            type="target"
            position={position}
            className="!size-2 !opacity-0"
          />
          <Handle
            id={`source-${side}`}
            type="source"
            position={position}
            className="!size-2 !opacity-0"
          />
        </span>
      ))}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {KIND_LABELS[item.kind]}
        </span>
        <span
          className={cn(
            "size-2 rounded-full",
            selected ? "bg-primary" : "border border-amber-400 bg-amber-100",
          )}
          aria-hidden="true"
        />
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-[18px]">{item.title}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
        <span>{connectionCount} {connectionCount === 1 ? "connection" : "connections"}</span>
        {onExplore ? (
          <button
            type="button"
            className="nodrag nopan rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Explore connections for ${item.title}${hiddenConnectionCount > 0 ? ` (${hiddenConnectionCount} hidden)` : ""}`}
            onClick={(event) => { event.stopPropagation(); onExplore(); }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            Explore
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NetworkNode({ data, selected }: NodeProps<ArchitectureNode>) {
  return (
    <ModelNetworkNode {...data} selected={selected}>
      {HANDLE_POSITIONS.map(({ side, position }) => (
        <span key={side}>
          <Handle id={`target-${side}`} type="target" position={position} className="!size-2 !opacity-0" />
          <Handle id={`source-${side}`} type="source" position={position} className="!size-2 !opacity-0" />
        </span>
      ))}
    </ModelNetworkNode>
  );
}

const nodeTypes = {
  architecture: ArchitectureNodeCard,
  network: NetworkNode,
} satisfies NodeTypes;

function RelationshipEdge(props: EdgeProps<ArchitectureEdge>) {
  const [hovered, setHovered] = useState(false);
  const route = props.data?.route;
  const [fallbackPath, fallbackX, fallbackY] = getSmoothStepPath(props);
  const label = props.data?.relationship.predicate.replaceAll("_", " ");
  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <title>{props.data?.description}</title>
      <BaseEdge
        id={props.id}
        path={route?.path ?? fallbackPath}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
        style={{ ...props.style, ...(hovered ? { opacity: 1, strokeWidth: 2 } : {}), strokeLinejoin: "round" }}
        label={hovered || props.selected ? label : route?.labelVisible === false ? undefined : props.label}
        labelX={route?.labelPosition.x ?? fallbackX}
        labelY={route?.labelPosition.y ?? fallbackY}
        labelStyle={{ ...props.labelStyle, opacity: 1 }}
        labelShowBg
        labelBgPadding={[7, 4]}
        labelBgBorderRadius={6}
        labelBgStyle={{ ...props.labelBgStyle, fillOpacity: 0.98 }}
      />
    </g>
  );
}

const edgeTypes = { relationship: RelationshipEdge } satisfies EdgeTypes;

function closestHandleSides(source: NodePosition, target: NodePosition): {
  sourceSide: HandleSide;
  targetSide: HandleSide;
} {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const horizontalWeight = Math.abs(deltaX) / NODE_WIDTH;
  const verticalWeight = Math.abs(deltaY) / NODE_HEIGHT;
  if (horizontalWeight >= verticalWeight) {
    return deltaX >= 0
      ? { sourceSide: "right", targetSide: "left" }
      : { sourceSide: "left", targetSide: "right" };
  }
  return deltaY >= 0
    ? { sourceSide: "bottom", targetSide: "top" }
    : { sourceSide: "top", targetSide: "bottom" };
}

function createEdges(
  relationships: MemoryRelationship[],
  positions: Map<string, NodePosition>,
): ArchitectureEdge[] {
  return relationships.map((relationship) => {
    const source = positions.get(relationship.from_id) ?? { x: 0, y: 0 };
    const target = positions.get(relationship.to_id) ?? { x: NODE_WIDTH, y: 0 };
    const { sourceSide, targetSide } = closestHandleSides(source, target);
    return {
      id: relationship.id,
      source: relationship.from_id,
      target: relationship.to_id,
      sourceHandle: `source-${sourceSide}`,
      targetHandle: `target-${targetSide}`,
      type: "relationship",
      data: { relationship },
      label: relationships.length <= 8 ? relationship.predicate.replaceAll("_", " ") : undefined,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: "var(--map-edge)",
      },
      style: { stroke: "var(--map-edge)", strokeWidth: 1.35 },
      labelStyle: { fill: "var(--map-label)", fontSize: 10, fontWeight: 500 },
      labelShowBg: true,
      labelBgPadding: [7, 4] as [number, number],
      labelBgBorderRadius: 8,
      labelBgStyle: {
        fill: "var(--map-label-bg)",
        fillOpacity: 0.96,
        stroke: "var(--map-label-border)",
        strokeWidth: 0.75,
      },
      interactionWidth: 24,
      ariaRole: "button" as const,
      ariaLabel: `${relationship.predicate.replaceAll("_", " ")} connection`,
    };
  });
}

function connectionCounts(
  objects: MemoryObject[],
  relationships: MemoryRelationship[],
): Map<string, number> {
  const counts = new Map(objects.map((item) => [item.id, 0]));
  for (const relationship of relationships) {
    if (counts.has(relationship.from_id)) {
      counts.set(relationship.from_id, (counts.get(relationship.from_id) ?? 0) + 1);
    }
    if (counts.has(relationship.to_id)) {
      counts.set(relationship.to_id, (counts.get(relationship.to_id) ?? 0) + 1);
    }
  }
  return counts;
}

function forceAnchors(
  anchors: Map<string, NodePosition>,
  strength: number,
): Force<ForceNode, ForceLink> {
  let nodes: ForceNode[] = [];
  const force: Force<ForceNode, ForceLink> = (alpha) => {
    for (const node of nodes) {
      const anchor = anchors.get(node.id);
      if (!anchor) continue;
      node.vx = (node.vx ?? 0) + (anchor.x - (node.x ?? 0)) * strength * alpha;
      node.vy = (node.vy ?? 0) + (anchor.y - (node.y ?? 0)) * strength * alpha;
    }
  };
  force.initialize = (nextNodes) => {
    nodes = nextNodes;
  };
  return force;
}

function softForcePositions(
  nodes: ArchitectureNode[],
  relationships: MemoryRelationship[],
  pinnedNodeId: string,
): Map<string, NodePosition> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const anchors = new Map(nodes.map((node) => [node.id, node.position]));
  const simulationNodes: ForceNode[] = nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    ...(node.id === pinnedNodeId
      ? { fx: node.position.x, fy: node.position.y }
      : {}),
  }));
  const simulationLinks = relationshipLayoutLinks(nodeIds, relationships);

  const simulation = forceSimulation(simulationNodes)
    .alpha(0.42)
    .force("link", forceLink<ForceNode, LayoutLink>(simulationLinks)
      .id((node) => node.id)
      .distance((link) => link.distance)
      .strength((link) => link.strength * 0.22))
    .force("charge", forceManyBody<ForceNode>()
      .strength(-280)
      .distanceMin(72)
      .distanceMax(420))
    .force("anchor", forceAnchors(anchors, 0.14))
    .force("collision", forceRectangleCollide())
    .velocityDecay(0.56)
    .stop();

  for (let tick = 0; tick < 90; tick += 1) simulation.tick();

  const positions = new Map(simulationNodes.map((node) => {
    const anchor = anchors.get(node.id) ?? { x: node.x ?? 0, y: node.y ?? 0 };
    const maxDisplacement = node.id === pinnedNodeId ? 0 : 120;
    const deltaX = Math.max(-maxDisplacement, Math.min(maxDisplacement, (node.x ?? 0) - anchor.x));
    const deltaY = Math.max(-maxDisplacement, Math.min(maxDisplacement, (node.y ?? 0) - anchor.y));
    return [node.id, {
      x: anchor.x + deltaX,
      y: anchor.y + deltaY,
    }] as const;
  }));
  return separateCards(positions, { pinnedId: pinnedNodeId });
}

function repelNearbyNodes(
  nodes: ArchitectureNode[],
  draggedNode: ArchitectureNode,
): ArchitectureNode[] {
  const influenceX = NODE_WIDTH + 150;
  const influenceY = NODE_HEIGHT + 120;
  const draggedCenter = {
    x: draggedNode.position.x + NODE_WIDTH / 2,
    y: draggedNode.position.y + NODE_HEIGHT / 2,
  };

  const nudged = nodes.map((node, index) => {
    if (node.id === draggedNode.id) {
      return { ...node, position: draggedNode.position };
    }

    const deltaX = node.position.x + NODE_WIDTH / 2 - draggedCenter.x;
    const deltaY = node.position.y + NODE_HEIGHT / 2 - draggedCenter.y;
    const normalizedX = deltaX / influenceX;
    const normalizedY = deltaY / influenceY;
    const normalizedDistance = Math.hypot(normalizedX, normalizedY);
    if (normalizedDistance >= 1) return node;

    const directionLength = Math.hypot(deltaX, deltaY);
    const directionX = directionLength === 0 ? (index % 2 === 0 ? 1 : -1) : deltaX / directionLength;
    const directionY = directionLength === 0 ? (index % 3 === 0 ? 1 : -1) : deltaY / directionLength;
    const falloff = (1 - normalizedDistance) ** 2;
    return {
      ...node,
      position: {
        x: node.position.x + directionX * falloff * 8,
        y: node.position.y + directionY * falloff * 6,
      },
    };
  });
  const positions = separateCards(
    new Map(nudged.map((node) => [node.id, node.position])),
    { pinnedId: draggedNode.id, passes: 24 },
  );
  return nudged.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}

function layoutDirectedGraph(
  objects: MemoryObject[],
  relationships: MemoryRelationship[],
  direction: Exclude<LayoutMode, "balanced">,
): { nodes: ArchitectureNode[]; edges: ArchitectureEdge[] } {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    align: "UL",
    nodesep: direction === "LR" ? CARD_VERTICAL_GAP : CARD_HORIZONTAL_GAP,
    ranksep: 112,
    marginx: 40,
    marginy: 54,
  });

  for (const item of objects) {
    graph.setNode(item.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const relationship of relationships) {
    graph.setEdge(relationship.from_id, relationship.to_id);
  }
  dagre.layout(graph);

  const counts = connectionCounts(objects, relationships);
  const nodes: ArchitectureNode[] = objects.map((item) => {
    const position = graph.node(item.id) as { x: number; y: number };
    return {
      id: item.id,
      type: "architecture",
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      data: { item, muted: false, connectionCount: counts.get(item.id) ?? 0 },
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      ariaRole: "button",
      ariaLabel: `${KIND_LABELS[item.kind]}: ${item.title}`,
    };
  });

  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  return { nodes, edges: createEdges(relationships, positions) };
}

function layoutBalancedGraph(
  objects: MemoryObject[],
  relationships: MemoryRelationship[],
): { nodes: ArchitectureNode[]; edges: ArchitectureEdge[] } {
  const objectIds = new Set(objects.map((item) => item.id));
  const visibleRelationships = relationships.filter(
    (relationship) => objectIds.has(relationship.from_id) && objectIds.has(relationship.to_id),
  );
  const neighbours = new Map(objects.map((item) => [item.id, new Set<string>()]));
  for (const relationship of visibleRelationships) {
    neighbours.get(relationship.from_id)?.add(relationship.to_id);
    neighbours.get(relationship.to_id)?.add(relationship.from_id);
  }
  const degree = new Map([...neighbours].map(([id, adjacent]) => [id, adjacent.size]));

  const byId = new Map(objects.map((item) => [item.id, item]));
  const remaining = new Set(objects.map((item) => item.id));
  const components: MemoryObject[][] = [];
  while (remaining.size > 0) {
    const first = [...remaining].sort()[0];
    const queue = [first];
    const component: MemoryObject[] = [];
    remaining.delete(first);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      for (const neighbour of [...(neighbours.get(id) ?? [])].sort()) {
        if (!remaining.has(neighbour)) continue;
        remaining.delete(neighbour);
        queue.push(neighbour);
      }
    }
    components.push(component);
  }

  const componentLayouts = components.map((component) => {
    const ids = new Set(component.map((item) => item.id));
    const componentRelationships = visibleRelationships.filter(
      (relationship) => ids.has(relationship.from_id) && ids.has(relationship.to_id),
    );
    const positions = layoutCardCluster([...ids], relationshipLayoutLinks(ids, componentRelationships));

    const values = [...positions.values()];
    const minX = Math.min(...values.map((position) => position.x));
    const minY = Math.min(...values.map((position) => position.y));
    const maxX = Math.max(...values.map((position) => position.x));
    const maxY = Math.max(...values.map((position) => position.y));
    return {
      component,
      positions,
      minX,
      minY,
      width: maxX - minX + NODE_WIDTH,
      height: maxY - minY + NODE_HEIGHT,
    };
  }).sort((a, b) => b.height * b.width - a.height * a.width || a.component[0].id.localeCompare(b.component[0].id));

  const totalArea = componentLayouts.reduce(
    (sum, component) => sum + (component.width + CARD_HORIZONTAL_GAP) * (component.height + CARD_VERTICAL_GAP),
    0,
  );
  const targetWidth = Math.max(960, Math.sqrt(totalArea * 1.9));
  const packedPositions = new Map<string, { x: number; y: number }>();
  let cursorX = 52;
  let cursorY = 52;
  let rowHeight = 0;
  for (const component of componentLayouts) {
    if (cursorX > 52 && cursorX + component.width > targetWidth) {
      cursorX = 52;
      cursorY += rowHeight + CARD_VERTICAL_GAP;
      rowHeight = 0;
    }
    for (const item of component.component) {
      const local = component.positions.get(item.id)!;
      packedPositions.set(item.id, {
        x: cursorX + local.x - component.minX,
        y: cursorY + local.y - component.minY,
      });
    }
    cursorX += component.width + CARD_HORIZONTAL_GAP;
    rowHeight = Math.max(rowHeight, component.height);
  }

  const nodes: ArchitectureNode[] = objects.map((item) => {
    const position = packedPositions.get(item.id)!;
    return {
      id: item.id,
      type: "architecture",
      position,
      data: { item, muted: false, connectionCount: degree.get(item.id) ?? 0 },
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      ariaRole: "button",
      ariaLabel: `${KIND_LABELS[item.kind]}: ${item.title}`,
    };
  });

  return {
    nodes,
    edges: createEdges(visibleRelationships, packedPositions),
  };
}

function layoutGraph(
  objects: MemoryObject[],
  relationships: MemoryRelationship[],
  mode: LayoutMode,
) {
  return mode === "balanced"
    ? layoutBalancedGraph(objects, relationships)
    : layoutDirectedGraph(objects, relationships, mode);
}

export function ModelGraph({
  objects,
  relationships,
  focusableObjects,
  searchPlaceholder,
  presentation,
  onPresentationChange,
  dense = false,
  focusedNodeId,
  focusTitle,
  connectionCounts: totalConnections,
  hiddenConnectionCounts,
  navigation,
  summary,
  onFocusNode,
  selectedNodeId,
  selectedRelationshipId,
  onSelectNode,
  onSelectRelationship,
  onClearSelection,
}: {
  objects: MemoryObject[];
  relationships: MemoryRelationship[];
  focusableObjects: MemoryObject[];
  searchPlaceholder: string;
  presentation: MapPresentation;
  onPresentationChange: (presentation: MapPresentation) => void;
  dense?: boolean;
  focusedNodeId?: string | null;
  focusTitle?: string;
  connectionCounts: Map<string, number>;
  hiddenConnectionCounts: Map<string, number>;
  navigation: ReactNode;
  summary: string;
  onFocusNode: (id: string) => void;
  selectedNodeId: string | null;
  selectedRelationshipId: string | null;
  onSelectNode: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onClearSelection: () => void;
}) {
  const [layout, setLayout] = useState<LayoutMode>("LR");
  const [mapTheme, setMapTheme] = useState<MapThemeId>("auto");
  const [focusQuery, setFocusQuery] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const compactView = Boolean(focusTitle) || objects.length <= MAP_OVERVIEW_LIMIT;
  const visibleKinds = useMemo(() => Object.keys(KIND_LABELS).filter((kind) =>
    objects.some((item) => item.kind === kind)) as MemoryObject["kind"][], [objects]);
  const focusResults = useMemo(() => {
    const query = focusQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return focusableObjects
      .filter((item) => item.title.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 8);
  }, [focusQuery, focusableObjects]);
  const initial = useMemo(() => {
    const graph = layoutGraph(objects, relationships, layout);
    return dense ? { ...graph, edges: graph.edges.map((edge) => ({ ...edge, label: undefined })) } : graph;
  }, [dense, layout, objects, relationships]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ArchitectureNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ArchitectureEdge>(initial.edges);
  const routes = useMemo(() => {
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    return presentation === "network"
      ? networkRelationshipRoutes(relationships, positions, totalConnections)
      : routeRelationships(relationships, positions);
  }, [nodes, presentation, relationships, totalConnections]);
  const displayedEdges = useMemo(() => {
    const titles = new Map(objects.map((item) => [item.id, item.title]));
    return edges.map((edge) => {
      const route = routes.get(edge.id);
      const relationship = edge.data!.relationship;
      const description = `${titles.get(edge.source) ?? edge.source} → ${relationship.predicate.replaceAll("_", " ")} → ${titles.get(edge.target) ?? edge.target}`;
      return {
        ...edge,
        ...(route ? { sourceHandle: `source-${route.sourceSide}`, targetHandle: `target-${route.targetSide}` } : {}),
        data: { ...edge.data!, route, description },
        ariaLabel: description,
        domAttributes: {
          onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectRelationship(edge.id);
            } else if (event.key === "Escape") {
              onClearSelection();
            }
          },
        },
      };
    });
  }, [edges, objects, routes, onSelectRelationship, onClearSelection]);
  const [expanded, setExpanded] = useState(false);
  const [instance, setInstance] = useState<ReactFlowInstance<ArchitectureNode, ArchitectureEdge> | null>(null);
  const forceAnimationFrame = useRef<number | null>(null);
  const fittedGraph = useRef<typeof initial | null>(null);
  const activateNode = useCallback((id: string) => {
    if (presentation === "network" && id !== focusedNodeId) onFocusNode(id);
    else onSelectNode(id);
  }, [presentation, focusedNodeId, onFocusNode, onSelectNode]);
  const displayedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    type: presentation === "network" ? "network" as const : "architecture" as const,
    ...(presentation === "network" ? {
      ariaLabel: `${node.data.item.title}${node.id === focusedNodeId ? "; current focus" : ""}`,
    } : {}),
    data: {
      ...node.data,
      connectionCount: totalConnections.get(node.id) ?? 0,
      hiddenConnectionCount: hiddenConnectionCounts.get(node.id) ?? 0,
      focused: node.id === focusedNodeId,
      onExplore: node.id === focusedNodeId
        ? undefined
        : () => onFocusNode(node.id),
      onDetails: () => onSelectNode(node.id),
    },
  })), [nodes, presentation, totalConnections, hiddenConnectionCounts, focusedNodeId, onFocusNode, onSelectNode]);

  const focusOnResult = useCallback((id: string) => {
    setFocusQuery("");
    onFocusNode(id);
  }, [onFocusNode]);

  const stopSoftForce = useCallback(() => {
    if (forceAnimationFrame.current !== null) {
      window.cancelAnimationFrame(forceAnimationFrame.current);
      forceAnimationFrame.current = null;
    }
  }, []);

  useEffect(() => stopSoftForce, [stopSoftForce]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(MAP_THEME_STORAGE_KEY);
    if (!isMapThemeId(storedTheme)) return;
    const frame = window.requestAnimationFrame(() => setMapTheme(storedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    stopSoftForce();
    setNodes(initial.nodes);
    setEdges(initial.edges);
  }, [initial, setEdges, setNodes, stopSoftForce]);

  useEffect(() => {
    if (!instance || fittedGraph.current === initial) return;
    const nodesReady = nodes.length === initial.nodes.length && nodes.every((node, index) => {
      const expected = initial.nodes[index];
      return node.id === expected.id &&
        node.position.x === expected.position.x &&
        node.position.y === expected.position.y;
    });
    if (!nodesReady) return;
    fittedGraph.current = initial;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({
        padding: MAP_VIEWPORT_PADDING,
        minZoom: compactView ? 0.35 : DEFAULT_OVERVIEW_ZOOM,
        maxZoom: 1,
        duration: 420,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compactView, initial, instance, nodes]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !selectedNodeId && !selectedRelationshipId) {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, selectedNodeId, selectedRelationshipId]);

  useEffect(() => {
    if (!instance) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({
        padding: MAP_VIEWPORT_PADDING,
        minZoom: compactView ? 0.35 : DEFAULT_OVERVIEW_ZOOM,
        maxZoom: 1,
        duration: 350,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, compactView, instance]);

  const applyLayout = useCallback((nextLayout: LayoutMode) => {
    setLayout(nextLayout);
  }, []);

  const applyMapTheme = useCallback((nextTheme: MapThemeId) => {
    setMapTheme(nextTheme);
    window.localStorage.setItem(MAP_THEME_STORAGE_KEY, nextTheme);
  }, []);

  const applySoftForce = useCallback((draggedNode: ArchitectureNode) => {
    if (layout !== "balanced" || nodes.length < 2) return;
    stopSoftForce();
    const pinnedNodeId = draggedNode.id;
    const currentNodes = (instance?.getNodes() ?? nodes).map((node) =>
      node.id === pinnedNodeId ? { ...node, position: draggedNode.position } : node);
    const startingPositions = new Map(currentNodes.map((node) => [node.id, node.position]));
    const targetPositions = softForcePositions(currentNodes, relationships, pinnedNodeId);
    const startedAt = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380;

    const animate = (time: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (time - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const positions = interpolateSeparatedPositions(startingPositions, targetPositions, eased, pinnedNodeId);
      setNodes((current) => current.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      })));

      if (progress < 1) {
        forceAnimationFrame.current = window.requestAnimationFrame(animate);
      } else {
        forceAnimationFrame.current = null;
      }
    };

    forceAnimationFrame.current = window.requestAnimationFrame(animate);
  }, [instance, layout, nodes, relationships, setNodes, stopSoftForce]);

  const applyLiveRepulsion = useCallback((draggedNode: ArchitectureNode) => {
    if (layout !== "balanced") return;
    const next = repelNearbyNodes(instance?.getNodes() ?? nodes, draggedNode);
    setNodes(next);
  }, [instance, layout, nodes, setNodes]);

  useEffect(() => {
    const selectedRelationship = relationships.find((relationship) => relationship.id === selectedRelationshipId);
    const emphasizedNodeId = selectedNodeId ?? (presentation === "network" && initial.nodes.some((node) => node.id === hoveredNodeId) ? hoveredNodeId : null);
    const emphasizedNodes = new Set<string>();
    if (selectedRelationship) {
      emphasizedNodes.add(selectedRelationship.from_id);
      emphasizedNodes.add(selectedRelationship.to_id);
    } else if (emphasizedNodeId) {
      emphasizedNodes.add(emphasizedNodeId);
      for (const relationship of relationships) {
        if (relationship.from_id === emphasizedNodeId) emphasizedNodes.add(relationship.to_id);
        if (relationship.to_id === emphasizedNodeId) emphasizedNodes.add(relationship.from_id);
      }
    }

    const hasSelection = emphasizedNodes.size > 0;
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId || node.id === focusedNodeId || emphasizedNodes.has(node.id) && Boolean(selectedRelationship),
      data: {
        ...node.data,
        muted: hasSelection && !emphasizedNodes.has(node.id),
      },
    })));
    setEdges((current) => current.map((edge) => {
      const active = selectedRelationship
        ? edge.id === selectedRelationship.id
        : Boolean(emphasizedNodeId && (edge.source === emphasizedNodeId || edge.target === emphasizedNodeId));
      const showLabel = selectedRelationship && active || presentation === "cards" && !dense && (active || !hasSelection && relationships.length <= 8);
      return {
        ...edge,
        label: showLabel ? edge.data?.relationship.predicate.replaceAll("_", " ") : undefined,
        selected: edge.id === selectedRelationshipId,
        animated: false,
        style: {
          stroke: active ? "var(--map-edge-active)" : "var(--map-edge)",
          strokeWidth: active ? 2.2 : dense ? 1 : 1.25,
          opacity: hasSelection && !active ? 0.14 : active ? 1 : presentation === "network" ? 0.7 : dense ? 0.28 : 1,
          transition: "opacity 160ms ease, stroke 160ms ease",
        },
        labelStyle: {
          fill: active ? "var(--map-label-active)" : "var(--map-label)",
          fontSize: 10,
          fontWeight: active ? 600 : 500,
          opacity: hasSelection && !active ? 0.12 : 1,
          transition: "opacity 160ms ease",
        },
        labelBgStyle: {
          fill: "var(--map-label-bg)",
          fillOpacity: hasSelection && !active ? 0.18 : 0.94,
          stroke: "var(--map-label-border)",
          strokeWidth: 0.75,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: active ? "var(--map-edge-active)" : "var(--map-edge)",
        },
      };
    }));
  }, [dense, focusedNodeId, hoveredNodeId, initial, presentation, relationships, selectedNodeId, selectedRelationshipId, setEdges, setNodes]);

  useEffect(() => {
    const selectedRelationship = relationships.find((relationship) => relationship.id === selectedRelationshipId);
    const emphasizedNodes = new Set<string>();
    if (selectedRelationship) {
      emphasizedNodes.add(selectedRelationship.from_id);
      emphasizedNodes.add(selectedRelationship.to_id);
    } else if (selectedNodeId) {
      emphasizedNodes.add(selectedNodeId);
      for (const relationship of relationships) {
        if (relationship.from_id === selectedNodeId) emphasizedNodes.add(relationship.to_id);
        if (relationship.to_id === selectedNodeId) emphasizedNodes.add(relationship.from_id);
      }
    }
    if (emphasizedNodes.size > 0 && instance) {
      window.requestAnimationFrame(() => {
        void instance.fitView({
          nodes: [...emphasizedNodes].map((id) => ({ id })),
          padding: MAP_VIEWPORT_PADDING,
          minZoom: compactView ? 0.35 : DEFAULT_OVERVIEW_ZOOM,
          maxZoom: 1.08,
          duration: 420,
        });
      });
    }
  }, [compactView, instance, relationships, selectedNodeId, selectedRelationshipId]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-card",
        expanded
          ? "fixed inset-0 z-40 h-dvh w-dvw"
          : "relative h-[calc(100svh-230px)] min-h-[720px] max-h-[1080px] rounded-xl border shadow-sm",
      )}
      data-testid="model-map"
      data-expanded={expanded}
      data-presentation={presentation}
      data-map-theme={mapTheme}
    >
      <ModelMapToolbar
        navigation={navigation}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((current) => !current)}
        presentation={presentation}
        onPresentationChange={onPresentationChange}
        layout={layout}
        onLayoutChange={applyLayout}
        searchPlaceholder={searchPlaceholder}
        query={focusQuery}
        onQueryChange={setFocusQuery}
        results={focusResults}
        onFocusResult={focusOnResult}
        theme={mapTheme}
        onThemeChange={applyMapTheme}
        viewportReady={Boolean(instance)}
        onZoomIn={() => { void instance?.zoomIn(); }}
        onZoomOut={() => { void instance?.zoomOut(); }}
        onFitView={() => { void instance?.fitView({ padding: MAP_VIEWPORT_PADDING, maxZoom: 1 }); }}
      />
      <div className="relative min-h-0 flex-1" data-testid="model-map-canvas">
        <ReactFlow<ArchitectureNode, ArchitectureEdge>
          nodes={displayedNodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => {
            if (presentation === "network" && event.detail > 1) return;
            activateNode(node.id);
          }}
          onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onNodeDoubleClick={presentation === "cards" ? (_, node) => onFocusNode(node.id) : undefined}
          zoomOnDoubleClick={false}
          onEdgeClick={(_, edge) => onSelectRelationship(edge.id)}
          onPaneClick={onClearSelection}
          onNodeDragStart={() => { stopSoftForce(); setHoveredNodeId(null); }}
          onNodeDrag={(_, node) => applyLiveRepulsion(node)}
          onNodeDragStop={(_, node) => applySoftForce(node)}
          onInit={setInstance}
          fitView
          fitViewOptions={{ padding: MAP_VIEWPORT_PADDING, minZoom: compactView ? 0.35 : DEFAULT_OVERVIEW_ZOOM, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          elevateEdgesOnSelect
          selectionOnDrag
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} color="var(--map-grid)" />
          {!focusTitle && objects.length > 24 ? <MiniMap<ArchitectureNode>
            pannable
            zoomable
            position="bottom-right"
            className="!hidden sm:!block"
            nodeColor={(node) => presentation === "network" ? modelKindColor(node.data.item.kind) : node.selected ? "var(--map-minimap-node-active)" : "var(--map-minimap-node)"}
            nodeStrokeColor={(node) => node.selected ? "var(--map-minimap-stroke-active)" : "var(--map-minimap-stroke)"}
            nodeBorderRadius={presentation === "network" ? NODE_HEIGHT / 2 : 6}
            bgColor="var(--map-minimap-bg)"
            maskColor="var(--map-minimap-mask)"
            ariaLabel="Model map overview"
          /> : null}
          <Panel position="bottom-center" className="!mb-4 max-w-[calc(100%-7rem)]">
            <div className="rounded-md border bg-background/95 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur">
              {presentation === "network" ? (
                <ul className="mb-1.5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-foreground" aria-label="Node types">
                  {visibleKinds.map((kind) => (
                    <li key={kind} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: modelKindColor(kind) }} aria-hidden="true" />
                      {KIND_LABELS[kind]}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p aria-live="polite">{summary}</p>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
