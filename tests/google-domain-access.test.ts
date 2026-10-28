import { randomUUID } from "node:crypto";

import * as oidc from "openid-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessStore } from "@/core/access-store";
import { loadConfig, type SpurConfig } from "@/core/config";
import { beginGoogleSignIn, finishGoogleSignIn } from "@/core/google-auth";

vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return {
    ...actual,
    discovery: vi.fn(async (_issuer, clientId, secret) => new actual.Configuration({
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
    }, clientId, secret)),
    authorizationCodeGrant: vi.fn(),
  };
});

const stores: AccessStore[] = [];

async function setup(bootstrapEmail?: string) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    SPUR_AUTH: "google",
    SPUR_GOOGLE_CLIENT_ID: `client-${randomUUID()}`,
    SPUR_GOOGLE_CLIENT_SECRET: "test-secret",
    SPUR_ALLOWED_DOMAINS: "northstar.example",
    SPUR_BOOTSTRAP_ADMINS: bootstrapEmail,
    SPUR_ORGANIZATION_SLUG: `domains-${randomUUID()}`,
  });
  const access = new AccessStore(config.databaseUrl);
  stores.push(access);
  await access.ensureOrganization(config.organization.slug, config.organization.name);
  return { config, access };
}

function identity(domain = "gmail.com") {
  const id = randomUUID();
  return { sub: `google-${id}`, email: `person-${id}@${domain}`, email_verified: true };
}

async function signIn(config: SpurConfig, claims: Record<string, unknown>) {
  const start = await beginGoogleSignIn(config, new URL("http://localhost:3003/api/auth/google"));
  vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
    claims: () => claims,
  } as Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>);
  const callback = new URL("http://localhost:3003/api/auth/google/callback");
  callback.searchParams.set("state", start.state);
  callback.searchParams.set("code", "test-code");
  return finishGoogleSignIn(config, new Request(callback), start.state);
}

async function provision(access: AccessStore, config: SpurConfig, email: string) {
  return access.provisionAdministrator({
    organizationId: config.organization.slug,
    organizationName: config.organization.name,
    email,
  });
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((access) => access.close()));
  vi.clearAllMocks();
});

describe("Google sign-in domain policy", () => {
  it("lets personal accounts reach sign-in without weakening the identity checks", async () => {
    const { config } = await setup();
    const start = await beginGoogleSignIn(config, new URL("http://localhost:3003/api/auth/google"));
    expect(start.url.searchParams.has("hd")).toBe(false);
    expect(start.url.searchParams.get("prompt")).toBe("select_account");
    expect(start.url.searchParams.get("state")).toBe(start.state);
    expect(start.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.url.searchParams.get("nonce")).toBeTruthy();
    await expect(finishGoogleSignIn(config, new Request(`http://localhost:3003/api/auth/google/callback?state=${start.state}`), "wrong-browser"))
      .rejects.toMatchObject({ code: "oidc_state_invalid" });
    expect(oidc.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it("allows an approved, pre-provisioned Gmail administrator", async () => {
    const owner = identity();
    const { config, access } = await setup();
    const administrator = await provision(access, config, owner.email);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await signIn(config, owner);
      expect(result.accessStatus).toBe("approved");
      const principal = await access.authenticateSession(result.token);
      expect(principal.userId).toBe(administrator.userId);
      expect(principal.permissions.has("users.manage")).toBe(true);
      expect(principal.permissions.has("restricted.read")).toBe(false);
    }
  });

  it("allows the exact configured Gmail address to bootstrap the first administrator", async () => {
    const owner = identity();
    const { config, access } = await setup(owner.email.toUpperCase());
    const result = await signIn(config, { ...owner, email: owner.email.toUpperCase() });
    expect(result.accessStatus).toBe("approved");
    expect((await access.authenticateSession(result.token)).permissions.has("users.manage")).toBe(true);
    expect((await signIn(config, owner)).accessStatus).toBe("approved");
  });

  it("rejects an ordinary Gmail account without creating a user, request or session", async () => {
    const { config, access } = await setup();
    const person = identity();
    await expect(signIn(config, person)).rejects.toMatchObject({ code: "domain_not_allowed" });
    expect(await access.listAccessRequests(config.organization.slug)).toEqual([]);
    // A different Google subject can still be linked: the denied user was rolled back.
    await provision(access, config, person.email);
    expect((await signIn(config, { ...person, sub: `other-${randomUUID()}` })).accessStatus).toBe("approved");
  });

  it("does not treat the bootstrap list as an ongoing allowlist", async () => {
    const listed = identity();
    const { config, access } = await setup(listed.email);
    await provision(access, config, identity("northstar.example").email);
    await expect(signIn(config, listed)).rejects.toMatchObject({ code: "domain_not_allowed" });
    expect(await access.listAccessRequests(config.organization.slug)).toHaveLength(1);
  });

  it("still requires approval for an ordinary Workspace user", async () => {
    const { config, access } = await setup();
    const result = await signIn(config, { ...identity("northstar.example"), hd: "northstar.example" });
    expect(result.accessStatus).toBe("pending");
    expect((await access.authenticateSession(result.token)).permissions.size).toBe(0);
  });

  it.each([
    { domain: "northstar.example", hd: undefined },
    { domain: "northstar.example", hd: "other.example" },
    { domain: "gmail.com", hd: "northstar.example" },
    { domain: "northstar.example.attacker.example", hd: "northstar.example" },
  ])("rejects ordinary accounts with email domain $domain and hosted domain $hd", async ({ domain, hd }) => {
    const { config } = await setup();
    await expect(signIn(config, { ...identity(domain), hd })).rejects.toMatchObject({ code: "domain_not_allowed" });
  });

  it("requires a verified email even for a provisioned administrator", async () => {
    const person = identity();
    const { config, access } = await setup(person.email);
    await provision(access, config, person.email);
    await expect(signIn(config, { ...person, email_verified: false })).rejects.toMatchObject({ code: "email_not_verified" });
  });

  it("does not transfer an administrator exception between organisations", async () => {
    const person = identity();
    const { config, access } = await setup();
    const other = await setup();
    await provision(access, config, person.email);
    await signIn(config, person);
    await expect(signIn(other.config, person)).rejects.toMatchObject({ code: "domain_not_allowed" });
  });

  it("rejects a revoked administrator even when the bootstrap list still contains their email", async () => {
    const person = identity();
    const { config, access } = await setup(person.email);
    const administrator = await provision(access, config, person.email);
    const other = await provision(access, config, identity("northstar.example").email);
    const result = await signIn(config, person);
    await access.revokeUser(config.organization.slug, administrator.userId, other.userId);
    await expect(signIn(config, person)).rejects.toMatchObject({ code: "account_revoked" });
    await expect(access.authenticateSession(result.token)).rejects.toThrow();
  });

  it("removes the exception after demotion without restoring it from bootstrap configuration", async () => {
    const person = identity();
    const { config, access } = await setup(person.email);
    const administrator = await provision(access, config, person.email);
    const other = await provision(access, config, identity("northstar.example").email);
    await signIn(config, person);
    await access.setUserRoles({
      organizationId: config.organization.slug,
      userId: administrator.userId,
      roleIds: ["reader"],
      actorUserId: other.userId,
    });
    await expect(signIn(config, person)).rejects.toMatchObject({ code: "domain_not_allowed" });
  });

  it("does not let another Google subject take over an administrator's email", async () => {
    const person = identity();
    const { config, access } = await setup();
    await provision(access, config, person.email);
    await signIn(config, person);
    await expect(signIn(config, { ...person, sub: `attacker-${randomUUID()}` })).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("keeps unrestricted-domain deployments approval-based", async () => {
    const { config } = await setup();
    expect((await signIn({ ...config, allowedDomains: [] }, identity())).accessStatus).toBe("pending");
  });
});
