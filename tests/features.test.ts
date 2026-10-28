import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localPrincipal } from "@/core/access-store";
import { loadConfig } from "@/core/config";
import { FeatureDisabledError } from "@/core/errors";
import { applyFeatures, features, requireFeature, setFeature } from "@/core/features";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import { createSpurMcpServer } from "@/mcp/server";

function environment(organizationId: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SPUR_AUTH: "none",
    SPUR_ORGANIZATION_SLUG: organizationId,
    SPUR_ORGANIZATION_NAME: "Feature test",
    SPUR_CODE_SEARCH: "on",
    SPUR_SYNTHESIS_PROVIDER: "none",
  };
}

type InspectableMcpServer = {
  _registeredTools: Record<string, { enabled: boolean }>;
};

afterEach(() => vi.unstubAllEnvs());

describe("organisation features", () => {
  it("keeps a saved provider choice when the environment selects OpenAI", async () => {
    const organizationId = `provider-feature-${randomUUID()}`;
    const env = {
      ...environment(organizationId),
      SPUR_SYNTHESIS_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "test-model",
    };
    expect((await features(organizationId, env)).model_provider).toBe("openai");

    await setFeature(organizationId, "model_provider", "none", "local", env);
    const saved = await features(organizationId, env);
    const effective = applyFeatures(loadConfig(env), saved);
    expect(saved.model_provider).toBe("none");
    expect(effective.synthesisProvider).toBe("none");
    expect(effective.openAIKey).toBe("test-key");
    expect(effective.openAIModel).toBe("test-model");
  });

  it("uses environment defaults until a database value overrides them", async () => {
    const organizationId = `features-${randomUUID()}`;
    const env = environment(organizationId);
    expect((await features(organizationId, env)).code_search).toBe("on");

    const updated = await setFeature(organizationId, "code_search", "off", "local", env);
    expect(updated.code_search).toBe("off");
    expect((await features(organizationId, { ...env, SPUR_CODE_SEARCH: "ask" })).code_search).toBe("off");

    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
    try {
      const result = await pool.query<{ action: string; target_id: string }>(
        "SELECT action, target_id FROM audit_log WHERE organization_id = $1",
        [organizationId],
      );
      expect(result.rows).toContainEqual({ action: "feature.changed", target_id: "code_search" });
    } finally {
      await pool.end();
    }
  });

  it("returns the administrator message for a disabled feature", () => {
    expect(() => requireFeature({
      ask: false,
      code_search: "off",
      model_provider: "none",
      modelling_writes: true,
      isms: true,
      wiki: true,
      remote_mcp: false,
      knowledge_gaps: true,
    }, "ask")).toThrow(FeatureDisabledError);
    expect(() => requireFeature({
      ask: false,
      code_search: "off",
      model_provider: "none",
      modelling_writes: true,
      isms: true,
      wiki: true,
      remote_mcp: false,
      knowledge_gaps: true,
    }, "ask")).toThrow("This feature is turned off by your administrator.");
  });

  it("refuses an API route before creating its service", async () => {
    const organizationId = `route-feature-${randomUUID()}`;
    const env = environment(organizationId);
    await setFeature(organizationId, "ask", false, "local", env);
    for (const [name, value] of Object.entries(env)) {
      if (value !== undefined) vi.stubEnv(name, value);
    }
    vi.stubEnv("SPUR_BIND_ADDRESS", "127.0.0.1");
    await expect(createAuthenticatedRequestContext(new Request("http://localhost/api/investigate", {
      method: "POST",
      headers: { "x-spur-organization": organizationId },
    }))).rejects.toThrow("This feature is turned off by your administrator.");
  });

  it("omits tools whose organisation feature is off", async () => {
    const principal = localPrincipal("demo", "Local");
    const server = await createSpurMcpServer({
      principal,
      features: {
        ask: false,
        code_search: "off",
        model_provider: "none",
        modelling_writes: false,
        isms: false,
        wiki: false,
        remote_mcp: false,
        knowledge_gaps: false,
      },
    }) as unknown as InspectableMcpServer;
    expect(server._registeredTools.investigate.enabled).toBe(false);
    expect(server._registeredTools.search_repository.enabled).toBe(false);
    expect(server._registeredTools.propose_memory_objects.enabled).toBe(false);
    expect(server._registeredTools.list_isms_controls.enabled).toBe(false);
    expect(server._registeredTools.list_knowledge_gaps.enabled).toBe(false);
    expect(server._registeredTools.search_memory.enabled).toBe(true);
  });

  it("starts the local MCP server when the chosen model provider has no key here", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const server = await createSpurMcpServer({
      principal: localPrincipal("demo", "Local"),
      features: {
        ask: true,
        code_search: "off",
        model_provider: "openai",
        modelling_writes: true,
        isms: true,
        wiki: true,
        remote_mcp: true,
        knowledge_gaps: true,
      },
    }) as unknown as InspectableMcpServer;
    expect(server._registeredTools.investigate.enabled).toBe(true);
  });
});
