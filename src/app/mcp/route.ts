import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";

import { AccessStore, requirePermission } from "@/core/access-store";
import { loadInstanceConfig } from "@/core/config";
import { SpurError } from "@/core/errors";
import { features, requireFeature } from "@/core/features";
import { bearerChallenge, MCP_SCOPE, mcpResource, protectedResourceMetadataUrl } from "@/core/oauth";
import { createSpurMcpServer } from "@/mcp/server";
import { publicRequestUrl } from "@/core/public-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(async ({ authInfo }) => {
  if (!authInfo) throw new Error("MCP authentication context is missing.");
  const config = loadInstanceConfig();
  const access = new AccessStore(config.databaseUrl);
  try {
    const authenticated = await access.authenticateMcpAccessToken(authInfo.token);
    const featureValues = await features(authenticated.principal.organizationId);
    requireFeature(featureValues, "remote_mcp");
    requirePermission(authenticated.principal, "mcp.connect");
    return createSpurMcpServer({
      principal: authenticated.principal,
      features: featureValues,
      remote: true,
    });
  } finally {
    await access.close();
  }
}, { legacy: "stateless" });

function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1]?.trim();
}

async function serve(request: Request): Promise<Response> {
  const requestUrl = publicRequestUrl(request);
  const token = bearerToken(request);
  if (!token) return bearerChallenge(requestUrl);
  const config = loadInstanceConfig();
  const access = new AccessStore(config.databaseUrl);
  try {
    const authenticated = await access.authenticateMcpAccessToken(token);
    if (authenticated.resource !== mcpResource(requestUrl)) return bearerChallenge(requestUrl, "invalid_token");
    if (!authenticated.scopes.includes(MCP_SCOPE)) return bearerChallenge(requestUrl, "insufficient_scope");
    const featureValues = await features(authenticated.principal.organizationId);
    requireFeature(featureValues, "remote_mcp");
    requirePermission(authenticated.principal, "mcp.connect");
    const authInfo: AuthInfo = {
      token,
      clientId: authenticated.clientId,
      scopes: authenticated.scopes,
      expiresAt: Math.floor(authenticated.expiresAt.getTime() / 1_000),
      resource: new URL(authenticated.resource),
      resourceMetadataUrl: protectedResourceMetadataUrl(requestUrl),
    };
    return handler.fetch(request, { authInfo });
  } catch (error) {
    if (error instanceof SpurError) {
      if (error.status === 401) return bearerChallenge(requestUrl, "invalid_token");
      return Response.json({ error: error.code, error_description: error.message }, {
        status: error.status,
        headers: error.status === 403 ? {
          "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_SCOPE}", resource_metadata="${protectedResourceMetadataUrl(requestUrl)}"`,
        } : undefined,
      });
    }
    return Response.json({ error: "server_error" }, { status: 500 });
  } finally {
    await access.close();
  }
}

export async function GET(request: Request) {
  return serve(request);
}

export async function POST(request: Request) {
  return serve(request);
}

export async function DELETE(request: Request) {
  return serve(request);
}
