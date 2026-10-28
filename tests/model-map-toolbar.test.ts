import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelGraph } from "@/components/model-graph";
import { ModelMapToolbar } from "@/components/model-map-toolbar";

function toolbarProps() {
  return {
    navigation: createElement("nav", null, "Overview"), expanded: false,
    onToggleExpanded: vi.fn(), presentation: "network" as const, onPresentationChange: vi.fn(),
    layout: "balanced" as const, onLayoutChange: vi.fn(), searchPlaceholder: "Search connected entities",
    query: "", onQueryChange: vi.fn(), results: [{ id: "project", title: "Project" }], onFocusResult: vi.fn(),
    viewportReady: true, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFitView: vi.fn(),
  };
}

function findControl(node: ReactNode, label: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map((child) => findControl(child, label)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.props["aria-label"] === label) return node.props;
  return findControl(node.props.children as ReactNode, label);
}

describe("map top toolbar", () => {
  it("groups navigation, display, layout, search and zoom in one responsive surface", () => {
    const html = renderToStaticMarkup(createElement(ModelMapToolbar, toolbarProps()));
    for (const label of ["Map controls", "Node display", "Map layout", "Map zoom", "Search connected entities"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("flex-wrap items-center gap-2");
    expect(html).toContain("min-w-40 flex-1 basis-56");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("position:absolute");
  });

  it("keeps zoom and layout callbacks working after moving out of the canvas", () => {
    const props = toolbarProps();
    const tree = ModelMapToolbar(props);
    for (const [label, callback] of [
      ["Zoom in", props.onZoomIn], ["Zoom out", props.onZoomOut], ["Fit map to view", props.onFitView],
      ["Expand map to full screen", props.onToggleExpanded],
    ] as const) {
      (findControl(tree, label)?.onClick as () => void)();
      expect(callback).toHaveBeenCalledOnce();
    }
    (findControl(tree, "Horizontal layout")?.onClick as () => void)();
    expect(props.onLayoutChange).toHaveBeenCalledWith("LR");
  });

  it.each(["balanced", "LR", "TB"] as const)("clearly marks only the %s layout as active", (layout) => {
    const props = { ...toolbarProps(), layout };
    const tree = ModelMapToolbar(props);
    for (const [value, label] of [["balanced", "Connected"], ["LR", "Horizontal"], ["TB", "Vertical"]]) {
      const control = findControl(tree, `${label} layout`)!;
      expect(control["aria-pressed"]).toBe(value === layout);
      if (value === layout) {
        expect(control.className).toContain("border-primary/60 bg-primary/15 font-semibold");
        expect(control.className).toContain("hover:bg-primary/20");
      } else {
        expect(control.className).toContain("border-transparent text-muted-foreground");
        expect(control.className).not.toContain("bg-primary/15");
      }
      const check = (control.children as ReactNode[]).at(-1);
      expect(isValidElement<{ className: string }>(check) && check.props.className).toBe(value === layout ? "" : "invisible");
      (control.onClick as () => void)();
      expect(props.onLayoutChange).toHaveBeenLastCalledWith(value);
    }
  });

  it.each(["network", "cards"] as const)("clearly marks only the %s display as active", (presentation) => {
    const props = { ...toolbarProps(), presentation };
    const tree = ModelMapToolbar(props);
    const controls = findControl(tree, "Node display")!.children as ReactNode[];
    for (const [index, value] of ["network", "cards"].entries()) {
      const element = controls[index];
      expect(isValidElement(element)).toBe(true);
      if (!isValidElement<Record<string, unknown>>(element)) continue;
      const control = element.props;
      expect(control["aria-pressed"]).toBe(value === presentation);
      expect(control.className).toContain(value === presentation
        ? "border-primary/60 bg-primary/15 font-semibold"
        : "border-transparent text-muted-foreground");
      const check = (control.children as ReactNode[]).at(-1);
      expect(isValidElement<{ className: string }>(check) && check.props.className).toBe(value === presentation ? "" : "invisible");
      (control.onClick as () => void)();
      expect(props.onPresentationChange).toHaveBeenLastCalledWith(value);
    }
  });

  it("preserves Enter search and Escape without closing fullscreen", () => {
    const props = { ...toolbarProps(), query: "project", expanded: true };
    const tree = ModelMapToolbar(props);
    const input = findControl(tree, "Search connected entities")!;
    const onKeyDown = input.onKeyDown as (event: { key: string; stopPropagation: () => void }) => void;
    onKeyDown({ key: "Enter", stopPropagation: vi.fn() });
    expect(props.onFocusResult).toHaveBeenCalledWith("project");
    const stopPropagation = vi.fn();
    onKeyDown({ key: "Escape", stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(props.onQueryChange).toHaveBeenCalledWith("");
    expect(props.onToggleExpanded).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="Exit full screen"');
    expect(html).toContain("Project</button>");
  });

  it("disables viewport actions before the graph is ready and shows empty search results", () => {
    const tree = ModelMapToolbar({ ...toolbarProps(), viewportReady: false, query: "missing", results: [] });
    for (const label of ["Zoom in", "Zoom out", "Fit map to view"]) {
      expect(findControl(tree, label)?.disabled).toBe(true);
    }
    expect(renderToStaticMarkup(tree)).toContain("No matching connected nodes");
  });

  it("places the toolbar outside React Flow so wrapping cannot cover the map", () => {
    const html = renderToStaticMarkup(createElement(ModelGraph, {
      objects: [], relationships: [], focusableObjects: [], searchPlaceholder: "Search entities",
      presentation: "network", onPresentationChange: vi.fn(), connectionCounts: new Map(),
      hiddenConnectionCounts: new Map(), navigation: createElement("nav", null, "Overview"), summary: "Empty map",
      onFocusNode: vi.fn(), selectedNodeId: null, selectedRelationshipId: null,
      onSelectNode: vi.fn(), onSelectRelationship: vi.fn(), onClearSelection: vi.fn(),
    }));
    const canvas = html.indexOf('data-testid="model-map-canvas"');
    expect(canvas).toBeGreaterThan(html.indexOf('aria-label="Map controls"'));
    expect(canvas).toBeGreaterThan(html.indexOf('aria-label="Fit map to view"'));
    expect(html).toContain("relative min-h-0 flex-1");
    expect(html).toContain("h-[calc(100svh-230px)] min-h-[720px] max-h-[1080px]");
    expect(html).not.toContain("react-flow__controls");
  });
});
