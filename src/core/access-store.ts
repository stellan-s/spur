import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { sharedPool } from "./db-pool";
import { AuthenticationError, AuthorizationError, InputError, NotFoundError } from "./errors";
import {
  PERMISSIONS,
  SYSTEM_ROLE_DESCRIPTIONS,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
} from "./permissions";

type Queryable = Pool | PoolClient;

export type AccessStatus = "pending" | "approved" | "rejected" | "revoked";

export type Principal = {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  accessStatus: AccessStatus | "local";
  permissions: Set<Permission>;
  sessionId?: string;
  instanceAdministrator?: boolean;
};

export type AccessRequestSummary = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: AccessStatus;
  requested_at: string;
  decided_at: string | null;
  role_ids: string[];
};

export type RoleSummary = {
  id: string;
  name: string;
  description: string;
  system: boolean;
  permissions: Permission[];
};

export type OAuthClientSummary = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

const ROLE_NAMES: Record<string, string> = {
  reader: "Reader",
  modeller: "Modeller",
  reviewer: "Reviewer",
  "security-owner": "Security owner",
  administrator: "Administrator",
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 20)}`;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function optionalTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

export class AccessStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(readonly databaseUrl: string, pool?: Pool) {
    this.pool = pool ?? sharedPool(databaseUrl);
    this.ownsPool = false;
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  private async query<T extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
    database: Queryable = this.pool,
  ): Promise<T[]> {
    return (await database.query<T>(text, values)).rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureOrganization(id: string, name: string): Promise<void> {
    await this.transaction(async (client) => {
      const current = new Date();
      await this.query(
        `INSERT INTO organizations (id, name, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
         WHERE NOT EXISTS (SELECT 1 FROM organization_settings WHERE organization_id = EXCLUDED.id)`,
        [id, name, current.toISOString()],
        client,
      );
      for (const [roleId, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
        await this.query(
          `INSERT INTO roles (
            organization_id, id, name, description, system, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, TRUE, $5, $5)
          ON CONFLICT(organization_id, id) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description,
            system = TRUE, updated_at = EXCLUDED.updated_at`,
          [id, roleId, ROLE_NAMES[roleId], SYSTEM_ROLE_DESCRIPTIONS[roleId], current],
          client,
        );
        await this.query(
          "DELETE FROM role_permissions WHERE organization_id = $1 AND role_id = $2",
          [id, roleId],
          client,
        );
        for (const permission of permissions) {
          await this.query(
            `INSERT INTO role_permissions (organization_id, role_id, permission)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [id, roleId, permission],
            client,
          );
        }
      }
    });
  }

  // Removes rows nothing can use any more. Runs on each sign-in start, so
  // abandoned sign-ins, codes and registrations cannot grow without bound.
  async purgeExpired(): Promise<void> {
    await this.query("DELETE FROM oidc_transactions WHERE expires_at < NOW()");
    await this.query("DELETE FROM login_otp_challenges WHERE expires_at < NOW() - INTERVAL '1 day'");
    await this.query("DELETE FROM oauth_authorization_codes WHERE expires_at < NOW()");
    await this.query("DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '30 days'");
    await this.query("DELETE FROM oauth_tokens WHERE refresh_expires_at < NOW() - INTERVAL '30 days'");
    await this.query("DELETE FROM mcp_rate_limit_events WHERE created_at < NOW() - INTERVAL '1 day'");
    await this.query(
      `DELETE FROM oauth_clients c
       WHERE c.created_at < NOW() - INTERVAL '1 day'
         AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = c.client_id)
         AND NOT EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id = c.client_id)`,
    );
  }

  async saveOidcTransaction(input: {
    state: string;
    organizationId: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
    returnTo?: string;
  }): Promise<void> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1_000);
    await this.query(
      `INSERT INTO oidc_transactions (
        state_hash, organization_id, code_verifier, nonce, redirect_uri, return_to,
        created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [hash(input.state), input.organizationId || null, input.codeVerifier, input.nonce,
        input.redirectUri, input.returnTo ?? null, createdAt, expiresAt],
    );
  }

  async consumeOidcTransaction(state: string): Promise<{
    organizationId: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
    returnTo?: string;
  }> {
    return this.transaction(async (client) => {
      const [row] = await this.query<{
        organization_id: string;
        code_verifier: string;
        nonce: string;
        redirect_uri: string;
        return_to: string | null;
      }>(
        `DELETE FROM oidc_transactions
         WHERE state_hash = $1 AND expires_at > NOW()
         RETURNING organization_id, code_verifier, nonce, redirect_uri, return_to`,
        [hash(state)],
        client,
      );
      if (!row) throw new AuthenticationError("The sign-in request expired. Start again.", "oidc_state_invalid");
      return {
        organizationId: row.organization_id ?? "",
        codeVerifier: row.code_verifier,
        nonce: row.nonce,
        redirectUri: row.redirect_uri,
        returnTo: row.return_to ?? undefined,
      };
    });
  }

  async createLoginOtpChallenge(input: {
    organizationId: string;
    email: string;
    returnTo?: string;
    lifetimeSeconds: number;
    ipAddress?: string;
  }): Promise<{ token: string; code: string }> {
    const email = input.email.trim().toLocaleLowerCase();
    return this.transaction(async (client) => {
      // Serialize requests for one mailbox and tenant so concurrent requests
      // cannot bypass the resend and hourly limits between SELECT and INSERT.
      await this.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`otp:${input.organizationId}:${email}`],
        client,
      );
      const [limits] = await this.query<{ recent: string; latest: Date | null }>(
        `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS recent,
                MAX(created_at) AS latest
         FROM login_otp_challenges
         WHERE LOWER(email) = $1 AND organization_id IS NOT DISTINCT FROM $2`,
        [email, input.organizationId || null],
        client,
      );
      if (Number(limits?.recent ?? 0) >= 10) {
        throw new InputError("Too many code requests. Try again in about an hour.");
      }
      if (limits?.latest && Date.now() - new Date(limits.latest).getTime() < 60_000) {
        throw new InputError("Wait at least one minute before requesting another code.");
      }
      const token = randomBytes(32).toString("base64url");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + input.lifetimeSeconds * 1_000);
      await this.query(
        `INSERT INTO login_otp_challenges (
          token_hash, organization_id, email, code_hash, return_to, attempts,
          ip_address, created_at, expires_at, used_at
        ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, NULL)`,
        [hash(token), input.organizationId || null, email, hash(`${token}:${code}`),
          input.returnTo ?? null, input.ipAddress ?? null, createdAt, expiresAt],
        client,
      );
      return { token, code };
    });
  }

  async deleteLoginOtpChallenge(token: string): Promise<void> {
    await this.query("DELETE FROM login_otp_challenges WHERE token_hash = $1", [hash(token)]);
  }

  async consumeLoginOtpChallenge(token: string, code: string): Promise<{
    organizationId: string;
    email: string;
    returnTo?: string;
  }> {
    const result = await this.transaction(async (client): Promise<
      | { ok: true; organizationId: string; email: string; returnTo?: string }
      | { ok: false; code: "otp_invalid" | "otp_expired" | "otp_attempts_exceeded" }
    > => {
      const [row] = await this.query<{
        organization_id: string | null;
        email: string;
        code_hash: string;
        return_to: string | null;
        attempts: number;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT organization_id, email, code_hash, return_to, attempts, expires_at, used_at
         FROM login_otp_challenges WHERE token_hash = $1 FOR UPDATE`,
        [hash(token)],
        client,
      );
      if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
        return { ok: false, code: "otp_expired" };
      }
      if (row.attempts >= 5) {
        return { ok: false, code: "otp_attempts_exceeded" };
      }
      const expected = Buffer.from(row.code_hash, "hex");
      const received = Buffer.from(hash(`${token}:${code}`), "hex");
      if (!timingSafeEqual(expected, received)) {
        const attempts = row.attempts + 1;
        await this.query(
          `UPDATE login_otp_challenges
           SET attempts = $2, used_at = CASE WHEN $2 >= 5 THEN NOW() ELSE used_at END
           WHERE token_hash = $1`,
          [hash(token), attempts],
          client,
        );
        return { ok: false, code: attempts >= 5 ? "otp_attempts_exceeded" : "otp_invalid" };
      }
      await this.query(
        "UPDATE login_otp_challenges SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL",
        [hash(token)],
        client,
      );
      return {
        ok: true,
        organizationId: row.organization_id ?? "",
        email: row.email,
        returnTo: row.return_to ?? undefined,
      };
    });
    if (!result.ok) {
      if (result.code === "otp_invalid") {
        throw new AuthenticationError("Invalid code.", result.code);
      }
      if (result.code === "otp_attempts_exceeded") {
        throw new AuthenticationError("Too many failed attempts. Request a new code.", result.code);
      }
      throw new AuthenticationError("The code expired. Request a new one.", result.code);
    }
    return {
      organizationId: result.organizationId,
      email: result.email,
      returnTo: result.returnTo,
    };
  }

  async signInWithGoogle(input: {
    organizationId: string;
    subject: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    bootstrapAdmins: ReadonlySet<string>;
    instanceAdmins?: ReadonlySet<string>;
    bootstrapSecurityOwners?: ReadonlySet<string>;
    allowedDomains?: readonly string[];
    hostedDomain?: string;
    sessionLifetimeSeconds: number;
    userAgent?: string;
    ipAddress?: string;
    preserveExistingSubject?: boolean;
  }): Promise<{ principal: Principal; token: string; expiresAt: Date; requestCreated: boolean }> {
    const normalizedEmail = input.email.trim().toLocaleLowerCase();
    const bootstrapListed = input.bootstrapAdmins.has(normalizedEmail);
    const result = await this.transaction(async (client) => {
      const current = new Date();
      const matchingUsers = await this.query<{
        id: string;
        google_subject: string;
        email: string;
        status: string;
      }>(
        `SELECT id, google_subject, email, status FROM users
         WHERE google_subject = $1 OR LOWER(email) = $2`,
        [input.subject, normalizedEmail],
        client,
      );
      const subjectMatch = matchingUsers.find((user) => user.google_subject === input.subject);
      const emailMatch = matchingUsers.find((user) => user.email.toLocaleLowerCase() === normalizedEmail);
      if (subjectMatch && emailMatch && subjectMatch.id !== emailMatch.id) {
        throw new AuthenticationError("This Google identity conflicts with an existing account.", "identity_conflict");
      }
      // An email match may adopt this Google identity only if it was
      // provisioned by an administrator and never signed in. Otherwise a second
      // Google account on the same address could take over the user.
      if (!subjectMatch && emailMatch && !emailMatch.google_subject.startsWith("provisioned:") &&
          !input.preserveExistingSubject) {
        throw new AuthenticationError("This Google identity conflicts with an existing account.", "identity_conflict");
      }
      const existingUser = subjectMatch ?? emailMatch;
      if (existingUser?.status === "revoked") {
        throw new AuthenticationError("This account has been revoked.", "account_revoked");
      }
      const userId = existingUser?.id ?? stableId("usr", input.subject);
      if (existingUser) {
        await this.query(
          `UPDATE users SET google_subject = CASE WHEN $7 THEN google_subject ELSE $2 END,
             email = $3, display_name = $4,
             avatar_url = $5, updated_at = $6, last_signed_in_at = $6
           WHERE id = $1`,
          [userId, input.subject, normalizedEmail, input.displayName.trim(),
            input.avatarUrl ?? null, current, input.preserveExistingSubject ?? false],
          client,
        );
      } else {
        await this.query(
          `INSERT INTO users (
          id, google_subject, email, display_name, avatar_url, status,
          created_at, updated_at, last_signed_in_at
          ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $6)`,
          [userId, input.subject, normalizedEmail, input.displayName.trim(),
            input.avatarUrl ?? null, current],
          client,
        );
      }
      if (input.instanceAdmins?.has(normalizedEmail)) {
        await this.query("SELECT pg_advisory_xact_lock(hashtext('spur_instance_bootstrap'))", [], client);
        const claimed = await this.query("INSERT INTO instance_bootstrap (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING RETURNING singleton", [], client);
        if (claimed.length) {
          for (const email of input.instanceAdmins) {
            await this.query(
              `INSERT INTO users (id, google_subject, email, display_name, status, created_at, updated_at, last_signed_in_at)
               VALUES ($1, $2, $3, $3, 'active', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`,
              [stableId("usr", `provisioned:${email}`), `provisioned:${hash(email)}`, email], client,
            );
            await this.query(
              `INSERT INTO instance_administrators (user_id) SELECT id FROM users
               WHERE LOWER(email) = $1 AND status = 'active' ON CONFLICT DO NOTHING`, [email], client,
            );
          }
          await this.query(
            "INSERT INTO instance_audit_log (id, actor_user_id, action) VALUES ($1, $2, 'instance.bootstrapped')",
            [`audit_${randomUUID()}`, userId], client,
          );
        }
      }
      if (!input.organizationId) {
        return { principal: await this.instancePrincipalForUser(userId, client), requestCreated: false };
      }
      const requestId = stableId("req", `${input.organizationId}:${userId}`);
      const [existingRequest] = await this.query<{ id: string; status: AccessStatus }>(
        "SELECT id, status FROM access_requests WHERE organization_id = $1 AND user_id = $2",
        [input.organizationId, userId],
        client,
      );
      if (existingRequest?.status === "revoked") {
        throw new AuthenticationError("This organisation access has been revoked.", "account_revoked");
      }
      // Bootstrap creates the first administrator only. Once one exists, a
      // listed address gets no access that an administrator has withdrawn.
      const [administrators] = await this.query<{ count: string; current_user_is_admin: boolean }>(
        `SELECT COUNT(*) AS count, COALESCE(BOOL_OR(user_id = $2), FALSE) AS current_user_is_admin
         FROM user_roles
         WHERE organization_id = $1 AND role_id = 'administrator'`,
        [input.organizationId, userId],
        client,
      );
      const bootstrap = bootstrapListed && Number(administrators?.count ?? 0) === 0 &&
        (!existingRequest || existingRequest.status === "pending");
      const approvedAdministrator = existingRequest?.status === "approved" && administrators?.current_user_is_admin;
      // Domain exceptions use this organisation's current administrator role,
      // not a stale bootstrap list. Denial rolls back all sign-in changes.
      const allowedDomains = input.allowedDomains ?? [];
      const domain = normalizedEmail.split("@").at(-1) ?? "";
      const hostedDomain = input.hostedDomain?.toLocaleLowerCase() ?? "";
      if (allowedDomains.length > 0 &&
          (!allowedDomains.includes(domain) || !allowedDomains.includes(hostedDomain)) &&
          !approvedAdministrator && !bootstrap) {
        throw new AuthenticationError("This email domain is not allowed.", "domain_not_allowed");
      }
      await this.query(
        `INSERT INTO access_requests (
          organization_id, id, user_id, status, requested_at, decided_at, decided_by
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          status = CASE WHEN $4 = 'approved' THEN 'approved' ELSE access_requests.status END,
          decided_at = CASE WHEN $4 = 'approved' THEN EXCLUDED.decided_at ELSE access_requests.decided_at END`,
        [input.organizationId, requestId, userId, bootstrap ? "approved" : "pending",
          current, bootstrap ? current : null],
        client,
      );
      if (bootstrap) {
        await this.query(
          `INSERT INTO user_roles (organization_id, user_id, role_id, granted_by, granted_at)
           VALUES ($1, $2, 'administrator', NULL, $3)
           ON CONFLICT DO NOTHING`,
          [input.organizationId, userId, current],
          client,
        );
        await this.recordAudit({
          organizationId: input.organizationId,
          actorUserId: userId,
          action: "access.bootstrap_approved",
          targetType: "user",
          targetId: userId,
          details: { email: normalizedEmail, role_ids: ["administrator"] },
        }, client);
      }
      // Administrators cannot grant restricted access, so the first security
      // owner comes from configuration: an approved, listed person, and only
      // while the organisation has none.
      if (input.bootstrapSecurityOwners?.has(normalizedEmail)) {
        const [owners] = await this.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_roles
           WHERE organization_id = $1 AND role_id = 'security-owner'`,
          [input.organizationId],
          client,
        );
        const [access] = await this.query<{ status: string }>(
          "SELECT status FROM access_requests WHERE organization_id = $1 AND user_id = $2",
          [input.organizationId, userId],
          client,
        );
        if (Number(owners?.count ?? 0) === 0 && access?.status === "approved") {
          await this.query(
            `INSERT INTO user_roles (organization_id, user_id, role_id, granted_by, granted_at)
             VALUES ($1, $2, 'security-owner', NULL, $3)
             ON CONFLICT DO NOTHING`,
            [input.organizationId, userId, current],
            client,
          );
          await this.recordAudit({
            organizationId: input.organizationId,
            actorUserId: userId,
            action: "access.bootstrap_security_owner",
            targetType: "user",
            targetId: userId,
            details: { email: normalizedEmail, role_ids: ["security-owner"] },
          }, client);
        }
      }
      return {
        principal: await this.principalForUser(input.organizationId, userId, client),
        requestCreated: !existingRequest,
      };
    });
    const session = await this.createSession({
      organizationId: input.organizationId,
      userId: result.principal.userId,
      lifetimeSeconds: input.sessionLifetimeSeconds,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
    return { ...result, ...session };
  }

  async signInWithEmailOtp(input: {
    organizationId: string;
    email: string;
    bootstrapAdmins: ReadonlySet<string>;
    instanceAdmins?: ReadonlySet<string>;
    bootstrapSecurityOwners?: ReadonlySet<string>;
    allowedDomains?: readonly string[];
    sessionLifetimeSeconds: number;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ principal: Principal; token: string; expiresAt: Date; requestCreated: boolean }> {
    const email = input.email.trim().toLocaleLowerCase();
    return this.signInWithGoogle({
      ...input,
      subject: `otp:${hash(email)}`,
      displayName: email,
      hostedDomain: email.split("@").at(-1) ?? "",
      preserveExistingSubject: true,
    });
  }

  async provisionAdministrator(input: {
    organizationId: string;
    organizationName: string;
    email: string;
    displayName?: string;
  }): Promise<Principal> {
    const email = input.email.trim().toLocaleLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("A valid administrator email is required.");
    await this.ensureOrganization(input.organizationId, input.organizationName);
    return this.transaction(async (client) => {
      const [existing] = await this.query<{ id: string; status: string }>(
        "SELECT id, status FROM users WHERE LOWER(email) = $1 FOR UPDATE",
        [email],
        client,
      );
      if (existing?.status === "revoked") {
        throw new InputError("The existing account is revoked and cannot be provisioned.");
      }
      const userId = existing?.id ?? stableId("usr", `provisioned:${email}`);
      if (!existing) {
        await this.query(
          `INSERT INTO users (
            id, google_subject, email, display_name, avatar_url, status,
            created_at, updated_at, last_signed_in_at
          ) VALUES ($1, $2, $3, $4, NULL, 'active', NOW(), NOW(), NOW())`,
          [userId, `provisioned:${hash(email)}`, email, input.displayName?.trim() || email],
          client,
        );
      }
      const requestId = stableId("req", `${input.organizationId}:${userId}`);
      await this.query(
        `INSERT INTO access_requests (
          organization_id, id, user_id, status, requested_at, decided_at, decided_by
        ) VALUES ($1, $2, $3, 'approved', NOW(), NOW(), NULL)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          status = 'approved', decided_at = NOW(), decided_by = NULL`,
        [input.organizationId, requestId, userId],
        client,
      );
      await this.query(
        `INSERT INTO user_roles (organization_id, user_id, role_id, granted_by, granted_at)
         VALUES ($1, $2, 'administrator', NULL, NOW()) ON CONFLICT DO NOTHING`,
        [input.organizationId, userId],
        client,
      );
      await this.recordAudit({
        organizationId: input.organizationId,
        action: "access.administrator_provisioned",
        targetType: "user",
        targetId: userId,
        details: { email, role_ids: ["administrator"] },
      }, client);
      return this.principalForUser(input.organizationId, userId, client);
    });
  }

  async createSession(input: {
    organizationId: string;
    userId: string;
    lifetimeSeconds: number;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const current = new Date();
    const expiresAt = new Date(current.getTime() + input.lifetimeSeconds * 1_000);
    await this.query(
      `INSERT INTO sessions (
        id, token_hash, organization_id, user_id, created_at, expires_at,
        last_seen_at, revoked_at, user_agent, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $5, NULL, $7, $8)`,
      [`ses_${randomUUID()}`, hash(token), input.organizationId || null, input.userId,
        current, expiresAt, input.userAgent ?? null, input.ipAddress ?? null],
    );
    return { token, expiresAt };
  }

  async authenticateSession(token: string, organizationId?: string): Promise<Principal> {
    const [row] = await this.query<{ id: string; organization_id: string; user_id: string }>(
      `UPDATE sessions SET last_seen_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING id, organization_id, user_id`,
      [hash(token)],
    );
    if (!row) throw new AuthenticationError("Sign in to continue.");
    const target = organizationId ?? row.organization_id;
    const principal = target
      ? await this.principalForUser(target, row.user_id)
      : await this.instancePrincipalForUser(row.user_id);
    return { ...principal, sessionId: row.id };
  }

  private async instancePrincipalForUser(userId: string, database: Queryable = this.pool): Promise<Principal> {
    const [user] = await this.query<{ email: string; display_name: string; administrator: boolean }>(
      `SELECT email, display_name, EXISTS (SELECT 1 FROM instance_administrators a WHERE a.user_id = u.id) AS administrator
       FROM users u WHERE id = $1 AND status = 'active'`, [userId], database,
    );
    if (!user) throw new AuthenticationError("This account has been revoked.", "account_revoked");
    return {
      userId, organizationId: "", email: user.email, displayName: user.display_name,
      accessStatus: "approved", permissions: new Set(), instanceAdministrator: user.administrator,
    };
  }

  async principalForUser(
    organizationId: string,
    userId: string,
    database: Queryable = this.pool,
  ): Promise<Principal> {
    const [row] = await this.query<{
      email: string;
      display_name: string;
      user_status: string;
      access_status: AccessStatus;
    }>(
      `SELECT u.email, u.display_name, u.status AS user_status, ar.status AS access_status
       FROM users u
       JOIN access_requests ar ON ar.user_id = u.id AND ar.organization_id = $1
       WHERE u.id = $2`,
      [organizationId, userId],
      database,
    );
    if (!row || row.user_status === "revoked") {
      throw new AuthenticationError("This account has been revoked.", "account_revoked");
    }
    const permissions = row.access_status === "approved"
      ? await this.permissionsForUser(organizationId, userId, database)
      : new Set<Permission>();
    return {
      userId,
      organizationId,
      email: row.email,
      displayName: row.display_name,
      accessStatus: row.access_status,
      permissions,
    };
  }

  private async permissionsForUser(
    organizationId: string,
    userId: string,
    database: Queryable,
  ): Promise<Set<Permission>> {
    const roleRows = await this.query<{ permission: string }>(
      `SELECT DISTINCT rp.permission
       FROM user_roles ur
       JOIN role_permissions rp
         ON rp.organization_id = ur.organization_id AND rp.role_id = ur.role_id
       WHERE ur.organization_id = $1 AND ur.user_id = $2`,
      [organizationId, userId],
      database,
    );
    const directRows = await this.query<{ permission: string; granted: boolean }>(
      `SELECT permission, granted FROM user_permission_grants
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId],
      database,
    );
    const valid = new Set<string>(PERMISSIONS);
    const permissions = new Set(roleRows
      .map((row) => row.permission)
      .filter((permission): permission is Permission => valid.has(permission)));
    for (const row of directRows) {
      if (!valid.has(row.permission)) continue;
      if (row.granted) permissions.add(row.permission as Permission);
      else permissions.delete(row.permission as Permission);
    }
    return permissions;
  }

  async revokeSession(token: string): Promise<void> {
    await this.query(
      "UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
      [hash(token)],
    );
  }

  async listAccessRequests(organizationId: string): Promise<AccessRequestSummary[]> {
    const rows = await this.query<{
      id: string;
      user_id: string;
      email: string;
      display_name: string;
      status: AccessStatus;
      requested_at: Date;
      decided_at: Date | null;
      role_ids: unknown;
    }>(
      `SELECT ar.id, ar.user_id, u.email, u.display_name, ar.status,
        ar.requested_at, ar.decided_at,
        COALESCE(jsonb_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '[]'::jsonb) AS role_ids
       FROM access_requests ar
       JOIN users u ON u.id = ar.user_id
       LEFT JOIN user_roles ur
         ON ur.organization_id = ar.organization_id AND ur.user_id = ar.user_id
       WHERE ar.organization_id = $1
       GROUP BY ar.organization_id, ar.id, u.id
       ORDER BY ar.requested_at DESC`,
      [organizationId],
    );
    return rows.map((row) => ({
      ...row,
      requested_at: timestamp(row.requested_at),
      decided_at: optionalTimestamp(row.decided_at),
      role_ids: Array.isArray(row.role_ids)
        ? row.role_ids.filter((value): value is string => typeof value === "string") : [],
    }));
  }

  // restricted.* may be granted, directly or through a role, only by someone
  // who holds restricted.read, so an administrator cannot unmask restricted
  // records by granting them to themselves or to someone else.
  private async requireRestrictedGrantor(
    organizationId: string,
    actorUserId: string,
    permissions: readonly string[],
    client: PoolClient,
  ): Promise<void> {
    if (!permissions.some((permission) => permission.startsWith("restricted."))) return;
    const actor = await this.principalForUser(organizationId, actorUserId, client);
    if (!actor.permissions.has("restricted.read")) {
      throw new AuthorizationError("Only a security owner can grant restricted access.");
    }
  }

  private async rolePermissions(
    organizationId: string,
    roleIds: readonly string[],
    client: PoolClient,
  ): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.query<{ permission: string }>(
      `SELECT DISTINCT permission FROM role_permissions
       WHERE organization_id = $1 AND role_id = ANY($2::text[])`,
      [organizationId, [...roleIds]],
      client,
    );
    return rows.map((row) => row.permission);
  }

  async decideAccessRequest(input: {
    organizationId: string;
    requestId: string;
    decision: "approved" | "rejected";
    roleIds: string[];
    actorUserId: string;
    reason?: string;
  }): Promise<void> {
    await this.transaction(async (client) => {
      const [request] = await this.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM access_requests
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [input.organizationId, input.requestId],
        client,
      );
      if (!request) throw new NotFoundError("Access request was not found.");
      if (request.status !== "pending") throw new InputError("This access request was already decided.");
      if (input.decision === "approved" && input.roleIds.length === 0) {
        throw new InputError("Choose at least one role before approving access.");
      }
      for (const roleId of input.roleIds) {
        const [role] = await this.query(
          "SELECT id FROM roles WHERE organization_id = $1 AND id = $2",
          [input.organizationId, roleId],
          client,
        );
        if (!role) throw new InputError(`Role ${roleId} was not found.`);
      }
      if (input.decision === "approved") {
        await this.requireRestrictedGrantor(input.organizationId, input.actorUserId,
          await this.rolePermissions(input.organizationId, input.roleIds, client), client);
      }
      await this.query(
        `UPDATE access_requests SET status = $3, decided_at = NOW(), decided_by = $4,
          decision_reason = $5 WHERE organization_id = $1 AND id = $2`,
        [input.organizationId, input.requestId, input.decision, input.actorUserId,
          input.reason?.trim() || null],
        client,
      );
      await this.query(
        "DELETE FROM user_roles WHERE organization_id = $1 AND user_id = $2",
        [input.organizationId, request.user_id],
        client,
      );
      if (input.decision === "approved") {
        for (const roleId of input.roleIds) {
          await this.query(
            `INSERT INTO user_roles (organization_id, user_id, role_id, granted_by, granted_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [input.organizationId, request.user_id, roleId, input.actorUserId],
            client,
          );
        }
      } else {
        await this.query(
          `UPDATE sessions SET revoked_at = NOW()
           WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [input.organizationId, request.user_id],
          client,
        );
      }
      await this.recordAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: `access.${input.decision}`,
        targetType: "user",
        targetId: request.user_id,
        details: { role_ids: input.roleIds, reason: input.reason ?? null },
      }, client);
    });
  }

  async revokeUser(organizationId: string, userId: string, actorUserId: string): Promise<void> {
    if (userId === actorUserId) throw new InputError("You cannot revoke your own access.");
    await this.transaction(async (client) => {
      const rows = await this.query(
        `UPDATE access_requests SET status = 'revoked', decided_at = NOW(), decided_by = $3
         WHERE organization_id = $1 AND user_id = $2 RETURNING id`,
        [organizationId, userId, actorUserId],
        client,
      );
      if (rows.length === 0) throw new NotFoundError("User access was not found.");
      await this.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [organizationId, userId],
        client,
      );
      await this.query(
        `UPDATE oauth_tokens SET revoked_at = NOW()
         WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [organizationId, userId],
        client,
      );
      await this.recordAudit({
        organizationId, actorUserId, action: "user.revoked", targetType: "user", targetId: userId,
      }, client);
    });
  }

  async setUserRoles(input: {
    organizationId: string;
    userId: string;
    roleIds: string[];
    actorUserId: string;
  }): Promise<void> {
    if (input.userId === input.actorUserId) throw new InputError("You cannot change your own roles.");
    await this.transaction(async (client) => {
      const [access] = await this.query<{ status: string }>(
        `SELECT status FROM access_requests
         WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`,
        [input.organizationId, input.userId],
        client,
      );
      if (!access) throw new NotFoundError("User access was not found.");
      if (access.status !== "approved") throw new InputError("Only approved users can hold roles.");
      const current = await this.query<{ role_id: string }>(
        "SELECT role_id FROM user_roles WHERE organization_id = $1 AND user_id = $2",
        [input.organizationId, input.userId],
        client,
      );
      const held = new Set(current.map((row) => row.role_id));
      await this.requireRestrictedGrantor(input.organizationId, input.actorUserId,
        await this.rolePermissions(input.organizationId,
          input.roleIds.filter((roleId) => !held.has(roleId)), client), client);
      for (const roleId of [...new Set(input.roleIds)]) {
        const [role] = await this.query(
          "SELECT id FROM roles WHERE organization_id = $1 AND id = $2",
          [input.organizationId, roleId],
          client,
        );
        if (!role) throw new InputError(`Role ${roleId} was not found.`);
      }
      await this.query(
        "DELETE FROM user_roles WHERE organization_id = $1 AND user_id = $2",
        [input.organizationId, input.userId],
        client,
      );
      for (const roleId of [...new Set(input.roleIds)]) {
        await this.query(
          `INSERT INTO user_roles (organization_id, user_id, role_id, granted_by, granted_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [input.organizationId, input.userId, roleId, input.actorUserId],
          client,
        );
      }
      await this.recordAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "user.roles_changed",
        targetType: "user",
        targetId: input.userId,
        details: { role_ids: input.roleIds },
      }, client);
    });
  }

  async setUserPermission(input: {
    organizationId: string;
    userId: string;
    permission: Permission;
    granted: boolean;
    actorUserId: string;
  }): Promise<void> {
    if (input.userId === input.actorUserId) throw new InputError("You cannot change your own permissions.");
    await this.transaction(async (client) => {
      if (input.granted) {
        await this.requireRestrictedGrantor(input.organizationId, input.actorUserId, [input.permission], client);
      }
      const [access] = await this.query<{ status: string }>(
        `SELECT status FROM access_requests
         WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`,
        [input.organizationId, input.userId],
        client,
      );
      if (!access) throw new NotFoundError("User access was not found.");
      if (access.status !== "approved") throw new InputError("Only approved users can receive permission overrides.");
      await this.query(
        `INSERT INTO user_permission_grants (
          organization_id, user_id, permission, granted, changed_by, changed_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT(organization_id, user_id, permission) DO UPDATE SET
          granted = EXCLUDED.granted, changed_by = EXCLUDED.changed_by,
          changed_at = EXCLUDED.changed_at`,
        [input.organizationId, input.userId, input.permission, input.granted, input.actorUserId],
        client,
      );
      await this.recordAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.granted ? "permission.granted" : "permission.revoked",
        targetType: "user",
        targetId: input.userId,
        details: { permission: input.permission },
      }, client);
    });
  }

  async listRoles(organizationId: string): Promise<RoleSummary[]> {
    const rows = await this.query<{
      id: string;
      name: string;
      description: string;
      system: boolean;
      permissions: unknown;
    }>(
      `SELECT r.id, r.name, r.description, r.system,
        COALESCE(jsonb_agg(rp.permission ORDER BY rp.permission)
          FILTER (WHERE rp.permission IS NOT NULL), '[]'::jsonb) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp
         ON rp.organization_id = r.organization_id AND rp.role_id = r.id
       WHERE r.organization_id = $1
       GROUP BY r.organization_id, r.id
       ORDER BY r.system DESC, r.name ASC`,
      [organizationId],
    );
    const valid = new Set<string>(PERMISSIONS);
    return rows.map((row) => ({
      ...row,
      permissions: Array.isArray(row.permissions)
        ? row.permissions.filter((value): value is Permission => typeof value === "string" && valid.has(value))
        : [],
    }));
  }

  async saveCustomRole(input: {
    organizationId: string;
    id?: string;
    name: string;
    description: string;
    permissions: Permission[];
    actorUserId: string;
  }): Promise<RoleSummary> {
    const roleId = input.id ?? stableId("role", `${input.organizationId}:${input.name.toLocaleLowerCase()}`);
    await this.transaction(async (client) => {
      const [existing] = await this.query<{ system: boolean }>(
        "SELECT system FROM roles WHERE organization_id = $1 AND id = $2",
        [input.organizationId, roleId],
        client,
      );
      if (existing?.system) throw new InputError("System roles cannot be edited.");
      await this.requireRestrictedGrantor(input.organizationId, input.actorUserId, input.permissions, client);
      await this.query(
        `INSERT INTO roles (
          organization_id, id, name, description, system, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW())
        ON CONFLICT(organization_id, id) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()`,
        [input.organizationId, roleId, input.name.trim(), input.description.trim()],
        client,
      );
      await this.query(
        "DELETE FROM role_permissions WHERE organization_id = $1 AND role_id = $2",
        [input.organizationId, roleId],
        client,
      );
      for (const permission of [...new Set(input.permissions)]) {
        await this.query(
          `INSERT INTO role_permissions (organization_id, role_id, permission)
           VALUES ($1, $2, $3)`,
          [input.organizationId, roleId, permission],
          client,
        );
      }
      await this.recordAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: existing ? "role.updated" : "role.created",
        targetType: "role",
        targetId: roleId,
        details: { permissions: input.permissions },
      }, client);
    });
    return (await this.listRoles(input.organizationId)).find((role) => role.id === roleId)!;
  }

  async deleteCustomRole(organizationId: string, roleId: string, actorUserId: string): Promise<void> {
    await this.transaction(async (client) => {
      const [role] = await this.query<{ system: boolean }>(
        "SELECT system FROM roles WHERE organization_id = $1 AND id = $2",
        [organizationId, roleId],
        client,
      );
      if (!role) throw new NotFoundError("Role was not found.");
      if (role.system) throw new InputError("System roles cannot be deleted.");
      await this.query(
        "DELETE FROM roles WHERE organization_id = $1 AND id = $2",
        [organizationId, roleId],
        client,
      );
      await this.recordAudit({
        organizationId, actorUserId, action: "role.deleted", targetType: "role", targetId: roleId,
      }, client);
    });
  }

  async registerOAuthClient(input: {
    clientName: string;
    redirectUris: string[];
  }): Promise<OAuthClientSummary> {
    const clientId = `mcp_client_${randomUUID()}`;
    await this.query(
      `INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, created_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [clientId, input.clientName.trim(), JSON.stringify(input.redirectUris)],
    );
    return { clientId, clientName: input.clientName.trim(), redirectUris: input.redirectUris };
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientSummary | null> {
    const [row] = await this.query<{
      client_id: string;
      client_name: string;
      redirect_uris_json: unknown;
    }>(
      "SELECT client_id, client_name, redirect_uris_json FROM oauth_clients WHERE client_id = $1",
      [clientId],
    );
    if (!row) return null;
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUris: Array.isArray(row.redirect_uris_json)
        ? row.redirect_uris_json.filter((value): value is string => typeof value === "string")
        : [],
    };
  }

  async saveOAuthAuthorizationCode(input: {
    clientId: string;
    organizationId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string;
  }): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await this.query(
      `INSERT INTO oauth_authorization_codes (
        code_hash, client_id, organization_id, user_id, redirect_uri,
        code_challenge, scope, resource, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW() + INTERVAL '5 minutes')`,
      [hash(code), input.clientId, input.organizationId, input.userId, input.redirectUri,
        input.codeChallenge, input.scope, input.resource],
    );
    return code;
  }

  private async insertOAuthToken(input: {
    clientId: string;
    organizationId: string;
    userId: string;
    scope: string;
    resource: string;
  }, database: Queryable): Promise<OAuthTokenSet & { id: string }> {
    const id = `mcp_token_${randomUUID()}`;
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(48).toString("base64url");
    const expiresIn = 15 * 60;
    await this.query(
      `INSERT INTO oauth_tokens (
        id, access_token_hash, refresh_token_hash, client_id, organization_id,
        user_id, scope, resource, created_at, expires_at, refresh_expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(),
        NOW() + INTERVAL '15 minutes', NOW() + INTERVAL '30 days')`,
      [id, hash(accessToken), hash(refreshToken), input.clientId, input.organizationId,
        input.userId, input.scope, input.resource],
      database,
    );
    return { id, accessToken, refreshToken, expiresIn, scope: input.scope };
  }

  async exchangeOAuthAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenSet> {
    return this.transaction(async (client) => {
      const [row] = await this.query<{
        client_id: string;
        organization_id: string;
        user_id: string;
        redirect_uri: string;
        code_challenge: string;
        scope: string;
        resource: string;
      }>(
        `DELETE FROM oauth_authorization_codes
         WHERE code_hash = $1 AND expires_at > NOW()
         RETURNING client_id, organization_id, user_id, redirect_uri,
           code_challenge, scope, resource`,
        [hash(input.code)],
        client,
      );
      const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
      if (!row || row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri ||
          row.code_challenge !== challenge) {
        throw new AuthenticationError("The OAuth authorisation code is invalid.", "invalid_grant");
      }
      requirePermission(
        await this.principalForUser(row.organization_id, row.user_id, client),
        "mcp.connect",
      );
      const token = await this.insertOAuthToken({
        clientId: row.client_id,
        organizationId: row.organization_id,
        userId: row.user_id,
        scope: row.scope,
        resource: row.resource,
      }, client);
      return token;
    });
  }

  async refreshOAuthToken(input: {
    refreshToken: string;
    clientId: string;
  }): Promise<OAuthTokenSet> {
    const result = await this.transaction(async (client): Promise<OAuthTokenSet | "invalid"> => {
      const [row] = await this.query<{
        id: string;
        client_id: string;
        organization_id: string;
        user_id: string;
        scope: string;
        resource: string;
      }>(
        `SELECT id, client_id, organization_id, user_id, scope, resource
         FROM oauth_tokens WHERE refresh_token_hash = $1 AND revoked_at IS NULL
           AND refresh_expires_at > NOW() FOR UPDATE`,
        [hash(input.refreshToken)],
        client,
      );
      if (!row) {
        // A rotated refresh token used again means it was copied. Revoke every
        // token issued from it, so the copy and the original both stop working.
        await this.query(
          `WITH RECURSIVE chain AS (
             SELECT id, replaced_by FROM oauth_tokens
             WHERE refresh_token_hash = $1 AND replaced_by IS NOT NULL
             UNION
             SELECT t.id, t.replaced_by FROM oauth_tokens t JOIN chain c ON t.id = c.replaced_by
           )
           UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE id IN (SELECT id FROM chain)`,
          [hash(input.refreshToken)],
          client,
        );
        return "invalid";
      }
      if (row.client_id !== input.clientId) return "invalid";
      requirePermission(
        await this.principalForUser(row.organization_id, row.user_id, client),
        "mcp.connect",
      );
      const token = await this.insertOAuthToken({
        clientId: row.client_id,
        organizationId: row.organization_id,
        userId: row.user_id,
        scope: row.scope,
        resource: row.resource,
      }, client);
      await this.query(
        "UPDATE oauth_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1",
        [row.id, token.id],
        client,
      );
      return token;
    });
    if (result === "invalid") {
      throw new AuthenticationError("The OAuth refresh token is invalid.", "invalid_grant");
    }
    return result;
  }

  async authenticateMcpAccessToken(token: string): Promise<{
    principal: Principal;
    clientId: string;
    scopes: string[];
    expiresAt: Date;
    resource: string;
    tokenId: string;
  }> {
    const [row] = await this.query<{
      id: string;
      client_id: string;
      organization_id: string;
      user_id: string;
      scope: string;
      expires_at: Date;
      resource: string;
    }>(
      `SELECT id, client_id, organization_id, user_id, scope, expires_at, resource
       FROM oauth_tokens WHERE access_token_hash = $1 AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [hash(token)],
    );
    if (!row) throw new AuthenticationError("The MCP access token is invalid.", "invalid_token");
    return {
      principal: await this.principalForUser(row.organization_id, row.user_id),
      clientId: row.client_id,
      scopes: row.scope.split(/\s+/).filter(Boolean),
      expiresAt: row.expires_at,
      resource: row.resource,
      tokenId: row.id,
    };
  }

  async revokeOAuthToken(token: string): Promise<void> {
    await this.query(
      `UPDATE oauth_tokens SET revoked_at = NOW()
       WHERE (access_token_hash = $1 OR refresh_token_hash = $1) AND revoked_at IS NULL`,
      [hash(token)],
    );
  }

  async listOAuthGrants(organizationId: string): Promise<Array<{
    id: string;
    userId: string;
    userEmail: string;
    userDisplayName: string;
    clientId: string;
    clientName: string;
    authorizedAt: string;
    lastRenewedAt: string;
    refreshExpiresAt: string;
    status: "active" | "expired" | "revoked";
    revokedAt: string | null;
  }>> {
    const rows = await this.query<{
      root_id: string;
      user_id: string;
      email: string;
      display_name: string;
      client_id: string;
      client_name: string;
      authorized_at: Date;
      last_renewed_at: Date;
      refresh_expires_at: Date;
      status: "active" | "expired" | "revoked";
      revoked_at: Date | null;
    }>(
      `WITH RECURSIVE roots AS (
         SELECT token.id
         FROM oauth_tokens token
         WHERE token.organization_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM oauth_tokens predecessor
             WHERE predecessor.organization_id = token.organization_id
               AND predecessor.replaced_by = token.id
           )
       ), token_chains AS (
         SELECT root.id AS root_id, token.id, token.replaced_by, token.user_id,
           token.client_id, token.created_at, token.refresh_expires_at, token.revoked_at
         FROM roots root
         JOIN oauth_tokens token ON token.id = root.id
         UNION ALL
         SELECT chain.root_id, successor.id, successor.replaced_by, successor.user_id,
           successor.client_id, successor.created_at, successor.refresh_expires_at,
           successor.revoked_at
         FROM token_chains chain
         JOIN oauth_tokens successor ON successor.id = chain.replaced_by
       ), latest AS (
         SELECT DISTINCT ON (root_id) root_id, user_id, client_id, created_at,
           refresh_expires_at, revoked_at
         FROM token_chains
         ORDER BY root_id, created_at DESC
       )
       SELECT latest.root_id, latest.user_id, users.email, users.display_name,
         latest.client_id, clients.client_name, root.created_at AS authorized_at,
         latest.created_at AS last_renewed_at, latest.refresh_expires_at,
         CASE
           WHEN latest.revoked_at IS NOT NULL THEN 'revoked'
           WHEN latest.refresh_expires_at <= NOW() THEN 'expired'
           ELSE 'active'
         END AS status,
         latest.revoked_at
       FROM latest
       JOIN oauth_tokens root ON root.id = latest.root_id
       JOIN oauth_clients clients ON clients.client_id = latest.client_id
       JOIN users ON users.id = latest.user_id
       ORDER BY root.created_at DESC`,
      [organizationId],
    );
    return rows.map((row) => ({
      id: row.root_id,
      userId: row.user_id,
      userEmail: row.email,
      userDisplayName: row.display_name,
      clientId: row.client_id,
      clientName: row.client_name,
      authorizedAt: timestamp(row.authorized_at),
      lastRenewedAt: timestamp(row.last_renewed_at),
      refreshExpiresAt: timestamp(row.refresh_expires_at),
      status: row.status,
      revokedAt: optionalTimestamp(row.revoked_at),
    }));
  }

  async revokeOAuthGrantById(organizationId: string, grantId: string, actorUserId: string): Promise<void> {
    await this.transaction(async (client) => {
      const result = await this.query(
        `WITH RECURSIVE grant_tokens AS (
           SELECT id, replaced_by
           FROM oauth_tokens
           WHERE organization_id = $1 AND id = $2
           UNION ALL
           SELECT successor.id, successor.replaced_by
           FROM oauth_tokens successor
           JOIN grant_tokens token ON successor.id = token.replaced_by
           WHERE successor.organization_id = $1
         )
         UPDATE oauth_tokens SET revoked_at = NOW()
         WHERE organization_id = $1
           AND id IN (SELECT id FROM grant_tokens)
           AND revoked_at IS NULL
         RETURNING id`,
        [organizationId, grantId],
        client,
      );
      if (result.length === 0) throw new NotFoundError("The MCP connection was not found or is already revoked.");
      await this.recordAudit({
        organizationId,
        actorUserId,
        action: "mcp_grant.revoked",
        targetType: "mcp_grant",
        targetId: grantId,
      }, client);
    });
  }

  async consumeMcpRateLimit(organizationId: string, userId: string, limit: number): Promise<void> {
    await this.transaction(async (client) => {
      await this.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:${userId}`],
        client,
      );
      await this.query(
        "DELETE FROM mcp_rate_limit_events WHERE created_at < NOW() - INTERVAL '1 minute'",
        [],
        client,
      );
      const [row] = await this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM mcp_rate_limit_events
         WHERE organization_id = $1 AND user_id = $2
           AND created_at >= NOW() - INTERVAL '1 minute'`,
        [organizationId, userId],
        client,
      );
      if (Number(row?.count ?? 0) >= limit) {
        throw new AuthorizationError("MCP rate limit exceeded. Try again in a minute.", "rate_limit_exceeded");
      }
      await this.query(
        `INSERT INTO mcp_rate_limit_events (organization_id, user_id, id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [organizationId, userId, `rate_${randomUUID()}`],
        client,
      );
    });
  }

  async recordMcpToolCall(input: {
    organizationId: string;
    userId: string;
    tool: string;
    argumentSummary: Record<string, unknown>;
    result: "success" | "error";
    durationMs: number;
  }): Promise<void> {
    await this.recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "mcp.tool_called",
      targetType: "mcp_tool",
      targetId: input.tool,
      details: {
        arguments: input.argumentSummary,
        result: input.result,
        duration_ms: input.durationMs,
      },
    }, this.pool);
  }

  private async recordAudit(input: {
    organizationId: string;
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown>;
  }, database: Queryable): Promise<void> {
    await this.query(
      `INSERT INTO audit_log (
        organization_id, id, actor_user_id, action, target_type, target_id,
        details_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      [input.organizationId, `audit_${randomUUID()}`,
        input.actorUserId === "local" ? null : input.actorUserId ?? null,
        input.action, input.targetType, input.targetId ?? null,
        JSON.stringify(input.details ?? {})],
      database,
    );
  }
}

export function requirePermission(principal: Principal, permission: Permission): void {
  if (principal.accessStatus === "pending") {
    throw new AuthorizationError("Your request is waiting for approval.", "access_pending");
  }
  if (principal.accessStatus === "rejected") {
    throw new AuthorizationError("Your access request was rejected.", "access_rejected");
  }
  if (principal.accessStatus === "revoked") {
    throw new AuthenticationError("This account has been revoked.", "account_revoked");
  }
  if (!principal.permissions.has(permission)) throw new AuthorizationError();
}

// The local user holds every permission except restricted.read, which needs
// an explicit opt-in, so a desktop MCP client never sees restricted details.
export function localPrincipal(
  organizationId: string,
  actorName: string,
  options: { restrictedRead?: boolean } = {},
): Principal {
  return {
    userId: "local",
    organizationId,
    email: "local@localhost",
    displayName: actorName,
    accessStatus: "local",
    permissions: new Set(PERMISSIONS.filter((permission) =>
      options.restrictedRead || permission !== "restricted.read")),
  };
}
