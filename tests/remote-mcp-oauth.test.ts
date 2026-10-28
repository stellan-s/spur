import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessStore } from "@/core/access-store";
import { setFeature } from "@/core/features";
import { POST as remoteMcpPost } from "@/app/mcp/route";

const stores: AccessStore[] = [];

function store(): AccessStore {
  const access = new AccessStore(process.env.TEST_DATABASE_URL!);
  stores.push(access);
  return access;
}

async function approvedUser(access: AccessStore, organizationId: string) {
  await access.ensureOrganization(organizationId, "Remote MCP test");
  const email = `owner-${randomUUID()}@example.com`;
  return access.signInWithGoogle({
    organizationId,
    subject: randomUUID(),
    email,
    displayName: "Owner",
    bootstrapAdmins: new Set([email]),
    sessionLifetimeSeconds: 3_600,
  });
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((access) => access.close()));
  vi.unstubAllEnvs();
});

describe("remote MCP OAuth", () => {
  it("exchanges a single-use PKCE code and rotates refresh tokens", async () => {
    const access = store();
    const organizationId = `oauth-${randomUUID()}`;
    const user = await approvedUser(access, organizationId);
    const client = await access.registerOAuthClient({
      clientName: "Test MCP client",
      redirectUris: ["http://127.0.0.1:43110/callback"],
    });
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = await access.saveOAuthAuthorizationCode({
      clientId: client.clientId,
      organizationId,
      userId: user.principal.userId,
      redirectUri: client.redirectUris[0],
      codeChallenge: challenge,
      scope: "mcp",
      resource: "https://spur.example/mcp",
    });

    await expect(access.exchangeOAuthAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      codeVerifier: "x".repeat(64),
    })).rejects.toThrow(/invalid/);

    const first = await access.exchangeOAuthAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      codeVerifier: verifier,
    });
    await expect(access.exchangeOAuthAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      codeVerifier: verifier,
    })).rejects.toThrow(/invalid/);

    const authenticated = await access.authenticateMcpAccessToken(first.accessToken);
    expect(authenticated.principal).toMatchObject({ organizationId, userId: user.principal.userId });
    expect(authenticated.scopes).toContain("mcp");
    expect(authenticated.resource).toBe("https://spur.example/mcp");

    const second = await access.refreshOAuthToken({
      refreshToken: first.refreshToken,
      clientId: client.clientId,
    });
    await expect(access.authenticateMcpAccessToken(first.accessToken)).rejects.toThrow(/invalid/);
    await expect(access.authenticateMcpAccessToken(second.accessToken)).resolves.toMatchObject({ clientId: client.clientId });
    await expect(access.refreshOAuthToken({
      refreshToken: first.refreshToken,
      clientId: client.clientId,
    })).rejects.toThrow(/invalid/);
    // Reusing a rotated refresh token revokes the token issued from it.
    await expect(access.authenticateMcpAccessToken(second.accessToken)).rejects.toThrow(/invalid/);
    await expect(access.refreshOAuthToken({
      refreshToken: second.refreshToken,
      clientId: client.clientId,
    })).rejects.toThrow(/invalid/);
  });

  it("revokes a user's MCP tokens and enforces the per-user rate limit", async () => {
    const access = store();
    const organizationId = `oauth-revoke-${randomUUID()}`;
    const user = await approvedUser(access, organizationId);
    const client = await access.registerOAuthClient({
      clientName: "Revocation client",
      redirectUris: ["https://client.example/callback"],
    });
    const verifier = "z".repeat(64);
    const code = await access.saveOAuthAuthorizationCode({
      clientId: client.clientId,
      organizationId,
      userId: user.principal.userId,
      redirectUri: client.redirectUris[0],
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scope: "mcp",
      resource: "https://spur.example/mcp",
    });
    const tokens = await access.exchangeOAuthAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      codeVerifier: verifier,
    });

    await access.consumeMcpRateLimit(organizationId, user.principal.userId, 1);
    await expect(access.consumeMcpRateLimit(organizationId, user.principal.userId, 1))
      .rejects.toThrow(/rate limit/);
    await access.recordMcpToolCall({
      organizationId,
      userId: user.principal.userId,
      tool: "search_memory",
      argumentSummary: { keys: ["query"], byte_length: 32 },
      result: "success",
      durationMs: 12,
    });

    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
    try {
      const audit = await pool.query<{ details_json: { arguments: unknown; result: string } }>(
        "SELECT details_json FROM audit_log WHERE organization_id = $1 AND action = 'mcp.tool_called'",
        [organizationId],
      );
      expect(audit.rows[0].details_json).toMatchObject({
        arguments: { keys: ["query"], byte_length: 32 },
        result: "success",
      });
    } finally {
      await pool.end();
    }

    const administrator = await access.signInWithGoogle({
      organizationId,
      subject: randomUUID(),
      email: `admin-${randomUUID()}@example.com`,
      displayName: "Administrator",
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    });
    await access.revokeUser(organizationId, user.principal.userId, administrator.principal.userId);
    await expect(access.authenticateMcpAccessToken(tokens.accessToken)).rejects.toThrow(/invalid/);
  });

  it("requires the remote feature and accepts an organisation-scoped bearer token", async () => {
    const access = store();
    const organizationId = `oauth-route-${randomUUID()}`;
    const user = await approvedUser(access, organizationId);
    const client = await access.registerOAuthClient({
      clientName: "Route client",
      redirectUris: ["http://127.0.0.1:43110/callback"],
    });
    const verifier = "r".repeat(64);
    const code = await access.saveOAuthAuthorizationCode({
      clientId: client.clientId,
      organizationId,
      userId: user.principal.userId,
      redirectUri: client.redirectUris[0],
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scope: "mcp",
      resource: "http://localhost/mcp",
    });
    const tokens = await access.exchangeOAuthAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      codeVerifier: verifier,
    });
    const environment = {
      NODE_ENV: "test" as const,
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      SPUR_AUTH: "google",
      SPUR_GOOGLE_CLIENT_ID: "test-client",
      SPUR_GOOGLE_CLIENT_SECRET: "test-secret",
      SPUR_ORGANIZATION_SLUG: organizationId,
      SPUR_ORGANIZATION_NAME: "Remote MCP test",
      SPUR_REPOSITORY_ROOT: "./fixture-repo",
      SPUR_SYNTHESIS_PROVIDER: "none",
    };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const request = () => new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });

    expect((await remoteMcpPost(request())).status).toBe(403);
    await setFeature(organizationId, "remote_mcp", true, user.principal.userId, environment);
    const response = await remoteMcpPost(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("spur");
  });
});
