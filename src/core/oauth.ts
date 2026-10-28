import { z } from "zod";

import { AccessStore, requirePermission, type Principal } from "./access-store";
import { authenticateSessionToken, sessionToken } from "./auth";
import { resolveOrganizationConfig, type SpurConfig } from "./config";
import { ConfigurationError, InputError } from "./errors";
import { features, requireFeature, type OrganizationFeatures } from "./features";

export const MCP_SCOPE = "mcp";

export const oauthClientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).default("MCP client"),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export function mcpResource(requestUrl: URL): string {
  return new URL("/mcp", requestUrl.origin).href;
}

export function protectedResourceMetadataUrl(requestUrl: URL): string {
  return new URL("/.well-known/oauth-protected-resource", requestUrl.origin).href;
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// Hosts that may receive authorisation codes. Open registration otherwise lets
// anyone register a lookalike client that sends a user's code to their server.
export function allowedRedirectHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.SPUR_MCP_REDIRECT_HOSTS?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : ["claude.ai", "claude.com"];
}

export function validRedirectUri(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (LOOPBACK_HOSTS.includes(url.hostname)) return url.protocol === "http:" || url.protocol === "https:";
    return url.protocol === "https:" && allowedRedirectHosts(env).includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function bearerChallenge(requestUrl: URL, error?: string): Response {
  const parts = [`Bearer resource_metadata="${protectedResourceMetadataUrl(requestUrl)}"`];
  if (error) parts.push(`error="${error}"`);
  return Response.json({ error: error ?? "invalid_token" }, {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": parts.join(", "),
    },
  });
}

export async function authorizeMcpUser(
  request: Request,
  organization: string | undefined,
): Promise<{ config: SpurConfig; principal: Principal; featureValues: OrganizationFeatures }> {
  const config = await resolveOrganizationConfig(organization);
  if (config.authMode === "none") {
    throw new ConfigurationError("Remote MCP requires sign-in.", "remote_auth_required");
  }
  const principal = await authenticateSessionToken(config, sessionToken(request));
  const featureValues = await features(config.organization.slug);
  requireFeature(featureValues, "remote_mcp");
  requirePermission(principal, "mcp.connect");
  return { config, principal, featureValues };
}

export type OAuthAuthorizationRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state?: string;
  resource: string;
  organization?: string;
};

export function parseAuthorizationRequest(values: URLSearchParams): OAuthAuthorizationRequest {
  const get = (name: string) => {
    const value = values.get(name)?.trim() ?? "";
    if (value.length > 2_000) throw new InputError(`${name} is too long.`);
    return value;
  };
  const result = {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    scope: get("scope"),
    state: get("state") || undefined,
    resource: get("resource"),
    organization: get("organization") || undefined,
  };
  if (!result.clientId || !result.redirectUri) throw new InputError("client_id and redirect_uri are required.");
  if (result.responseType !== "code") throw new InputError("response_type must be code.");
  if (result.codeChallengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(result.codeChallenge)) {
    throw new InputError("PKCE with code_challenge_method S256 is required.");
  }
  const scopes = [...new Set(result.scope.split(/\s+/).filter(Boolean))];
  if (scopes.length !== 1 || scopes[0] !== MCP_SCOPE) throw new InputError("The mcp scope is required.");
  return result;
}

export async function validateAuthorizationRequest(
  input: OAuthAuthorizationRequest,
  requestUrl: URL,
  access: AccessStore,
): Promise<void> {
  const client = await access.getOAuthClient(input.clientId);
  if (!client || !client.redirectUris.includes(input.redirectUri) || !validRedirectUri(input.redirectUri)) {
    throw new InputError("The OAuth client or redirect URI is invalid.");
  }
  if (input.resource !== mcpResource(requestUrl)) throw new InputError("The OAuth resource is invalid.");
}

export function appendOAuthResult(redirectUri: string, values: Record<string, string | undefined>): URL {
  const target = new URL(redirectUri);
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) target.searchParams.set(name, value);
  }
  return target;
}

export function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
