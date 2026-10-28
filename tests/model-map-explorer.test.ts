import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelMapExplorer } from "@/components/model-map-explorer";

const defaults = {
  trail: [], page: 0, pageCount: 1, neighborStart: 0, neighborEnd: 0, neighborCount: 0,
  onOverview: () => {}, onFocus: () => {}, onPage: () => {},
};

function findStep(node: ReactNode, label: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map((child) => findStep(child, label)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.props.onClick && (node.props.title === label || node.props.children === label
    || (Array.isArray(node.props.children) && node.props.children.includes(label)))) return node.props;
  return findStep(node.props.children as ReactNode, label);
}

describe("map exploration controls", () => {
  it("offers an overview without full-map or growth controls", () => {
    const html = renderToStaticMarkup(createElement(ModelMapExplorer, defaults));
    expect(html).toContain('aria-label="Map exploration trail"');
    expect(html).toContain('aria-current="location"');
    expect(html).toContain("border-primary/60 bg-primary/15");
    expect(html).toContain("font-semibold");
    expect(html).toContain("lucide-check");
    expect(html).not.toContain("text-primary-foreground");
    expect(html).toContain("Overview</button>");
    expect(html).not.toContain("Full map");
    expect(html).not.toContain("Show more");
    expect(html).not.toContain("Browse neighbours");
  });

  it("provides a back-to-overview action for a directly opened focus", () => {
    const html = renderToStaticMarkup(createElement(ModelMapExplorer, {
      ...defaults, focus: { id: "A", title: "Project" },
    }));
    expect(html).toContain('aria-label="Back to overview"');
    expect(html).toContain('title="Project"');
  });

  it("renders clickable shadcn pills with a distinct, non-clickable current step", () => {
    const html = renderToStaticMarkup(createElement(ModelMapExplorer, {
      ...defaults, trail: [{ id: "A", title: "Organization" }], focus: { id: "B", title: "Project" },
    }));
    const pills = html.match(/<(?:button|span)[^>]*data-slot="badge"[^>]*>/g) ?? [];
    expect(pills).toHaveLength(3);
    expect(pills.every((pill) => pill.includes("rounded-full"))).toBe(true);
    expect(pills[0]).toMatch(/^<button/);
    expect(pills[1]).toMatch(/^<button/);
    expect(pills[1]).toContain('title="Organization"');
    for (const pill of pills.slice(0, 2)) {
      expect(pill).toContain("border-primary/15 bg-primary/5");
      expect(pill).toContain("hover:bg-primary/10");
    }
    expect(pills[2]).toMatch(/^<span/);
    expect(pills[2]).toContain('aria-current="location"');
    expect(pills[2]).toContain("border-primary/60 bg-primary/15");
    expect(pills[2]).toContain("font-semibold");
    expect(html.match(/lucide-check/g)).toHaveLength(1);
    expect(pills.every((pill) => pill.includes("text-foreground"))).toBe(true);
    expect(pills.some((pill) => pill.includes("text-primary-foreground"))).toBe(false);
    expect(html).toContain("flex-wrap items-center gap-1.5");
  });

  it("keeps overview, recent and overflow steps actionable", () => {
    const onOverview = vi.fn();
    const onFocus = vi.fn();
    const tree = ModelMapExplorer({
      ...defaults, trail: ["A", "B", "C", "D"].map((id) => ({ id, title: `Object ${id}` })),
      focus: { id: "E", title: "Current object" }, onOverview, onFocus,
    });
    (findStep(tree, "Overview")?.onClick as () => void)();
    (findStep(tree, "Object A")?.onClick as () => void)();
    (findStep(tree, "Object D")?.onClick as () => void)();
    expect(onOverview).toHaveBeenCalledOnce();
    expect(onFocus.mock.calls).toEqual([["A"], ["D"]]);
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/<summary[^>]*data-slot="badge"[^>]*rounded-full/);
    expect(html).toMatch(/<summary[^>]*border-primary\/15 bg-primary\/5/);
  });

  it("shows the trail and labelled page controls usable in fullscreen", () => {
    const html = renderToStaticMarkup(createElement(ModelMapExplorer, {
      ...defaults, trail: [{ id: "A", title: "Organization" }], focus: { id: "B", title: "Project" },
      pageCount: 3, neighborStart: 1, neighborEnd: 8, neighborCount: 20,
    }));
    expect(html).toContain('aria-label="Back to Organization"');
    expect(html).toContain('aria-label="Previous neighbours" disabled=""');
    expect(html).toContain('aria-label="Next neighbours"');
    expect(html).not.toContain('aria-label="Next neighbours" disabled');
    expect(html).toContain("Neighbours 1–8 of 20");
  });

  it("disables next on the last page and keeps older trail steps available", () => {
    const html = renderToStaticMarkup(createElement(ModelMapExplorer, {
      ...defaults, trail: ["A", "B", "C", "D"].map((id) => ({ id, title: `Object ${id}` })),
      focus: { id: "E", title: "Object E" }, page: 2, pageCount: 3,
      neighborStart: 17, neighborEnd: 20, neighborCount: 20,
    }));
    expect(html).toContain('aria-label="Earlier exploration steps"');
    for (const id of ["A", "B", "C", "D", "E"]) expect(html).toContain(`Object ${id}`);
    expect(html).toContain('aria-label="Next neighbours" disabled=""');
    expect(html).not.toContain('aria-label="Previous neighbours" disabled');
    expect(html).toContain("Neighbours 17–20 of 20");
  });
});
