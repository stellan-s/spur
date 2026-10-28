import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelOverview } from "@/components/model-views";
import type { Workspace } from "@/core/memory-types";

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));

const workspace: Workspace = {
  organization: { slug: "example", name: "Example" },
  repository: { ready: true, name: "Example", commit_sha: "12345678" },
  provider: "none", synthesis_provider: "none", actor: "test",
  mcp: { ready: false, transport: "stdio", server_name: "spur", command: "", args: [], cwd: "", repository_root: "" },
  sources: [], relationships: [], counts: { memory: 1, sources: 0, candidates: 1 },
  memory: [{
    id: "project", kind: "entity", title: "Project", statement: "A project", state: "candidate",
    authority: "ai_inference", confidence: 0.9, subjects: [], evidence_ids: [], source_ids: [],
    source_version: null, actor: null, metadata: { epistemic_status: "agent_modeled_from_code" },
    created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:00:00Z",
  }],
};

describe("map view selector", () => {
  it.each([true, false])("shows a footer with useful links, including an empty model: %s", (empty) => {
    navigation.query = "map=entities";
    const html = renderToStaticMarkup(createElement(ModelOverview, {
      workspace: empty ? { ...workspace, memory: [], counts: { ...workspace.counts, memory: 0, candidates: 0 } } : workspace,
    }));
    const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
    expect(footer).toContain('aria-label="Model page footer"');
    expect(footer).toContain("Review important details against source evidence.");
    expect(footer).toContain('href="/o/example/model/catalog"');
    expect(footer).toContain('href="/guide"');
    expect(footer).toContain("flex-wrap");
    expect(footer).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(html.indexOf("<footer")).toBeGreaterThan(html.lastIndexOf("</section>"));
  });

  it.each(["", "map=entities", "map=architecture"])("shows the active view from the URL %s", (query) => {
    navigation.query = query;
    const html = renderToStaticMarkup(createElement(ModelOverview, { workspace }));
    expect(html).toContain('role="group" aria-label="Map view"');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    for (const label of ["Entities", "Architecture"]) {
      const button = buttons.find((item) => item.includes(`>${label}<svg`));
      const selected = (label === "Architecture") === (query === "map=architecture");
      expect(button).toBeDefined();
      expect(button).toContain(`aria-pressed="${selected}"`);
      expect(button).toContain(selected
        ? "border-primary/60 bg-primary/15 font-semibold"
        : "border-transparent text-muted-foreground");
      expect(button).toContain("lucide-check");
      expect(button?.includes("invisible")).toBe(!selected);
    }
  });
});
