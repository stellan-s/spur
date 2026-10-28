import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { localPrincipal } from "@/core/access-store";
import { createAdapter } from "@/core/analysis";
import { listConfiguredOrganizations, loadConfig, loadOrganizationConfigs } from "@/core/config";

const baseEnvironment = {
  NODE_ENV: "test" as const,
  SPUR_ORGANIZATION_SLUG: "northstar",
  SPUR_REPOSITORY_ROOT: "./fixture-repo",
};

describe("environment template", () => {
  it("loads the minimal local setup without optional credentials", () => {
    const env = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
    const config = loadConfig({ ...env, NODE_ENV: "test" });

    expect(Object.keys(env).sort()).toEqual([
      "DATABASE_URL",
      "SPUR_AUTH",
      "SPUR_SYNTHESIS_PROVIDER",
    ]);
    expect(config).toMatchObject({
      organization: { slug: "demo", name: "Demo organisation" },
      authMode: "none",
      sourceProvider: "local",
      synthesisProvider: "none",
      codeSearch: "off",
      localRestrictedRead: false,
      bootstrapAdmins: [],
      modelTimeoutMs: 20_000,
      maxOutputTokens: 1_200,
    });
  });

  it("keeps runtime budgets configurable without requiring explicit defaults", () => {
    const defaults = loadConfig(baseEnvironment);
    expect(defaults.modelTimeoutMs).toBe(20_000);
    expect(defaults.maxOutputTokens).toBe(1_200);

    const overridden = loadConfig({
      ...baseEnvironment,
      SPUR_MODEL_TIMEOUT_MS: "30000",
      SPUR_MAX_OUTPUT_TOKENS: "2400",
    });
    expect(overridden.modelTimeoutMs).toBe(30_000);
    expect(overridden.maxOutputTokens).toBe(2_400);
  });
});

describe("model provider configuration", () => {
  it("configures OpenAI reasoning effort explicitly", () => {
    const config = loadConfig(
      {
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-test-model",
        SPUR_OPENAI_REASONING_EFFORT: "low",
      },
      process.cwd(),
    );

    expect(config.openAIReasoningEffort).toBe("low");
    expect(createAdapter(config).provider).toBe("openai");
  });

  it("rejects an unknown OpenAI reasoning effort", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-test-model",
        SPUR_OPENAI_REASONING_EFFORT: "turbo",
      }),
    ).toThrow(/SPUR_OPENAI_REASONING_EFFORT/);
  });

  it("configures the Anthropic adapter explicitly", () => {
    const config = loadConfig(
      {
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_MODEL: "claude-test-model",
      },
      process.cwd(),
    );

    expect(config.synthesisProvider).toBe("anthropic");
    expect(config.anthropicModel).toBe("claude-test-model");
    expect(createAdapter(config).provider).toBe("anthropic");
  });

  it("requires an Anthropic API key", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "anthropic",
        ANTHROPIC_MODEL: "claude-test-model",
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("requires an explicit Claude model", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-key",
      }),
    ).toThrow(/ANTHROPIC_MODEL/);
  });

  it("rejects unknown providers", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        SPUR_SYNTHESIS_PROVIDER: "unknown",
      }),
    ).toThrow(/none.*openai.*anthropic/);
  });

  it("keeps the old model-provider variable as a migration alias", () => {
    const config = loadConfig({
      ...baseEnvironment,
      SPUR_MODEL_PROVIDER: "none",
    });

    expect(config.synthesisProvider).toBe("none");
  });
});

describe("organization configuration", () => {
  it("requires a GitHub App installation token for cloud source verification", () => {
    expect(() => loadConfig({ ...baseEnvironment, SPUR_SOURCE_PROVIDER: "github" }))
      .toThrow(/SPUR_GITHUB_APP_TOKEN/);
    const config = loadConfig({
      ...baseEnvironment,
      SPUR_SOURCE_PROVIDER: "github",
      SPUR_GITHUB_OWNER: "acme",
      SPUR_GITHUB_REPOSITORY: "portal",
      SPUR_GITHUB_APP_TOKEN: "installation-token",
    });
    expect(config).toMatchObject({
      sourceProvider: "github",
      githubOwner: "acme",
      githubRepository: "portal",
      githubAppToken: "installation-token",
    });
  });

  it("requires Google credentials for shared authentication", () => {
    expect(() => loadConfig({ ...baseEnvironment, SPUR_AUTH: "google" }))
      .toThrow(/SPUR_GOOGLE_CLIENT_ID/);
    const config = loadConfig({
      ...baseEnvironment,
      SPUR_AUTH: "google",
      SPUR_GOOGLE_CLIENT_ID: "client-id",
      SPUR_GOOGLE_CLIENT_SECRET: "client-secret",
      SPUR_ALLOWED_DOMAINS: "example.com, example.org",
      SPUR_BOOTSTRAP_ADMINS: "Owner@Example.com",
    });
    expect(config.allowedDomains).toEqual(["example.com", "example.org"]);
    expect(config.bootstrapAdmins).toEqual(["owner@example.com"]);
  });

  it("configures Mailgun-backed email-code authentication", () => {
    expect(() => loadConfig({ ...baseEnvironment, SPUR_AUTH: "otp" }))
      .toThrow(/SPUR_EMAIL_PROVIDER/);
    const config = loadConfig({
      ...baseEnvironment,
      SPUR_AUTH: "otp",
      SPUR_EMAIL_PROVIDER: "mailgun",
      SPUR_EMAIL_FROM: "Spur <login@mail.example.com>",
      MAILGUN_API_KEY: "key-test",
      MAILGUN_DOMAIN: "mail.example.com",
      MAILGUN_BASE_URL: "https://api.eu.mailgun.net/",
      SPUR_OTP_LIFETIME_SECONDS: "900",
    });
    expect(config).toMatchObject({
      authMode: "otp",
      emailProvider: "mailgun",
      emailFrom: "Spur <login@mail.example.com>",
      mailgunDomain: "mail.example.com",
      mailgunBaseUrl: "https://api.eu.mailgun.net",
      otpLifetimeSeconds: 900,
    });
  });

  it("configures vendor-neutral SMTP email delivery", () => {
    const config = loadConfig({
      ...baseEnvironment,
      SPUR_AUTH: "otp",
      SPUR_EMAIL_PROVIDER: "smtp",
      SPUR_EMAIL_FROM: "Spur <login@example.com>",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USERNAME: "smtp-user",
      SMTP_PASSWORD: "smtp-password",
    });
    expect(config).toMatchObject({
      emailProvider: "smtp",
      emailFrom: "Spur <login@example.com>",
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: "smtp-user",
      smtpPassword: "smtp-password",
    });
  });

  it("refuses unauthenticated mode on a non-loopback bind address", () => {
    expect(() => loadConfig({
      ...baseEnvironment,
      SPUR_AUTH: "none",
      SPUR_BIND_ADDRESS: "0.0.0.0",
    })).toThrow(/loopback/);
  });

  it("configures a security contact for restricted controls", () => {
    const config = loadConfig({ ...baseEnvironment, SPUR_SECURITY_CONTACT: "Security team" });
    expect(config.securityContact).toBe("Security team");
  });

  it("masks restricted details for the local user unless opted in", () => {
    const masked = loadConfig(baseEnvironment);
    const opted = loadConfig({ ...baseEnvironment, SPUR_LOCAL_RESTRICTED_READ: "on" });
    expect(localPrincipal("default", "Local", { restrictedRead: masked.localRestrictedRead })
      .permissions.has("restricted.read")).toBe(false);
    expect(localPrincipal("default", "Local", { restrictedRead: opted.localRestrictedRead })
      .permissions.has("restricted.read")).toBe(true);
  });

  it("runs the demo organisation when no organisation is configured", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.organization).toEqual({ slug: "demo", name: "Demo organisation" });
    expect(config.repositoryRoot).toBe(path.resolve(process.cwd(), "fixture-repo"));
    expect(config.applicationNaming).toBeUndefined();
  });

  it("requires an organisation for a configured repository", () => {
    expect(() => loadConfig({ NODE_ENV: "test", SPUR_REPOSITORY_ROOT: "./elsewhere" }))
      .toThrow("SPUR_ORGANIZATION_SLUG is required");
    expect(() => loadConfig({ ...baseEnvironment, SPUR_ORGANIZATION_SLUG: "Not A Slug" }))
      .toThrow("lowercase slug");
  });

  it("names the application only when configured", () => {
    const config = loadConfig(baseEnvironment);

    expect(config.applicationNaming).toBeUndefined();
  });

  it("configures the selected organization and its application name", () => {
    const configs = loadOrganizationConfigs({
      ...baseEnvironment,
      SPUR_ORGANIZATION_SLUG: "retail",
      SPUR_ORGANIZATION_NAME: "Retail",
      SPUR_APPLICATION_NAME: "Retail AI",
      SPUR_APPLICATION_ALIASES: "Retail",
      SPUR_SECURITY_CONTACT: "Retail security",
    });
    expect(configs[0].applicationNaming).toEqual({ canonicalName: "Retail AI", aliases: ["Retail"] });
    expect(configs[0].securityContact).toBe("Retail security");
    expect(configs[0].organization).toMatchObject({ slug: "retail", name: "Retail" });
  });

  it("uses one PostgreSQL database for organization-scoped storage", () => {
    const config = loadConfig({
      ...baseEnvironment,
      DATABASE_URL: "postgresql://spur:secret@database.example/spur",
      SPUR_ORGANIZATION_SLUG: "retail",
      SPUR_ORGANIZATION_NAME: "Retail",
    });

    expect(config.databaseUrl).toBe("postgresql://spur:secret@database.example/spur");
    expect(listConfiguredOrganizations({
      ...baseEnvironment,
      SPUR_ORGANIZATION_SLUG: "retail",
      SPUR_ORGANIZATION_NAME: "Retail",
    })).toEqual([{ slug: "retail", name: "Retail", requires_authentication: false }]);
  });
});
