import { z } from "zod";

import { resolveOrganizationConfig, type SpurConfig } from "./config";
import { sharedPool } from "./db-pool";
import { ConfigurationError, FeatureDisabledError, InputError } from "./errors";

export const FEATURE_NAMES = [
  "ask",
  "code_search",
  "model_provider",
  "modelling_writes",
  "isms",
  "wiki",
  "remote_mcp",
  "knowledge_gaps",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export type OrganizationFeatures = {
  ask: boolean;
  code_search: "off" | "ask" | "on";
  model_provider: "none" | "anthropic" | "openai";
  modelling_writes: boolean;
  isms: boolean;
  wiki: boolean;
  remote_mcp: boolean;
  knowledge_gaps: boolean;
};

export type FeatureValue = OrganizationFeatures[FeatureName];

const schemas = {
  ask: z.boolean(),
  code_search: z.enum(["off", "ask", "on"]),
  model_provider: z.enum(["none", "anthropic", "openai"]),
  modelling_writes: z.boolean(),
  isms: z.boolean(),
  wiki: z.boolean(),
  remote_mcp: z.boolean(),
  knowledge_gaps: z.boolean(),
} satisfies { [K in FeatureName]: z.ZodType<OrganizationFeatures[K]> };

export function defaultFeatures(config: SpurConfig): OrganizationFeatures {
  return {
    ask: true,
    code_search: config.codeSearch,
    model_provider: config.synthesisProvider,
    modelling_writes: true,
    isms: true,
    wiki: true,
    remote_mcp: false,
    knowledge_gaps: true,
  };
}

export function parseFeatureValue<K extends FeatureName>(name: K, value: unknown): OrganizationFeatures[K] {
  const result = schemas[name].safeParse(value);
  if (!result.success) throw new InputError(`Invalid value for feature ${name}.`);
  return result.data as OrganizationFeatures[K];
}

export function featureEnabled(values: OrganizationFeatures, name: FeatureName): boolean {
  const value = values[name];
  return typeof value === "boolean" ? value : value !== "off" && value !== "none";
}

export function requireFeature(values: OrganizationFeatures, name: FeatureName): void {
  if (!featureEnabled(values, name)) throw new FeatureDisabledError(name);
}

// The MCP server passes withoutProvider: the host model answers, so a
// provider whose key is missing here is dropped instead of refusing to start.
export function applyFeatures(
  config: SpurConfig,
  values: OrganizationFeatures,
  options: { withoutProvider?: boolean } = {},
): SpurConfig {
  if (options.withoutProvider && !providerCredentialsPresent(config, values.model_provider)) {
    return { ...config, codeSearch: values.code_search, synthesisProvider: "none" };
  }
  if (values.model_provider === "openai" && (!config.openAIKey || !config.openAIModel)) {
    throw new ConfigurationError(
      "The OpenAI feature requires OPENAI_API_KEY and OPENAI_MODEL in the runtime environment.",
      "missing_credentials",
    );
  }
  if (values.model_provider === "anthropic" && (!config.anthropicKey || !config.anthropicModel)) {
    throw new ConfigurationError(
      "The Anthropic feature requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL in the runtime environment.",
      "missing_credentials",
    );
  }
  return { ...config, codeSearch: values.code_search, synthesisProvider: values.model_provider };
}

function providerCredentialsPresent(
  config: SpurConfig,
  provider: OrganizationFeatures["model_provider"],
): boolean {
  if (provider === "openai") return Boolean(config.openAIKey && config.openAIModel);
  if (provider === "anthropic") return Boolean(config.anthropicKey && config.anthropicModel);
  return true;
}

export async function features(
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): Promise<OrganizationFeatures> {
  const config = await resolveOrganizationConfig(organizationId, env, projectRoot);
  const pool = sharedPool(config.databaseUrl);
  if (config.tenancy !== "multi") await pool.query(
    `INSERT INTO organizations (id, name, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
    [organizationId, config.organization.name],
  );
  const result = await pool.query<{ feature: string; value_json: unknown }>(
    `SELECT feature, value_json FROM organization_features
     WHERE organization_id = $1`,
    [organizationId],
  );
  const effective = defaultFeatures(config);
  const known = new Set<string>(FEATURE_NAMES);
  for (const row of result.rows) {
    if (!known.has(row.feature)) continue;
    const name = row.feature as FeatureName;
    (effective as Record<FeatureName, FeatureValue>)[name] = parseFeatureValue(name, row.value_json);
  }
  return effective;
}

export async function setFeature(
  organizationId: string,
  name: FeatureName,
  value: unknown,
  actorUserId: string,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): Promise<OrganizationFeatures> {
  const config = await resolveOrganizationConfig(organizationId, env, projectRoot);
  const parsed = parseFeatureValue(name, value);
  const pool = sharedPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (config.tenancy !== "multi") await client.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
      [organizationId, config.organization.name],
    );
    await client.query(
      `INSERT INTO organization_features (organization_id, feature, value_json, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT(organization_id, feature) DO UPDATE SET
         value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [organizationId, name, JSON.stringify(parsed), actorUserId === "local" ? null : actorUserId],
    );
    await client.query(
      `INSERT INTO audit_log (
        organization_id, id, actor_user_id, action, target_type, target_id,
        details_json, created_at
      ) VALUES ($1, 'audit_' || gen_random_uuid()::text, $2, 'feature.changed',
        'feature', $3, $4::jsonb, NOW())`,
      [organizationId, actorUserId === "local" ? null : actorUserId, name,
        JSON.stringify({ value: parsed })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return features(organizationId, env, projectRoot);
}
