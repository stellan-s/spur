import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { AccessStore } from "@/core/access-store";
import { authorizeApiRequest, SESSION_COOKIE } from "@/core/auth";

const stores: AccessStore[] = [];

function store(): AccessStore {
  const access = new AccessStore(process.env.TEST_DATABASE_URL!);
  stores.push(access);
  return access;
}

function identity(prefix: string) {
  const suffix = randomUUID();
  return {
    subject: `${prefix}-${suffix}`,
    email: `${prefix}-${suffix}@example.com`,
    displayName: prefix,
  };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((access) => access.close()));
});

describe("organisation access control", () => {
  it("uses an email code once and records failed attempts", async () => {
    const access = store();
    const organizationId = `otp-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "OTP organisation");
    const email = `otp-${randomUUID()}@example.com`;
    const challenge = await access.createLoginOtpChallenge({
      organizationId,
      email,
      returnTo: `/o/${organizationId}/model`,
      lifetimeSeconds: 600,
    });

    const wrongCode = challenge.code === "000000" ? "999999" : "000000";
    await expect(access.consumeLoginOtpChallenge(challenge.token, wrongCode))
      .rejects.toThrow("Invalid code");
    await expect(access.consumeLoginOtpChallenge(challenge.token, challenge.code))
      .resolves.toEqual({ organizationId, email, returnTo: `/o/${organizationId}/model` });
    await expect(access.consumeLoginOtpChallenge(challenge.token, challenge.code))
      .rejects.toThrow(/expired/);
  });

  it("locks an email code after five failed attempts", async () => {
    const access = store();
    const organizationId = `otp-lock-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "OTP lock organisation");
    const challenge = await access.createLoginOtpChallenge({
      organizationId,
      email: `otp-lock-${randomUUID()}@example.com`,
      lifetimeSeconds: 600,
    });
    const wrongCode = challenge.code === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(access.consumeLoginOtpChallenge(challenge.token, wrongCode))
        .rejects.toThrow("Invalid code");
    }
    await expect(access.consumeLoginOtpChallenge(challenge.token, wrongCode))
      .rejects.toThrow(/Too many failed attempts/);
    await expect(access.consumeLoginOtpChallenge(challenge.token, challenge.code))
      .rejects.toThrow(/expired|Too many failed attempts/);
  });

  it("signs an email-code user into the existing approval workflow", async () => {
    const access = store();
    const organizationId = `otp-access-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "OTP access organisation");
    const email = `otp-admin-${randomUUID()}@example.com`;
    const result = await access.signInWithEmailOtp({
      organizationId,
      email,
      bootstrapAdmins: new Set([email]),
      sessionLifetimeSeconds: 3_600,
    });
    expect(result.principal).toMatchObject({ email, accessStatus: "approved" });
    expect(result.principal.permissions.has("users.manage")).toBe(true);
    await expect(access.authenticateSession(result.token)).resolves.toMatchObject({
      email,
      organizationId,
    });
  });

  it("provisions an administrator who is linked on first Google sign-in", async () => {
    const access = store();
    const organizationId = `provision-${randomUUID()}`;
    const email = `owner-${randomUUID()}@example.com`;
    const provisioned = await access.provisionAdministrator({
      organizationId,
      organizationName: "Provisioned organisation",
      email,
      displayName: "Provisioned owner",
    });
    expect(provisioned.permissions.has("users.manage")).toBe(true);
    expect(provisioned.permissions.has("restricted.read")).toBe(false);

    const signedIn = await access.signInWithGoogle({
      organizationId,
      subject: `google-${randomUUID()}`,
      email,
      displayName: "Google owner",
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    });
    expect(signedIn.requestCreated).toBe(false);
    expect(signedIn.principal).toMatchObject({
      userId: provisioned.userId,
      accessStatus: "approved",
      email,
    });
    expect(signedIn.principal.permissions.has("users.manage")).toBe(true);
  });

  it("creates a permissionless request on first sign-in", async () => {
    const access = store();
    const organizationId = `pending-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "Pending organisation");
    const result = await access.signInWithGoogle({
      organizationId,
      ...identity("pending"),
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    });

    expect(result.requestCreated).toBe(true);
    expect(result.principal.accessStatus).toBe("pending");
    expect([...result.principal.permissions]).toEqual([]);
    await expect(access.authenticateSession(result.token)).resolves.toMatchObject({
      accessStatus: "pending",
      organizationId,
    });
  });

  it("grants exactly a custom role plus explicit user overrides", async () => {
    const access = store();
    const organizationId = `roles-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "Roles organisation");
    const adminIdentity = identity("admin");
    const admin = await access.signInWithGoogle({
      organizationId,
      ...adminIdentity,
      bootstrapAdmins: new Set([adminIdentity.email]),
      sessionLifetimeSeconds: 3_600,
    });
    expect(admin.principal.permissions.has("users.manage")).toBe(true);
    expect(admin.principal.permissions.has("restricted.read")).toBe(false);

    const role = await access.saveCustomRole({
      organizationId,
      name: "Memory lookup",
      description: "Can locate stored memory only.",
      permissions: ["memory.read"],
      actorUserId: admin.principal.userId,
    });
    const person = await access.signInWithGoogle({
      organizationId,
      ...identity("person"),
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    });
    const request = (await access.listAccessRequests(organizationId))
      .find((item) => item.user_id === person.principal.userId)!;
    await access.decideAccessRequest({
      organizationId,
      requestId: request.id,
      decision: "approved",
      roleIds: [role.id],
      actorUserId: admin.principal.userId,
    });

    let principal = await access.authenticateSession(person.token);
    expect([...principal.permissions]).toEqual(["memory.read"]);
    const authEnvironment = {
      NODE_ENV: "test" as const,
      SPUR_AUTH: "google",
      SPUR_GOOGLE_CLIENT_ID: "test-client",
      SPUR_GOOGLE_CLIENT_SECRET: "test-secret",
      SPUR_ORGANIZATION_SLUG: organizationId,
      SPUR_ORGANIZATION_NAME: "Roles organisation",
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
    };
    await expect(authorizeApiRequest(new Request("http://localhost/api/workspace", {
      headers: { cookie: `${SESSION_COOKIE}=${person.token}`, "x-spur-organization": organizationId },
    }), authEnvironment)).resolves.toMatchObject({ principal: { userId: principal.userId } });
    await expect(authorizeApiRequest(new Request("http://localhost/api/investigate", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${person.token}`, "x-spur-organization": organizationId },
    }), authEnvironment)).rejects.toThrow(/permission/);
    await access.setUserPermission({
      organizationId,
      userId: principal.userId,
      permission: "memory.ask",
      granted: true,
      actorUserId: admin.principal.userId,
    });
    principal = await access.authenticateSession(person.token);
    expect(principal.permissions).toEqual(new Set(["memory.read", "memory.ask"]));
    await expect(authorizeApiRequest(new Request("http://localhost/api/investigate", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${person.token}`, "x-spur-organization": organizationId },
    }), authEnvironment)).resolves.toMatchObject({ principal: { userId: principal.userId } });
    await access.setUserPermission({
      organizationId,
      userId: principal.userId,
      permission: "memory.read",
      granted: false,
      actorUserId: admin.principal.userId,
    });
    principal = await access.authenticateSession(person.token);
    expect([...principal.permissions]).toEqual(["memory.ask"]);

    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
    try {
      const audit = await pool.query<{ action: string }>(
        "SELECT action FROM audit_log WHERE organization_id = $1",
        [organizationId],
      );
      expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
        "role.created", "access.approved", "permission.granted", "permission.revoked",
      ]));
    } finally {
      await pool.end();
    }
  });

  it("revokes active sessions and blocks a new session", async () => {
    const access = store();
    const organizationId = `revoke-${randomUUID()}`;
    await access.ensureOrganization(organizationId, "Revocation organisation");
    const adminIdentity = identity("admin");
    const admin = await access.signInWithGoogle({
      organizationId,
      ...adminIdentity,
      bootstrapAdmins: new Set([adminIdentity.email]),
      sessionLifetimeSeconds: 3_600,
    });
    const personIdentity = identity("revoked");
    const person = await access.signInWithGoogle({
      organizationId,
      ...personIdentity,
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    });
    const request = (await access.listAccessRequests(organizationId))
      .find((item) => item.user_id === person.principal.userId)!;
    await access.decideAccessRequest({
      organizationId,
      requestId: request.id,
      decision: "approved",
      roleIds: ["reader"],
      actorUserId: admin.principal.userId,
    });
    await access.revokeUser(organizationId, person.principal.userId, admin.principal.userId);

    await expect(access.authenticateSession(person.token)).rejects.toThrow(/Sign in/);
    await expect(access.signInWithGoogle({
      organizationId,
      ...personIdentity,
      bootstrapAdmins: new Set(),
      sessionLifetimeSeconds: 3_600,
    })).rejects.toThrow(/revoked/);
  });
});
