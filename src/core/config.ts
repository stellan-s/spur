import path from "node:path";

import { ConfigurationError } from "./errors";
import type { ApplicationNaming } from "./naming";
import { modelProviderSchema, type ModelProvider } from "./types";

export const LIMITS = {
  maxQuestionCharacters: 500,
  maxRequestBytes: 2_048,
  maxFiles: 400,
  maxFileBytes: 64 * 1024,
  maxExcerptBytes: 64 * 1024,
  maxRepositoryBytes: 1_000_000,
  maxCandidates: 8,
  maxCandidateLines: 40,
  gitTimeoutMs: 8_000,
} as const;

const OPENAI_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

// The only organisation a fresh install has. It reads the bundled fixture repository.
export const DEMO_ORGANIZATION = { slug: "demo", name: "Demo organisation" } as const;

export type SpurConfig = {
  tenancy: "single" | "multi";
  instanceAdmins: string[];
  encryptionKey?: string;
  organization: {
    slug: string;
    name: string;
  };
  runtimeRoot: string;
  repositoryRoot: string;
  repositoryName?: string;
  applicationNaming?: ApplicationNaming;
  securityContact?: string;
  additionalRepositoryRoots: string[];
  codeSearch: CodeSearchMode;
  databaseUrl: string;
  actorName: string;
  synthesisProvider: ModelProvider;
  openAIModel?: string;
  openAIKey?: string;
  openAIReasoningEffort?: OpenAIReasoningEffort;
  anthropicModel?: string;
  anthropicKey?: string;
  modelTimeoutMs: number;
  maxOutputTokens: number;
  authMode: "none" | "google" | "otp";
  // In local mode, whether the single user sees restricted details unmasked.
  localRestrictedRead: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  emailProvider?: "mailgun" | "smtp";
  emailFrom?: string;
  mailgunApiKey?: string;
  mailgunDomain?: string;
  mailgunBaseUrl: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  otpLifetimeSeconds: number;
  allowedDomains: string[];
  bootstrapAdmins: string[];
  bootstrapSecurityOwners: string[];
  sessionLifetimeSeconds: number;
  mcpRateLimitPerMinute: number;
  sourceProvider: "local" | "github";
  githubOwner?: string;
  githubRepository?: string;
  githubAppToken?: string;
  githubApiUrl: string;
  githubEnvironment?: NodeJS.ProcessEnv;
  repositoryConnections?: import("./organization-settings").OrganizationSettings["repositories"];
};

export function tenancyMode(env: NodeJS.ProcessEnv = process.env): "single" | "multi" {
  const value = env.SPUR_TENANCY?.trim().toLowerCase() || "single";
  if (value !== "single" && value !== "multi") throw new ConfigurationError("SPUR_TENANCY must be 'single' or 'multi'.");
  return value;
}

// off (default): memory only. ask: search code only after the user agrees. on: search
// code across every configured repository whenever a question is asked.
export const CODE_SEARCH_MODES = ["off", "ask", "on"] as const;
export type CodeSearchMode = (typeof CODE_SEARCH_MODES)[number];

function readCodeSearchMode(value: string | undefined): CodeSearchMode {
  const normalized = value?.trim().toLowerCase() || "off";
  if (!CODE_SEARCH_MODES.includes(normalized as CodeSearchMode)) {
    throw new ConfigurationError(
      `SPUR_CODE_SEARCH must be one of: ${CODE_SEARCH_MODES.join(", ")}.`,
    );
  }
  return normalized as CodeSearchMode;
}

export type ConfiguredOrganization = {
  slug: string;
  name: string;
  requires_authentication: boolean;
};

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ConfigurationError(`${name} must be 'true' or 'false'.`);
}

function readOpenAIReasoningEffort(
  value: string | undefined,
): OpenAIReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!OPENAI_REASONING_EFFORTS.includes(normalized as OpenAIReasoningEffort)) {
    throw new ConfigurationError(
      `SPUR_OPENAI_REASONING_EFFORT must be one of: ${OPENAI_REASONING_EFFORTS.join(", ")}.`,
    );
  }
  return normalized as OpenAIReasoningEffort;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): SpurConfig {
  const tenancy = tenancyMode(env);
  const configuredSlug = tenancy === "single" ? env.SPUR_ORGANIZATION_SLUG?.trim() : undefined;
  const configuredRepositoryRoot = env.SPUR_REPOSITORY_ROOT?.trim();
  // Without an organisation, Spur runs the demo on the fixture repository. A
  // real repository must name its organisation, so it never lands in the demo.
  if (tenancy === "single" && !configuredSlug && configuredRepositoryRoot) {
    throw new ConfigurationError(
      "SPUR_ORGANIZATION_SLUG is required when SPUR_REPOSITORY_ROOT is set.",
    );
  }
  if (configuredSlug && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(configuredSlug)) {
    throw new ConfigurationError(
      "SPUR_ORGANIZATION_SLUG must be a lowercase slug of letters, numbers, and hyphens.",
    );
  }
  // Keep the bundled repository for the unnamed demo only. A named
  // single-tenant installation may intentionally run without a source
  // repository and use its persisted model as the source of truth.
  const configuredRoot = configuredRepositoryRoot || (!configuredSlug ? "./fixture-repo" : "");
  const configuredProvider =
    env.SPUR_SYNTHESIS_PROVIDER?.trim() ||
    env.SPUR_MODEL_PROVIDER?.trim() ||
    "none";
  const parsedProvider = modelProviderSchema.safeParse(configuredProvider);

  if (!parsedProvider.success) {
    throw new ConfigurationError(
      "SPUR_SYNTHESIS_PROVIDER must be 'none', 'openai', or 'anthropic'.",
    );
  }
  const provider = parsedProvider.data;
  const repositoryRoot = tenancy === "single" && configuredRoot
    ? path.resolve(projectRoot, configuredRoot)
    : "";
  const applicationName = env.SPUR_APPLICATION_NAME?.trim() || undefined;
  const applicationAliases = (env.SPUR_APPLICATION_ALIASES?.split(",") ?? [])
    .map((alias) => alias.trim())
    .filter(Boolean);
  const securityContact = env.SPUR_SECURITY_CONTACT?.trim();
  const sourceProvider = tenancy === "multi" ? "local" : env.SPUR_SOURCE_PROVIDER?.trim().toLowerCase() || "local";
  if (sourceProvider !== "local" && sourceProvider !== "github") {
    throw new ConfigurationError("SPUR_SOURCE_PROVIDER must be 'local' or 'github'.");
  }
  const githubApp = Boolean(env.SPUR_GITHUB_APP_ID?.trim() && env.SPUR_GITHUB_APP_PRIVATE_KEY?.trim());
  if (sourceProvider === "github" && (!env.SPUR_GITHUB_OWNER?.trim() ||
      !env.SPUR_GITHUB_REPOSITORY?.trim() || (!githubApp && !env.SPUR_GITHUB_APP_TOKEN?.trim()))) {
    throw new ConfigurationError(
      "The GitHub source provider needs SPUR_GITHUB_OWNER, SPUR_GITHUB_REPOSITORY, and either SPUR_GITHUB_APP_ID with SPUR_GITHUB_APP_PRIVATE_KEY or SPUR_GITHUB_APP_TOKEN.",
      "missing_credentials",
    );
  }
  // Fail closed: a production or Cloud Run process without SPUR_AUTH requires
  // Google sign-in rather than silently running as the all-permission local user.
  const cloudRun = Boolean(env.K_SERVICE?.trim());
  const authMode = env.SPUR_AUTH?.trim().toLowerCase() ||
    (tenancy === "multi" || cloudRun || env.NODE_ENV === "production" ? "google" : "none");
  if (authMode !== "none" && authMode !== "google" && authMode !== "otp") {
    throw new ConfigurationError("SPUR_AUTH must be 'none', 'google', or 'otp'.");
  }
  if (tenancy === "multi" && authMode === "none") {
    throw new ConfigurationError("Multi-organisation mode requires sign-in.", "unsafe_local_auth");
  }
  if (authMode === "none" && cloudRun) {
    throw new ConfigurationError(
      "SPUR_AUTH=none cannot run on Cloud Run. Configure Google or email-code sign-in.",
      "unsafe_local_auth",
    );
  }
  const bindAddress = env.SPUR_BIND_ADDRESS?.trim() || env.HOST?.trim();
  if (authMode === "none" && bindAddress &&
      !["localhost", "127.0.0.1", "::1"].includes(bindAddress)) {
    throw new ConfigurationError(
      "SPUR_AUTH=none can only bind to a loopback address. Configure sign-in for network access.",
      "unsafe_local_auth",
    );
  }
  if (authMode === "google" && (!env.SPUR_GOOGLE_CLIENT_ID?.trim() || !env.SPUR_GOOGLE_CLIENT_SECRET?.trim())) {
    throw new ConfigurationError(
      "SPUR_GOOGLE_CLIENT_ID and SPUR_GOOGLE_CLIENT_SECRET are required when SPUR_AUTH=google.",
      "missing_credentials",
    );
  }
  const configuredEmailProvider = env.SPUR_EMAIL_PROVIDER?.trim().toLowerCase();
  if (configuredEmailProvider && configuredEmailProvider !== "mailgun" && configuredEmailProvider !== "smtp") {
    throw new ConfigurationError("SPUR_EMAIL_PROVIDER must be 'mailgun' or 'smtp'.");
  }
  // Provider inference preserves existing Mailgun deployments. New deployments
  // should choose explicitly so adding unrelated environment variables cannot
  // change delivery behaviour.
  const emailProvider = configuredEmailProvider as "mailgun" | "smtp" | undefined ??
    (env.SMTP_HOST?.trim() ? "smtp" : env.MAILGUN_API_KEY?.trim() ? "mailgun" : undefined);
  const emailFrom = env.SPUR_EMAIL_FROM?.trim() || env.MAILGUN_FROM?.trim() || undefined;
  const smtpSecure = readBoolean(env.SMTP_SECURE, false, "SMTP_SECURE");
  const smtpRequireTls = readBoolean(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS");
  const smtpUsername = env.SMTP_USERNAME?.trim() || undefined;
  const smtpPassword = env.SMTP_PASSWORD?.trim() || undefined;
  if (authMode === "otp" && !emailProvider) {
    throw new ConfigurationError(
      "SPUR_EMAIL_PROVIDER and its email delivery credentials are required when SPUR_AUTH=otp.",
      "missing_credentials",
    );
  }
  if (authMode === "otp" && !emailFrom) {
    throw new ConfigurationError("SPUR_EMAIL_FROM is required when SPUR_AUTH=otp.", "missing_credentials");
  }
  if (authMode === "otp" && emailProvider === "mailgun" &&
      (!env.MAILGUN_API_KEY?.trim() || !env.MAILGUN_DOMAIN?.trim())) {
    throw new ConfigurationError(
      "MAILGUN_API_KEY and MAILGUN_DOMAIN are required when SPUR_EMAIL_PROVIDER=mailgun.",
      "missing_credentials",
    );
  }
  if (authMode === "otp" && emailProvider === "smtp" && !env.SMTP_HOST?.trim()) {
    throw new ConfigurationError("SMTP_HOST is required when SPUR_EMAIL_PROVIDER=smtp.", "missing_credentials");
  }
  if (authMode === "otp" && Boolean(smtpUsername) !== Boolean(smtpPassword)) {
    throw new ConfigurationError("SMTP_USERNAME and SMTP_PASSWORD must be configured together.", "missing_credentials");
  }
  if (securityContact && (securityContact.length > 120 || /[\r\n]/.test(securityContact))) {
    throw new ConfigurationError("SPUR_SECURITY_CONTACT must be one line of at most 120 characters.");
  }

  if (provider === "openai" && !env.OPENAI_API_KEY?.trim()) {
    throw new ConfigurationError(
      "OPENAI_API_KEY is required when SPUR_SYNTHESIS_PROVIDER=openai.",
      "missing_credentials",
    );
  }

  if (provider === "openai" && !env.OPENAI_MODEL?.trim()) {
    throw new ConfigurationError(
      "OPENAI_MODEL is required when SPUR_SYNTHESIS_PROVIDER=openai.",
      "missing_model",
    );
  }

  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY?.trim()) {
    throw new ConfigurationError(
      "ANTHROPIC_API_KEY is required when SPUR_SYNTHESIS_PROVIDER=anthropic.",
      "missing_credentials",
    );
  }

  if (provider === "anthropic" && !env.ANTHROPIC_MODEL?.trim()) {
    throw new ConfigurationError(
      "ANTHROPIC_MODEL is required when SPUR_SYNTHESIS_PROVIDER=anthropic.",
      "missing_model",
    );
  }

  return {
    tenancy,
    instanceAdmins: (env.SPUR_INSTANCE_ADMINS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
    encryptionKey: env.SPUR_ENCRYPTION_KEY?.trim() || undefined,
    organization: {
      slug: configuredSlug || (tenancy === "multi" ? "" : DEMO_ORGANIZATION.slug),
      name: configuredSlug
        ? env.SPUR_ORGANIZATION_NAME?.trim() || env.SPUR_REPOSITORY_NAME?.trim() || configuredSlug
        : tenancy === "multi" ? "Spur" : DEMO_ORGANIZATION.name,
    },
    runtimeRoot: projectRoot,
    repositoryRoot,
    repositoryName: env.SPUR_REPOSITORY_NAME?.trim() || undefined,
    applicationNaming: applicationName
      ? { canonicalName: applicationName, aliases: [...new Set(applicationAliases)] }
      : undefined,
    securityContact: securityContact || undefined,
    additionalRepositoryRoots: (tenancy === "single" ? env.SPUR_ADDITIONAL_REPOSITORIES ?? "" : "")
      .split(path.delimiter)
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => path.resolve(projectRoot, root)),
    codeSearch: readCodeSearchMode(env.SPUR_CODE_SEARCH),
    databaseUrl: env.DATABASE_URL?.trim() || "postgresql://spur:spur@localhost:5432/spur",
    actorName: env.SPUR_ACTOR_NAME?.trim() || "Local operator",
    synthesisProvider: provider,
    openAIKey: env.OPENAI_API_KEY?.trim(),
    openAIModel: env.OPENAI_MODEL?.trim(),
    openAIReasoningEffort: readOpenAIReasoningEffort(
      env.SPUR_OPENAI_REASONING_EFFORT,
    ),
    anthropicKey: env.ANTHROPIC_API_KEY?.trim(),
    anthropicModel: env.ANTHROPIC_MODEL?.trim(),
    modelTimeoutMs: readPositiveInteger(
      env.SPUR_MODEL_TIMEOUT_MS,
      20_000,
      "SPUR_MODEL_TIMEOUT_MS",
    ),
    maxOutputTokens: readPositiveInteger(
      env.SPUR_MAX_OUTPUT_TOKENS,
      1_200,
      "SPUR_MAX_OUTPUT_TOKENS",
    ),
    authMode,
    localRestrictedRead: env.SPUR_LOCAL_RESTRICTED_READ?.trim().toLowerCase() === "on",
    googleClientId: env.SPUR_GOOGLE_CLIENT_ID?.trim() || undefined,
    googleClientSecret: env.SPUR_GOOGLE_CLIENT_SECRET?.trim() || undefined,
    emailProvider,
    emailFrom,
    mailgunApiKey: env.MAILGUN_API_KEY?.trim() || undefined,
    mailgunDomain: env.MAILGUN_DOMAIN?.trim() || undefined,
    mailgunBaseUrl: (env.MAILGUN_BASE_URL?.trim() || "https://api.eu.mailgun.net").replace(/\/+$/, ""),
    smtpHost: env.SMTP_HOST?.trim() || undefined,
    smtpPort: readPositiveInteger(
      env.SMTP_PORT,
      smtpSecure ? 465 : 587,
      "SMTP_PORT",
    ),
    smtpSecure,
    smtpRequireTls,
    smtpUsername,
    smtpPassword,
    otpLifetimeSeconds: readPositiveInteger(
      env.SPUR_OTP_LIFETIME_SECONDS,
      10 * 60,
      "SPUR_OTP_LIFETIME_SECONDS",
    ),
    allowedDomains: (env.SPUR_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim().toLocaleLowerCase())
      .filter(Boolean),
    bootstrapAdmins: (env.SPUR_BOOTSTRAP_ADMINS ?? "")
      .split(",")
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
    bootstrapSecurityOwners: (env.SPUR_BOOTSTRAP_SECURITY_OWNERS ?? "")
      .split(",")
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
    sessionLifetimeSeconds: readPositiveInteger(
      env.SPUR_SESSION_LIFETIME_SECONDS,
      7 * 24 * 60 * 60,
      "SPUR_SESSION_LIFETIME_SECONDS",
    ),
    mcpRateLimitPerMinute: readPositiveInteger(
      env.SPUR_MCP_RATE_LIMIT_PER_MINUTE,
      60,
      "SPUR_MCP_RATE_LIMIT_PER_MINUTE",
    ),
    sourceProvider,
    githubOwner: env.SPUR_GITHUB_OWNER?.trim() || undefined,
    githubRepository: env.SPUR_GITHUB_REPOSITORY?.trim() || undefined,
    githubAppToken: env.SPUR_GITHUB_APP_TOKEN?.trim() || undefined,
    githubApiUrl: env.SPUR_GITHUB_API_URL?.trim() || "https://api.github.com",
  };
}

export function loadOrganizationConfigs(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): SpurConfig[] {
  if (tenancyMode(env) === "multi") throw new ConfigurationError("Multi-organisation configuration must be loaded from the database.");
  return [loadConfig(env, projectRoot)];
}

export function listConfiguredOrganizations(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): ConfiguredOrganization[] {
  return loadOrganizationConfigs(env, projectRoot).map((config) => ({
    slug: config.organization.slug,
    name: config.organization.name,
    requires_authentication: config.authMode !== "none",
  }));
}

export function loadOrganizationConfig(
  slug: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): SpurConfig {
  const configs = loadOrganizationConfigs(env, projectRoot);
  const requested = slug?.trim() || env.SPUR_ORGANIZATION_SLUG?.trim();
  if (!requested) return configs[0];
  const config = configs.find((candidate) => candidate.organization.slug === requested);
  if (!config) {
    throw new ConfigurationError(`Organization '${requested}' is not configured.`);
  }
  return config;
}

export function defaultOrganizationSlug(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): string {
  return loadOrganizationConfigs(env, projectRoot)[0].organization.slug;
}

export function loadInstanceConfig(env: NodeJS.ProcessEnv = process.env, projectRoot = process.cwd()): SpurConfig {
  const config = loadConfig(env, projectRoot);
  return config.tenancy === "multi" ? { ...config, organization: { slug: "", name: "Spur" } } : config;
}

export async function resolveOrganizationConfig(
  slug: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): Promise<SpurConfig> {
  if (tenancyMode(env) === "single") return loadOrganizationConfig(slug, env, projectRoot);
  const { OrganizationStore } = await import("./organization-store");
  const { organizationSlugSchema } = await import("./organization-settings");
  const { InputError } = await import("./errors");
  const requested = organizationSlugSchema.safeParse(slug?.trim());
  if (!requested.success) throw new InputError("Choose an organisation to continue.");
  const base = loadInstanceConfig(env, projectRoot);
  const store = new OrganizationStore(base.databaseUrl, base.encryptionKey);
  const organisation = await store.get(requested.data);
  const secrets = await store.readSecrets(requested.data);
  const settings = organisation.settings;
  const primary = settings.repositories[0];
  const githubEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV,
    SPUR_GITHUB_APP_ID: settings.github_app_id,
    SPUR_GITHUB_APP_PRIVATE_KEY: secrets.github_app_private_key,
    SPUR_GITHUB_APP_TOKEN: secrets.github_app_token,
  };
  if (base.authMode === "google" && settings.google_client_id && !secrets.google_client_secret) {
    throw new ConfigurationError("This organisation's Google sign-in credential is missing.", "missing_credentials");
  }
  return {
    ...base,
    organization: { slug: organisation.slug, name: organisation.name },
    allowedDomains: settings.allowed_domains ?? base.allowedDomains,
    applicationNaming: settings.application_name !== undefined
      ? settings.application_name ? { canonicalName: settings.application_name, aliases: settings.application_aliases ?? [] } : undefined
      : base.applicationNaming,
    securityContact: settings.security_contact ?? base.securityContact,
    googleClientId: settings.google_client_id || base.googleClientId,
    googleClientSecret: settings.google_client_id ? secrets.google_client_secret : base.googleClientSecret,
    bootstrapAdmins: [organisation.first_admin_email],
    bootstrapSecurityOwners: [],
    localRestrictedRead: false,
    repositoryRoot: primary?.provider === "local" ? path.resolve(projectRoot, primary.root) : "",
    repositoryName: primary?.provider === "local" ? primary.name : undefined,
    additionalRepositoryRoots: [],
    repositoryConnections: settings.repositories,
    sourceProvider: primary?.provider === "github" ? "github" : "local",
    githubOwner: primary?.provider === "github" ? primary.owner : undefined,
    githubRepository: primary?.provider === "github" ? primary.repository : undefined,
    githubAppToken: secrets.github_app_token,
    githubApiUrl: "https://api.github.com",
    githubEnvironment,
  };
}
