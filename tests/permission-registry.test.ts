import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type Principal } from "@/core/access-store";
import {
  API_ROUTE_PERMISSIONS,
  API_ROUTE_FEATURES,
  MCP_TOOL_FEATURES,
  MCP_TOOL_PERMISSIONS,
  pageAccess,
  routeAccess,
  type Permission,
} from "@/core/permissions";
import { createSpurMcpServer } from "@/mcp/server";

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}

function routePath(file: string): string {
  return file
    .slice(file.indexOf("/src/app/") + "/src/app".length)
    .replace(/\/route\.ts$/, "")
    .replaceAll(/\[([^\]]+)\]/g, ":$1");
}

type InspectableMcpServer = {
  _registeredTools: Record<string, { enabled: boolean }>;
};

describe("permission registries", () => {
  it("declares every API handler and MCP tool", async () => {
    const routeFiles = (await filesBelow(path.resolve("src/app")))
      .filter((file) => file.endsWith("/route.ts"));
    const physicalRoutes: string[] = [];
    for (const file of routeFiles) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\b/g)) {
        physicalRoutes.push(`${match[1]} ${routePath(file)}`);
      }
    }
    expect(Object.keys(API_ROUTE_PERMISSIONS).sort()).toEqual(physicalRoutes.sort());
    expect(Object.keys(API_ROUTE_FEATURES).sort()).toEqual(physicalRoutes.sort());
    for (const declaration of physicalRoutes) {
      const separator = declaration.indexOf(" ");
      expect(() => routeAccess(declaration.slice(0, separator), declaration.slice(separator + 1)
        .replaceAll(/:[^/]+/g, "value"))).not.toThrow();
    }

    const mcpSource = await readFile(path.resolve("src/mcp/server.ts"), "utf8");
    const names = [...mcpSource.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)]
      .map((match) => match[1]);
    expect(Object.keys(MCP_TOOL_PERMISSIONS).sort()).toEqual(names.sort());
    expect(Object.keys(MCP_TOOL_FEATURES).sort()).toEqual(names.sort());
  });

  it("shows only MCP tools allowed by the principal", async () => {
    const principal: Principal = {
      userId: "usr_test",
      organizationId: "demo",
      email: "reader@example.com",
      displayName: "Reader",
      accessStatus: "approved",
      permissions: new Set<Permission>(["mcp.connect", "memory.read"]),
    };
    const server = await createSpurMcpServer({
      principal,
      features: {
        ask: true,
        code_search: "on",
        model_provider: "none",
        modelling_writes: true,
        isms: true,
        wiki: true,
        remote_mcp: false,
        knowledge_gaps: true,
      },
    }) as unknown as InspectableMcpServer;
    const enabled = Object.entries(server._registeredTools)
      .filter(([, tool]) => tool.enabled)
      .map(([name]) => name)
      .sort();
    expect(enabled).toEqual(["get_memory", "get_modeling_schema", "get_product_document", "list_product_documents", "search_memory", "trace_relationships"]);
  });

  it("separates alias contribution from alias review", async () => {
    const principal: Principal = {
      userId: "usr_alias_contributor",
      organizationId: "demo",
      email: "contributor@example.com",
      displayName: "Contributor",
      accessStatus: "approved",
      permissions: new Set<Permission>(["mcp.connect", "memory.read", "memory.propose"]),
    };
    const featureSet = {
      ask: true,
      code_search: "on" as const,
      model_provider: "none" as const,
      modelling_writes: true,
      isms: true,
      wiki: true,
      remote_mcp: false,
      knowledge_gaps: true,
    };
    const contributor = await createSpurMcpServer({ principal, features: featureSet }) as unknown as InspectableMcpServer;
    expect(contributor._registeredTools.propose_memory_alias.enabled).toBe(true);
    expect(contributor._registeredTools.review_memory_alias.enabled).toBe(false);

    principal.permissions.add("memory.promote");
    const reviewer = await createSpurMcpServer({ principal, features: featureSet }) as unknown as InspectableMcpServer;
    expect(reviewer._registeredTools.review_memory_alias.enabled).toBe(true);
  });

  it("declares the global guide separately from organisation pages", () => {
    expect(pageAccess("/guide")).toBe("public");
    expect(pageAccess("/o/example/ask")).toBe("memory.ask");
    expect(pageAccess("/o/example/wiki/mem_example")).toBe("wiki.read");
    expect(pageAccess("/o/example/admin")).toBe("users.manage");
  });
});
