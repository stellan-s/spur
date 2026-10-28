import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import * as oidc from "openid-client";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listOrganisations } from "@/app/api/organizations/route";
import { GET as listManaged, POST as createOrganisation } from "@/app/api/instance/organizations/route";
import { PATCH as editOrganisation } from "@/app/api/instance/organizations/[slug]/route";
import { GET as getWorkspace } from "@/app/api/workspace/route";
import { GET as authorizeMcp, POST as consentMcp } from "@/app/oauth/authorize/route";
import { AccessStore, requirePermission } from "@/core/access-store";
import { authenticateRequest, authenticateSessionToken } from "@/core/auth";
import { loadConfig, loadInstanceConfig, resolveOrganizationConfig, tenancyMode } from "@/core/config";
import { features, setFeature } from "@/core/features";
import { beginGoogleSignIn, finishGoogleSignIn } from "@/core/google-auth";
import { decryptOrganizationSecret, encryptOrganizationSecret } from "@/core/organization-secrets";
import { OrganizationStore } from "@/core/organization-store";
import { PostgresMemoryStore } from "@/core/postgres-store";
import { createSpurService } from "@/core/spur-service";
import { createSpurMcpServer } from "@/mcp/server";

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

const key = randomBytes(32).toString("base64");
const administrator = { email: `instance-${randomUUID()}@example.com`, subject: randomUUID() };
let access: AccessStore;
let store: OrganizationStore;
let pool: Pool;
let admin: Awaited<ReturnType<AccessStore["signInWithGoogle"]>>;

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test", DATABASE_URL: process.env.TEST_DATABASE_URL!, SPUR_TENANCY: "multi",
    SPUR_AUTH: "google", SPUR_GOOGLE_CLIENT_ID: "multi-instance-client", SPUR_GOOGLE_CLIENT_SECRET: "instance-test-secret",
    SPUR_INSTANCE_ADMINS: administrator.email, SPUR_ENCRYPTION_KEY: key, SPUR_SYNTHESIS_PROVIDER: "none",
    SPUR_CODE_SEARCH: "off", SPUR_PUBLIC_URL: "http://localhost:3003", SPUR_ALLOWED_DOMAINS: "example.com",
    SPUR_ORGANIZATION_SLUG: "ignored-single-org", SPUR_REPOSITORY_ROOT: "/never-read-this-repository",
    SPUR_APPLICATION_NAME: "Instance default", SPUR_APPLICATION_ALIASES: "Default alias", SPUR_SECURITY_CONTACT: "Instance security",
    SPUR_GITHUB_APP_TOKEN: "instance-token-must-not-reach-a-tenant", SPUR_MCP_REDIRECT_HOSTS: "client.example",
  };
}

function request(path: string, token?: string, organisation?: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost:3003${path}`, {
    method, headers: {
      Origin: "http://localhost:3003", "Content-Type": "application/json",
      ...(token ? { Cookie: `spur_session=${token}` } : {}),
      ...(organisation ? { "x-spur-organization": organisation } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function identity() { return { email: `person-${randomUUID()}@example.com`, subject: randomUUID() }; }

async function signIn(person = identity(), organisation = "", bootstrap = false) {
  if (organisation) await access.ensureOrganization(organisation, "Ignored once managed");
  return access.signInWithGoogle({
    ...person, organizationId: organisation, displayName: "Test user",
    bootstrapAdmins: new Set(bootstrap ? [person.email] : []), sessionLifetimeSeconds: 3600,
  });
}

async function organisation(email = identity().email) {
  return store.create(admin.principal.userId, {
    slug: `tenant-${randomUUID()}`, name: "Northstar Commerce", first_admin_email: email,
  });
}

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  access = new AccessStore(process.env.TEST_DATABASE_URL!);
  store = new OrganizationStore(process.env.TEST_DATABASE_URL!, key);
  admin = await access.signInWithGoogle({
    ...administrator, organizationId: "", displayName: "Instance administrator",
    bootstrapAdmins: new Set(), instanceAdmins: new Set([administrator.email]), sessionLifetimeSeconds: 3600,
  });
});

beforeEach(() => {
  for (const [name, value] of Object.entries(environment())) vi.stubEnv(name, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
afterAll(async () => { await access.close(); await pool.end(); });

describe("standalone packaging", () => {
  it("publishes matching AGPL metadata without private", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
    expect(manifest.license).toBe("AGPL-3.0-only");
    expect(manifest.private).toBeUndefined();
    expect(lock.packages[""].license).toBe(manifest.license);
  });
});

describe("multi-organisation configuration and administration", () => {
  it("defaults to single mode and requires sign-in and explicit organisation selection in multi mode", async () => {
    expect(tenancyMode({ NODE_ENV: "test" })).toBe("single");
    expect(() => tenancyMode({ NODE_ENV: "test", SPUR_TENANCY: "invalid" })).toThrow("single");
    expect(() => loadConfig({ ...environment(), SPUR_AUTH: "none" })).toThrow("requires sign-in");
    expect(loadInstanceConfig(environment())).toMatchObject({ organization: { slug: "", name: "Spur" }, repositoryRoot: "", additionalRepositoryRoots: [] });
    await expect(resolveOrganizationConfig(undefined, environment())).rejects.toThrow("Choose an organisation");
    await expect(resolveOrganizationConfig(`missing-${randomUUID()}`, environment())).rejects.toThrow("not found");
    expect((await getWorkspace(request("/api/workspace", admin.token))).status).toBe(400);
  });

  it("uses database settings and starts with no repository or fabricated model", async () => {
    const org = await organisation();
    const saved = await store.update(admin.principal.userId, org.slug, {
      name: "Harbour Services", settings: {
        repositories: [], allowed_domains: ["harbour.example"], application_name: "Harbour Services",
        application_aliases: ["Harbour"], security_contact: "Harbour security",
      },
    });
    expect(saved.name).toBe("Harbour Services");
    const config = await resolveOrganizationConfig(org.slug, environment());
    expect(config).toMatchObject({
      organization: { name: "Harbour Services" }, repositoryRoot: "", bootstrapAdmins: [org.first_admin_email],
      allowedDomains: ["harbour.example"], securityContact: "Harbour security",
      applicationNaming: { canonicalName: "Harbour Services", aliases: ["Harbour"] },
    });
    expect(config.githubAppToken).toBeUndefined();
    expect(config.githubEnvironment?.SPUR_GITHUB_APP_TOKEN).toBeUndefined();
    const service = createSpurService(config);
    try {
      expect(await service.workspace()).toMatchObject({ memory: [], sources: [], repository: { ready: false }, mcp: { ready: false } });
      await expect(service.registerSource({ kind: "repository", name: "Forbidden", locator: "https://github.com/example/private", authentication: "bearer_env", credential_env: "SPUR_GOOGLE_CLIENT_SECRET" })).rejects.toThrow("organisation's stored");
    } finally { await service.close(); }
  });

  it("inherits instance defaults without reusing its bootstrap or repository credentials", async () => {
    const org = await organisation();
    const config = await resolveOrganizationConfig(org.slug, environment());
    expect(config.allowedDomains).toEqual(["example.com"]);
    expect(config.applicationNaming?.canonicalName).toBe("Instance default");
    expect(config.googleClientId).toBe("multi-instance-client");
    expect(config.securityContact).toBe("Instance security");
    expect(config.bootstrapSecurityOwners).toEqual([]);
    await access.ensureOrganization(org.slug, "Stale environment name");
    expect((await store.get(org.slug)).name).toBe(org.name);
  });

  it("only lets instance administrators create or edit organisations, and hides secrets in API responses", async () => {
    const person = identity();
    const org = await organisation(person.email);
    const orgAdmin = await signIn(person, org.slug, true);
    expect((await listManaged(request("/api/instance/organizations"))).status).toBe(401);
    expect((await listManaged(request("/api/instance/organizations", orgAdmin.token))).status).toBe(403);
    const input = { slug: `api-${randomUUID()}`, name: "Harbour Services", first_admin_email: "owner@harbour.example", secrets: { github_app_token: "private-api-credential" } };
    expect((await createOrganisation(request("/api/instance/organizations", orgAdmin.token, org.slug, "POST", input))).status).toBe(403);
    const created = await createOrganisation(request("/api/instance/organizations", admin.token, org.slug, "POST", input));
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("private-api-credential");
    expect(JSON.parse(text).organization.configured_secrets).toEqual(["github_app_token"]);
    const altered = await editOrganisation(request(`/api/instance/organizations/${input.slug}`, orgAdmin.token, org.slug, "PATCH", { name: "Hijack", settings: { repositories: [] } }), { params: Promise.resolve({ slug: input.slug }) });
    expect(altered.status).toBe(403);
    const crossSite = new Request("http://localhost:3003/api/instance/organizations", {
      method: "POST", headers: { Origin: "https://attacker.example", Cookie: `spur_session=${admin.token}` }, body: JSON.stringify(input),
    });
    expect((await createOrganisation(crossSite)).status).toBe(403);
    expect((await createOrganisation(request("/api/instance/organizations", admin.token, undefined, "POST", input))).status).toBe(400);
  });

  it("does not let a removed instance administrator regain access from the bootstrap environment", async () => {
    expect(admin.principal.instanceAdministrator).toBe(true);
    expect(admin.principal.permissions.size).toBe(0);
    await pool.query("DELETE FROM instance_administrators WHERE user_id = $1", [admin.principal.userId]);
    try {
      const again = await access.signInWithGoogle({ ...administrator, organizationId: "", displayName: "Admin", bootstrapAdmins: new Set(), instanceAdmins: new Set([administrator.email]), sessionLifetimeSeconds: 3600 });
      expect(again.principal.instanceAdministrator).toBe(false);
      await expect(store.listManaged(admin.principal.userId)).rejects.toThrow("Instance administrator");
    } finally {
      await pool.query("INSERT INTO instance_administrators (user_id) VALUES ($1)", [admin.principal.userId]);
    }
  });
});

describe("organisation credentials", () => {
  it("encrypts with a fresh nonce and binds ciphertext to its organisation and secret name", () => {
    const first = encryptOrganizationSecret("northstar", "oidc_client_secret", "test-secret", key);
    const second = encryptOrganizationSecret("northstar", "oidc_client_secret", "test-secret", key);
    expect(first).not.toBe(second);
    expect(first).not.toContain("test-secret");
    expect(decryptOrganizationSecret("northstar", "oidc_client_secret", first, key)).toBe("test-secret");
    expect(() => decryptOrganizationSecret("harbour", "oidc_client_secret", first, key)).toThrow("could not be decrypted");
    expect(() => decryptOrganizationSecret("northstar", "google_client_secret", first, key)).toThrow("could not be decrypted");
    expect(() => decryptOrganizationSecret("northstar", "oidc_client_secret", `${first.slice(0, -4)}AAAA`, key)).toThrow("could not be decrypted");
    expect(() => encryptOrganizationSecret("northstar", "oidc_client_secret", "value", undefined)).toThrow("SPUR_ENCRYPTION_KEY");
  });

  it("stores encrypted values, keeps omitted secrets, deletes explicit nulls, and rolls back missing-key writes", async () => {
    const org = await organisation();
    const updated = await store.update(admin.principal.userId, org.slug, { name: org.name, settings: org.settings, secrets: { oidc_client_secret: "only-in-encrypted-storage" } });
    expect(updated.configured_secrets).toEqual(["oidc_client_secret"]);
    const { rows } = await pool.query("SELECT ciphertext FROM organization_secrets WHERE organization_id = $1", [org.slug]);
    expect(rows[0].ciphertext).not.toContain("only-in-encrypted-storage");
    await store.update(admin.principal.userId, org.slug, { name: org.name, settings: org.settings });
    expect((await store.readSecrets(org.slug)).oidc_client_secret).toBe("only-in-encrypted-storage");
    await store.update(admin.principal.userId, org.slug, { name: org.name, settings: org.settings, secrets: { oidc_client_secret: null } });
    expect(await store.readSecrets(org.slug)).toEqual({});
    const broken = new OrganizationStore(process.env.TEST_DATABASE_URL!);
    const slug = `rollback-${randomUUID()}`;
    await expect(broken.create(admin.principal.userId, { slug, name: "Rolled back", first_admin_email: "owner@example.com", secrets: { oidc_client_secret: "secret" } })).rejects.toThrow("SPUR_ENCRYPTION_KEY");
    expect((await pool.query("SELECT id FROM organizations WHERE id = $1", [slug])).rowCount).toBe(0);
  });
});

describe("membership and sessions", () => {
  it("switches one session between approved memberships without widening access or exposing other organisations", async () => {
    const person = identity();
    const alpha = await organisation(person.email);
    const beta = await organisation(person.email);
    const hidden = await organisation();
    const session = await signIn(person, alpha.slug, true);
    await signIn(person, beta.slug, true);
    for (const slug of [alpha.slug, beta.slug]) {
      const { principal } = await authenticateRequest(request("/api/workspace", session.token, slug));
      expect(principal.organizationId).toBe(slug);
      expect(principal.permissions.has("users.manage")).toBe(true);
    }
    await expect(authenticateRequest(request("/api/workspace", session.token, hidden.slug))).rejects.toThrow();
    await expect(authenticateRequest(request("/api/workspace", admin.token, alpha.slug))).rejects.toThrow();
    expect((await listOrganisations(request("/api/organizations"))).status).toBe(401);
    const listed = await listOrganisations(request("/api/organizations", session.token));
    expect((await listed.json()).organizations.map((item: { slug: string }) => item.slug).sort()).toEqual([alpha.slug, beta.slug].sort());
    const memoryAlpha = new PostgresMemoryStore(process.env.TEST_DATABASE_URL!, alpha.slug, alpha.name, undefined, true);
    const memoryBeta = new PostgresMemoryStore(process.env.TEST_DATABASE_URL!, beta.slug, beta.name, undefined, true);
    try {
      const item = await memoryAlpha.upsertMemory({ kind: "entity", title: "Customer", statement: "Private to Northstar", state: "accepted", authority: "person", confidence: 1 });
      expect(await memoryBeta.getMemory(item.id)).toBeNull();
      const workspace = await getWorkspace(request("/api/workspace", session.token, beta.slug));
      expect(workspace.status).toBe(200);
      expect((await workspace.json()).memory).toEqual([]);
      await pool.query("UPDATE access_requests SET status = 'revoked' WHERE organization_id = $1 AND user_id = $2", [beta.slug, session.principal.userId]);
      const revoked = await authenticateSessionToken(await resolveOrganizationConfig(beta.slug), session.token);
      expect(() => requirePermission(revoked, "memory.read")).toThrow();
      expect((await getWorkspace(request("/api/workspace", session.token, beta.slug))).status).toBe(401);
      expect((await authenticateSessionToken(await resolveOrganizationConfig(alpha.slug), session.token)).permissions.has("memory.read")).toBe(true);
    } finally { await memoryAlpha.close(); await memoryBeta.close(); }
  });

  it("boots the invited administrator only after verified Google sign-in using that organisation's credentials", async () => {
    const person = identity();
    const org = await organisation(person.email);
    await store.update(admin.principal.userId, org.slug, { name: org.name, settings: { repositories: [], google_client_id: "tenant-google-client", allowed_domains: ["different.example"] }, secrets: { google_client_secret: "tenant-google-secret" } });
    const config = await resolveOrganizationConfig(org.slug);
    const start = await beginGoogleSignIn(config, new URL("http://localhost:3003/api/auth/google"));
    expect(start.url.searchParams.get("client_id")).toBe("tenant-google-client");
    const callback = () => new Request(`http://localhost:3003/api/auth/google/callback?state=${start.state}&code=test`);
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue({ claims: () => ({ sub: person.subject, email: person.email, email_verified: true }) } as unknown as Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>);
    const result = await finishGoogleSignIn(loadInstanceConfig(), callback(), start.state);
    expect(result).toMatchObject({ organizationId: org.slug, accessStatus: "approved" });
    expect((await authenticateSessionToken(config, result.token)).permissions.has("users.manage")).toBe(true);
    await expect(finishGoogleSignIn(loadInstanceConfig(), callback(), start.state)).rejects.toThrow("expired");
    const unverified = await beginGoogleSignIn(loadInstanceConfig(), new URL("http://localhost:3003/api/auth/google"));
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue({ claims: () => ({ sub: "other", email: "not-verified@example.com", email_verified: false }) } as unknown as Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>);
    await expect(finishGoogleSignIn(loadInstanceConfig(), new Request(`http://localhost:3003/api/auth/google/callback?state=${unverified.state}&code=test`), unverified.state)).rejects.toThrow("verified email");
  });
});

describe("multi-organisation MCP", () => {
  it("requires authenticated remote connections and keeps feature settings independent", async () => {
    await expect(createSpurMcpServer()).rejects.toThrow("authenticated remote connection");
    const person = identity();
    const alpha = await organisation(person.email);
    const beta = await organisation(person.email);
    const member = await signIn(person, alpha.slug, true);
    await setFeature(alpha.slug, "ask", false, member.principal.userId);
    expect((await features(alpha.slug)).ask).toBe(false);
    expect((await features(beta.slug)).ask).toBe(true);
    const server = await createSpurMcpServer({ principal: member.principal, remote: true });
    try {
      const inspectable = server as unknown as { _registeredTools: Record<string, { enabled: boolean; handler: (input: unknown) => Promise<{ structuredContent: unknown }> }> };
      expect(inspectable._registeredTools.investigate.enabled).toBe(false);
      expect((await inspectable._registeredTools.search_memory.handler({ query: "Customer", limit: 10 })).structuredContent).toEqual({ items: [] });
    } finally { await server.close(); }
  });

  it("offers only memberships for consent and binds the resulting token to the selected organisation", async () => {
    const person = identity();
    const org = await organisation(person.email);
    const hidden = await organisation();
    const member = await signIn(person, org.slug, true);
    await setFeature(org.slug, "remote_mcp", true, member.principal.userId);
    const client = await access.registerOAuthClient({ clientName: "Test client", redirectUris: ["https://client.example/callback"] });
    const verifier = "v".repeat(64);
    const values = new URLSearchParams({ response_type: "code", client_id: client.clientId, redirect_uri: client.redirectUris[0], code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "mcp", resource: "http://localhost:3003/mcp", state: "test-state" });
    const chooser = await authorizeMcp(request(`/oauth/authorize?${values}`, member.token));
    expect(chooser.status).toBe(200);
    const html = await chooser.text();
    expect(html).toContain(`value="${org.slug}"`);
    expect(html).not.toContain(hidden.slug);
    values.set("organization", org.slug);
    values.set("decision", "allow");
    const consent = await consentMcp(new Request("http://localhost:3003/oauth/authorize", { method: "POST", headers: { Cookie: `spur_session=${member.token}`, Origin: "http://localhost:3003", "Content-Type": "application/x-www-form-urlencoded" }, body: values.toString() }));
    expect(consent.status).toBe(302);
    const code = new URL(consent.headers.get("location")!).searchParams.get("code")!;
    const tokens = await access.exchangeOAuthAuthorizationCode({ code, clientId: client.clientId, redirectUri: client.redirectUris[0], codeVerifier: verifier });
    expect((await access.authenticateMcpAccessToken(tokens.accessToken)).principal.organizationId).toBe(org.slug);
    values.set("organization", hidden.slug);
    expect((await authorizeMcp(request(`/oauth/authorize?${values}`, member.token))).status).not.toBe(200);
  });
});
