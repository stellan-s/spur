import { AccessStore, localPrincipal, requirePermission, type Principal } from "./access-store";
import { AuthenticationError, AuthorizationError } from "./errors";
import { loadInstanceConfig, resolveOrganizationConfig, tenancyMode, type SpurConfig } from "./config";
import { routeAccess, type Permission } from "./permissions";
import { publicOrigin } from "./public-url";

export const SESSION_COOKIE = "spur_session";

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function requestedOrganization(request: Request): string | undefined {
  return request.headers.get("x-spur-organization")?.trim() || undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Session cookies are SameSite=Lax, which still lets a sibling subdomain of a
// custom domain post to Spur. A state-changing request must come from Spur's
// own origin.
export function requireSameOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  const expected = publicOrigin(env) ?? new URL(request.url).origin;
  if (origin ? origin !== expected : request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AuthorizationError("This request did not come from Spur.", "origin_mismatch");
  }
}

export async function authenticateRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): Promise<{ config: SpurConfig; principal: Principal }> {
  requireSameOrigin(request, env);
  const organization = requestedOrganization(request);
  const config = tenancyMode(env) === "multi" && !organization
    ? loadInstanceConfig(env, projectRoot)
    : await resolveOrganizationConfig(organization, env, projectRoot);
  const token = cookie(request, SESSION_COOKIE);
  return { config, principal: await authenticateSessionToken(config, token) };
}

export async function authenticateSessionToken(
  config: SpurConfig,
  token: string | undefined,
): Promise<Principal> {
  if (config.authMode === "none") return localPrincipal(config.organization.slug, config.actorName, {
    restrictedRead: config.localRestrictedRead,
  });
  if (!token) throw new AuthenticationError("Sign in to continue.");
  const access = new AccessStore(config.databaseUrl);
  try {
    const principal = await access.authenticateSession(token, config.tenancy === "multi" ? config.organization.slug : undefined);
    if (principal.organizationId !== config.organization.slug) {
      throw new AuthorizationError("This session belongs to another organisation.", "organization_mismatch");
    }
    return principal;
  } finally {
    await access.close();
  }
}

export async function authenticateInstanceRequest(request: Request): Promise<{ config: SpurConfig; principal: Principal }> {
  requireSameOrigin(request);
  const config = loadInstanceConfig();
  return { config, principal: await authenticateSessionToken(config, sessionToken(request)) };
}

export async function authorizeApiRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): Promise<{ config: SpurConfig; principal: Principal }> {
  const access = routeAccess(request.method, new URL(request.url).pathname);
  if (access === "public") {
    throw new Error("Public routes must not call authorizeApiRequest.");
  }
  const authenticated = await authenticateRequest(request, env, projectRoot);
  authorizePrincipalForApiRequest(request, authenticated.principal);
  return authenticated;
}

export function authorizePrincipalForApiRequest(request: Request, principal: Principal): void {
  const access = routeAccess(request.method, new URL(request.url).pathname);
  if (access === "public") throw new Error("Public routes do not require a principal.");
  if (access === "authenticated") {
    if (principal.accessStatus === "pending") {
      throw new AuthorizationError("Your request is waiting for approval.", "access_pending");
    }
    if (principal.accessStatus === "rejected") {
      throw new AuthorizationError("Your access request was rejected.", "access_rejected");
    }
    if (principal.accessStatus === "revoked") {
      throw new AuthenticationError("This account has been revoked.", "account_revoked");
    }
    return;
  }
  requirePermission(principal, access);
}

export function requirePrincipalPermission(principal: Principal, permission: Permission): void {
  requirePermission(principal, permission);
}

export function sessionToken(request: Request): string | undefined {
  return cookie(request, SESSION_COOKIE);
}
