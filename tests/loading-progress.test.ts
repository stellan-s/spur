import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OrganizationLayout from "@/app/o/[organization]/layout";
import { NavigationProgress } from "@/components/navigation-progress";
import { TopLoadingBar } from "@/components/ui/top-loading-bar";
import { WorkspaceLoading } from "@/components/workspace-loading";
import { useWorkspaceState, WorkspaceStateProvider } from "@/components/workspace-state";

vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }) }));

const stylesheet = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("non-blocking loading progress", () => {
  it("announces loading without inventing a completion percentage", () => {
    const html = renderToStaticMarkup(createElement(TopLoadingBar, { label: "Refreshing workspace" }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Refreshing workspace"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("dialog");
  });

  it("occupies only the top border and never intercepts clicks", () => {
    const bar = stylesheet.split(".top-loading-bar {")[1].split("}")[0];
    expect(bar).toContain("pointer-events: none");
    expect(bar).toContain("position: fixed");
    expect(bar).toContain("inset: 0 0 auto");
    expect(bar).toContain("height: 3px");
  });

  it("keeps a static indicator for reduced-motion preferences", () => {
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.top-loading-bar-indicator\s*{\s*width: 100%;\s*animation: none;/);
  });

  it("keeps the brand visible on a cold start without a central spinner", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLoading));
    expect(html).toContain("Spur</span>");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading organizational memory"');
    expect(html).not.toContain("Opening organizational memory");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("backdrop");
  });

  it("hides navigation progress when no link transition is pending", () => {
    expect(renderToStaticMarkup(createElement(NavigationProgress))).toBe("");
  });
});

describe("organization-scoped workspace state", () => {
  it("keys the shared state by organization so switching resets it", async () => {
    for (const organization of ["retail", "portal"]) {
      const layout = await OrganizationLayout({ children: "Workspace", params: Promise.resolve({ organization }) });
      expect(layout.type).toBe(WorkspaceStateProvider);
      expect(layout.key).toBe(organization);
      expect(layout.props.organizationSlug).toBe(organization);
    }
  });

  it("starts without cached data both inside and outside an organization layout", () => {
    function Probe() {
      const [workspace] = useWorkspaceState("retail");
      return workspace ? workspace.organization.name : "No retained workspace";
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("No retained workspace");
    expect(renderToStaticMarkup(createElement(WorkspaceStateProvider, {
      organizationSlug: "retail",
    }, createElement(Probe)))).toBe("No retained workspace");
  });
});
