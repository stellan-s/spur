import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { AccessStore } from "@/core/access-store";
import { requireSameOrigin } from "@/core/auth";
import { loadConfig } from "@/core/config";
import { validRedirectUri } from "@/core/oauth";
import { publicRequestUrl, safeReturnPath } from "@/core/public-url";
import { rateLimited, resetRequestLimits } from "@/core/request-limit";

const stores: AccessStore[] = [];

function store(): AccessStore {
  const access = new AccessStore(process.env.TEST_DATABASE_URL!);
  stores.push(access);
  return access;
}

function identity(prefix: string) {
  const suffix = randomUUID();
  return { subject: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.com`, displayName: prefix };
}

async function organisationWithAdministrator(access: AccessStore) {
  const organizationId = `hardening-${randomUUID()}`;
  await access.ensureOrganization(organizationId, "Hardening test");
  const adminIdentity = identity("admin");
  const admin = await access.signInWithGoogle({
    organizationId,
    ...adminIdentity,
    bootstrapAdmins: new Set([adminIdentity.email]),
    sessionLifetimeSeconds: 3_600,
  });
  return { organizationId, admin, adminIdentity };
}

async function approvedReader(access: AccessStore, organizationId: string, actorUserId: string) {
  const person = await access.signInWithGoogle({
    organizationId,
    ...identity("reader"),
    bootstrapAdmins: new Set(),
    sessionLifetimeSeconds: 3_600,
  });
  const request = (await access.listAccessRequests(organizationId))
    .find((item) => item.user_id === person.principal.userId)!;
  return { person, request, approve: (roleIds: string[]) => access.decideAccessRequest({
    organizationId, requestId: request.id, decision: "approved", roleIds, actorUserId,
  }) };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((access) => access.close()));
  resetRequestLimits();
});

describe("public deployment hardening", () => {
  it("returns only same-site paths after sign-in", () => {
    expect(safeReturnPath("/o/acme/ask?q=1")).toBe("/o/acme/ask?q=1");
    for (const value of ["//evil.example/x", "/a/..//evil.example/login", "/\\evil.example", "https://evil.example", "", null]) {
      expect(safeReturnPath(value)).toBeUndefined();
    }
  });

  it("accepts MCP redirects only for approved hosts and loopback", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback", { NODE_ENV: "test" })).toBe(true);
    expect(validRedirectUri("http://localhost:33418/callback", { NODE_ENV: "test" })).toBe(true);
    expect(validRedirectUri("https://evil.example/cb", { NODE_ENV: "test" })).toBe(false);
    expect(validRedirectUri("https://evil.example/cb", { NODE_ENV: "test", SPUR_MCP_REDIRECT_HOSTS: "evil.example" })).toBe(true);
  });

  it("refuses state-changing requests from another origin", () => {
    const env = { NODE_ENV: "test" as const, SPUR_PUBLIC_URL: "https://spur.example" };
    const post = (headers: Record<string, string>) =>
      new Request("http://0.0.0.0:3000/api/memory", { method: "POST", headers });
    expect(() => requireSameOrigin(post({ origin: "https://spur.example" }), env)).not.toThrow();
    expect(() => requireSameOrigin(post({ origin: "https://other.example" }), env)).toThrow(/did not come from Spur/);
    expect(() => requireSameOrigin(post({ "sec-fetch-site": "cross-site" }), env)).toThrow();
    expect(() => requireSameOrigin(new Request("http://0.0.0.0:3000/api/memory", {
      headers: { origin: "https://other.example" },
    }), env)).not.toThrow();
    expect(publicRequestUrl(post({}), env).href).toBe("https://spur.example/api/memory");
  });

  it("fails closed without SPUR_AUTH in production and refuses local mode on Cloud Run", () => {
    const base = { SPUR_ORGANIZATION_SLUG: "northstar", SPUR_REPOSITORY_ROOT: "./fixture-repo" };
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/SPUR_GOOGLE_CLIENT_ID/);
    expect(() => loadConfig({ ...base, NODE_ENV: "test", K_SERVICE: "spur", SPUR_AUTH: "none" }))
      .toThrow(/Cloud Run/);
  });

  it("limits sign-in requests per client address", () => {
    const request = new Request("http://localhost/api/auth/google", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
    });
    for (let index = 0; index < 30; index += 1) expect(rateLimited(request, "sign_in")).toBeUndefined();
    expect(rateLimited(request, "sign_in")?.status).toBe(429);
    expect(rateLimited(new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    }), "sign_in")).toBeUndefined();
  });

  it("lets only a security owner grant restricted access", async () => {
    const access = store();
    const { organizationId, admin } = await organisationWithAdministrator(access);
    const first = await approvedReader(access, organizationId, admin.principal.userId);
    await expect(first.approve(["security-owner"])).rejects.toThrow(/security owner/);
    await first.approve(["reader"]);
    await expect(access.setUserPermission({
      organizationId, userId: first.person.principal.userId, permission: "restricted.read",
      granted: true, actorUserId: admin.principal.userId,
    })).rejects.toThrow(/security owner/);
    await expect(access.setUserRoles({
      organizationId, userId: first.person.principal.userId, roleIds: ["reader", "security-owner"],
      actorUserId: admin.principal.userId,
    })).rejects.toThrow(/security owner/);
    await expect(access.setUserPermission({
      organizationId, userId: admin.principal.userId, permission: "restricted.read",
      granted: true, actorUserId: admin.principal.userId,
    })).rejects.toThrow(/your own/);
    await expect(access.setUserRoles({
      organizationId, userId: admin.principal.userId, roleIds: ["administrator", "security-owner"],
      actorUserId: admin.principal.userId,
    })).rejects.toThrow(/your own/);
  });

  it("bootstraps the first security owner from configuration only", async () => {
    const access = store();
    const organizationId = `owner-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "Security owner test");
    const owner = identity("owner");
    const first = await access.signInWithGoogle({
      organizationId,
      ...owner,
      bootstrapAdmins: new Set([owner.email]),
      bootstrapSecurityOwners: new Set([owner.email]),
      sessionLifetimeSeconds: 3_600,
    });
    expect(first.principal.permissions.has("restricted.read")).toBe(true);
    const listed = identity("listed");
    const pending = await access.signInWithGoogle({
      organizationId,
      ...listed,
      bootstrapAdmins: new Set(),
      bootstrapSecurityOwners: new Set([listed.email]),
      sessionLifetimeSeconds: 3_600,
    });
    expect(pending.principal.permissions.has("restricted.read")).toBe(false);
  });

  it("bootstraps only the first administrator", async () => {
    const access = store();
    const { organizationId } = await organisationWithAdministrator(access);
    const listed = identity("listed");
    const second = await access.signInWithGoogle({
      organizationId,
      ...listed,
      bootstrapAdmins: new Set([listed.email]),
      sessionLifetimeSeconds: 3_600,
    });
    expect(second.principal.accessStatus).toBe("pending");
  });

  it("does not let a second Google account take over an existing email", async () => {
    const access = store();
    const { organizationId, adminIdentity } = await organisationWithAdministrator(access);
    await expect(access.signInWithGoogle({
      organizationId,
      ...adminIdentity,
      subject: `other-${randomUUID()}`,
      bootstrapAdmins: new Set([adminIdentity.email]),
      sessionLifetimeSeconds: 3_600,
    })).rejects.toThrow(/conflicts/);
  });
});
