import { z } from "zod";

export const organizationSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const domain = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
const githubName = z.string().regex(/^[a-zA-Z0-9_.-]+$/).max(100);

export const organizationSettingsSchema = z.object({
  allowed_domains: z.array(domain).max(100).optional(),
  application_name: z.string().trim().max(120).optional(),
  application_aliases: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  security_contact: z.string().trim().max(120).refine((value) => !/[\r\n]/.test(value)).optional(),
  repositories: z.array(z.discriminatedUnion("provider", [
    z.object({ provider: z.literal("local"), root: z.string().min(1).max(1000), name: z.string().max(120).optional() }).strict(),
    z.object({ provider: z.literal("github"), owner: githubName, repository: githubName }).strict(),
  ])).max(20).default([]),
  google_client_id: z.string().trim().max(300).optional(),
  oidc: z.object({ discovery_url: z.url().startsWith("https://"), client_id: z.string().trim().min(1).max(300) }).strict().optional(),
  github_app_id: z.string().regex(/^\d+$/).optional(),
}).strict();

export const ORGANIZATION_SECRET_NAMES = ["google_client_secret", "oidc_client_secret", "github_app_private_key", "github_app_token"] as const;
export const organizationSecretsSchema = z.object({
  google_client_secret: z.string().min(1).max(32_000).nullable().optional(),
  oidc_client_secret: z.string().min(1).max(32_000).nullable().optional(),
  github_app_private_key: z.string().min(1).max(32_000).nullable().optional(),
  github_app_token: z.string().min(1).max(32_000).nullable().optional(),
}).strict();

export const createOrganizationSchema = z.object({
  slug: organizationSlugSchema,
  name: z.string().trim().min(1).max(120),
  first_admin_email: z.email().trim().toLowerCase().max(254),
  settings: organizationSettingsSchema.default({ repositories: [] }),
  secrets: organizationSecretsSchema.default({}),
}).strict();

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  settings: organizationSettingsSchema,
  secrets: organizationSecretsSchema.default({}),
}).strict();

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;
export type OrganizationSecretName = (typeof ORGANIZATION_SECRET_NAMES)[number];
export type OrganizationSummary = { slug: string; name: string; requires_authentication: boolean };
export type ManagedOrganization = OrganizationSummary & {
  settings: OrganizationSettings;
  first_admin_email: string;
  configured_secrets: OrganizationSecretName[];
};
