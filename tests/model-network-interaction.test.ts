import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundProps, ReactFlowProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { ModelGraph } from "@/components/model-graph";
import { ModelMapExplorer } from "@/components/model-map-explorer";
import type { MemoryObject } from "@/core/memory-types";
import type { MapPresentation } from "@/lib/model-network";

const captured = vi.hoisted(() => ({ flow: null as ReactFlowProps | null, background: null as BackgroundProps | null }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xyflow/react")>(),
  ReactFlow: (props: ReactFlowProps) => { captured.flow = props; return props.children; },
  Background: (props: BackgroundProps) => { captured.background = props; return null; },
  MiniMap: () => null,
  Panel: ({ children }: { children: ReactNode }) => children,
}));

function renderGraph(presentation: MapPresentation = "network", focusedNodeId?: string) {
  const objects: MemoryObject[] = ["A", "B"].map((id) => ({
    id, title: id, kind: "entity", statement: "", state: "candidate", authority: "ai_inference",
    confidence: 0.9, subjects: [], evidence_ids: [], source_ids: [], source_version: null,
    actor: null, metadata: {}, created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:00:00Z",
  }));
  const onFocusNode = vi.fn();
  const onSelectNode = vi.fn();
  const html = renderToStaticMarkup(createElement(ModelGraph, {
    objects, relationships: [], focusableObjects: objects, searchPlaceholder: "Search entities",
    theme: "auto", presentation, onPresentationChange: vi.fn(), focusedNodeId,
    connectionCounts: new Map([["A", 1], ["B", 1]]), hiddenConnectionCounts: new Map(),
    navigation: createElement(ModelMapExplorer, {
      trail: [{ id: "previous", title: "Previous object" }], focus: objects[0],
      page: 0, pageCount: 2, neighborStart: 1, neighborEnd: 8, neighborCount: 12,
      onOverview: vi.fn(), onFocus: onFocusNode, onPage: vi.fn(),
    }),
    summary: "Test map", onFocusNode, selectedNodeId: null, selectedRelationshipId: null,
    onSelectNode, onSelectRelationship: vi.fn(), onClearSelection: vi.fn(),
  }));
  return { flow: captured.flow!, onFocusNode, onSelectNode, html };
}

describe("network exploration", () => {
  it.each(["network", "cards"] as const)("uses clearer theme-aware grid dots in %s", (presentation) => {
    renderGraph(presentation);
    expect(captured.background).toMatchObject({ variant: "dots", gap: 20, size: 1.6, color: "var(--map-grid)" });
  });

  it.each(["network", "cards"] as const)("defaults to the horizontal layout in %s", (presentation) => {
    const { html } = renderGraph(presentation);
    const horizontal = html.match(/<button[^>]*aria-label="Horizontal layout"[^>]*>/)?.[0];
    expect(horizontal).toContain('aria-pressed="true"');
    for (const label of ["Connected", "Vertical"]) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${label} layout"[^>]*>`))?.[0];
      expect(button).toContain('aria-pressed="false"');
    }
  });

  it("explores on a single node click instead of opening the inspector", () => {
    const { flow, onFocusNode, onSelectNode } = renderGraph();
    flow.onNodeClick?.({ detail: 1 } as MouseEvent, flow.nodes![1]);
    expect(onFocusNode).toHaveBeenCalledWith("B");
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it("keeps the focused node inspectable and ignores a second click from double-clicking", () => {
    const { flow, onFocusNode, onSelectNode } = renderGraph("network", "A");
    flow.onNodeClick?.({ detail: 2 } as MouseEvent, flow.nodes![0]);
    expect(onSelectNode).not.toHaveBeenCalled();
    flow.onNodeClick?.({ detail: 1 } as MouseEvent, flow.nodes![0]);
    expect(onSelectNode).toHaveBeenCalledWith("A");
    expect(onFocusNode).not.toHaveBeenCalled();
    expect(flow.nodes![0].data.focused).toBe(true);
    expect(flow.nodes![0].data.onExplore).toBeUndefined();
    expect(flow.onNodeDoubleClick).toBeUndefined();
  });

  it("exposes Details without changing focus", () => {
    const { flow, onFocusNode, onSelectNode } = renderGraph();
    (flow.nodes![1].data.onDetails as () => void)();
    expect(onSelectNode).toHaveBeenCalledWith("B");
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("labels focus without overriding React Flow keyboard movement", () => {
    const { flow } = renderGraph("network", "A");
    expect(flow.nodes![0].ariaLabel).toBe("A; current focus");
    expect(flow.nodes![1].ariaLabel).toBe("B");
    expect(flow.nodes![1].domAttributes).toBeUndefined();
    expect(flow.nodes![1].data.onExplore).toBeTypeOf("function");
  });

  it("retains the existing card click and double-click behavior", () => {
    const { flow, onFocusNode, onSelectNode } = renderGraph("cards");
    flow.onNodeClick?.({ detail: 1 } as MouseEvent, flow.nodes![1]);
    expect(onSelectNode).toHaveBeenCalledWith("B");
    expect(onFocusNode).not.toHaveBeenCalled();
    flow.onNodeDoubleClick?.({} as MouseEvent, flow.nodes![1]);
    expect(onFocusNode).toHaveBeenCalledWith("B");
    expect(flow.nodes![1].domAttributes).toBeUndefined();
  });

  it("uses card foreground colours for card titles in both presentations", () => {
    for (const presentation of ["network", "cards"] as const) {
      const { html } = renderGraph(presentation);
      expect(html).toContain("text-card-foreground");
    }
  });

  it.each(["network", "cards"] as const)("renders the trail and neighbour paging in %s", (presentation) => {
    const { html } = renderGraph(presentation, "A");
    expect(html).toContain('aria-label="Map exploration trail"');
    expect(html).toContain('aria-label="Back to Previous object"');
    expect(html).toContain('aria-label="Next neighbours"');
    expect(html).toContain("Previous object");
  });
});
