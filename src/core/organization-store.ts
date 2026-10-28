import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import { sharedPool } from "./db-pool";
import { AuthorizationError, InputError, NotFoundError } from "./errors";
import {
  createOrganizationSchema, updateOrganizationSchema, organizationSettingsSchema,
  type ManagedOrganization, type OrganizationSecretName, type OrganizationSummary,
} from "./organization-settings";
import { decryptOrganizationSecret, encryptOrganizationSecret } from "./organization-secrets";

export class OrganizationStore {
  private readonly pool;

  constructor(databaseUrl: string, private readonly encryptionKey?: string) {
    this.pool = sharedPool(databaseUrl);
  }

  async requireAdministrator(userId: string, database = this.pool): Promise<void> {
    const result = await database.query(
      `SELECT a.user_id FROM instance_administrators a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1 AND u.status = 'active'`, [userId],
    );
    if (!result.rowCount) throw new AuthorizationError("Instance administrator access is required.");
  }

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const result = await this.pool.query(
      `SELECT o.id AS slug, o.name FROM organizations o
       JOIN organization_settings s ON s.organization_id = o.id
       JOIN access_requests a ON a.organization_id = o.id AND a.user_id = $1 AND a.status = 'approved'
       JOIN users u ON u.id = a.user_id AND u.status = 'active' ORDER BY o.name, o.id`, [userId],
    );
    return result.rows.map((row) => ({ slug: row.slug, name: row.name, requires_authentication: true }));
  }

  async listManaged(userId: string): Promise<ManagedOrganization[]> {
    await this.requireAdministrator(userId);
    const result = await this.pool.query("SELECT organization_id FROM organization_settings ORDER BY organization_id");
    return Promise.all(result.rows.map((row) => this.get(row.organization_id)));
  }

  async get(slug: string): Promise<ManagedOrganization> {
    const { rows: [row] } = await this.pool.query(
      `SELECT o.id, o.name, s.settings_json, s.first_admin_email,
       ARRAY(SELECT name FROM organization_secrets WHERE organization_id = o.id ORDER BY name) AS secret_names
       FROM organizations o JOIN organization_settings s ON s.organization_id = o.id WHERE o.id = $1`, [slug],
    );
    if (!row) throw new NotFoundError("Organisation was not found.");
    return {
      slug: row.id, name: row.name, requires_authentication: true,
      settings: organizationSettingsSchema.parse(row.settings_json),
      first_admin_email: row.first_admin_email, configured_secrets: row.secret_names,
    };
  }

  async readSecrets(slug: string): Promise<Partial<Record<OrganizationSecretName, string>>> {
    const { rows } = await this.pool.query("SELECT name, ciphertext FROM organization_secrets WHERE organization_id = $1", [slug]);
    return Object.fromEntries(rows.map((row) => [row.name, decryptOrganizationSecret(slug, row.name, row.ciphertext, this.encryptionKey)]));
  }

  private async writeSecrets(client: PoolClient, slug: string, secrets: Record<string, string | null | undefined>): Promise<void> {
    for (const [name, value] of Object.entries(secrets)) {
      if (value === undefined) continue;
      if (value === null) {
        await client.query("DELETE FROM organization_secrets WHERE organization_id = $1 AND name = $2", [slug, name]);
      } else {
        const ciphertext = encryptOrganizationSecret(slug, name, value, this.encryptionKey);
        await client.query(
          `INSERT INTO organization_secrets (organization_id, name, ciphertext) VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = NOW()`,
          [slug, name, ciphertext],
        );
      }
    }
  }

  private async transaction<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const admin = await client.query(
        `SELECT a.user_id FROM instance_administrators a JOIN users u ON u.id = a.user_id
         WHERE a.user_id = $1 AND u.status = 'active' FOR SHARE OF a, u`, [userId],
      );
      if (!admin.rowCount) throw new AuthorizationError("Instance administrator access is required.");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new InputError("An organisation with that slug already exists.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async create(userId: string, input: z.input<typeof createOrganizationSchema>): Promise<ManagedOrganization> {
    const parsed = createOrganizationSchema.parse(input);
    await this.transaction(userId, async (client) => {
      await client.query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)",
        [parsed.slug, parsed.name, new Date().toISOString()]);
      await client.query(
        "INSERT INTO organization_settings (organization_id, settings_json, first_admin_email) VALUES ($1, $2::jsonb, $3)",
        [parsed.slug, JSON.stringify(parsed.settings), parsed.first_admin_email],
      );
      await this.writeSecrets(client, parsed.slug, parsed.secrets);
      await client.query("INSERT INTO instance_audit_log (id, actor_user_id, action, organization_id) VALUES ($1, $2, 'organisation.created', $3)",
        [`audit_${randomUUID()}`, userId, parsed.slug]);
    });
    return this.get(parsed.slug);
  }

  async update(userId: string, slug: string, input: z.input<typeof updateOrganizationSchema>): Promise<ManagedOrganization> {
    const parsed = updateOrganizationSchema.parse(input);
    await this.transaction(userId, async (client) => {
      const updated = await client.query(
        "UPDATE organization_settings SET settings_json = $2::jsonb, updated_at = NOW() WHERE organization_id = $1 RETURNING organization_id",
        [slug, JSON.stringify(parsed.settings)],
      );
      if (!updated.rowCount) throw new NotFoundError("Organisation was not found.");
      await client.query("UPDATE organizations SET name = $2, updated_at = $3 WHERE id = $1", [slug, parsed.name, new Date().toISOString()]);
      await this.writeSecrets(client, slug, parsed.secrets);
      await client.query("INSERT INTO instance_audit_log (id, actor_user_id, action, organization_id) VALUES ($1, $2, 'organisation.updated', $3)",
        [`audit_${randomUUID()}`, userId, slug]);
    });
    return this.get(slug);
  }
}
