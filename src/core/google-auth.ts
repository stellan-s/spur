import { createHash, timingSafeEqual } from "node:crypto";

import * as oidc from "openid-client";

import { AccessStore } from "./access-store";
import { noOpAccessNotifier, type AccessNotifier } from "./access-notifier";
import { AuthenticationError, ConfigurationError } from "./errors";
import { resolveOrganizationConfig, type SpurConfig } from "./config";
import { safeReturnPath } from "./public-url";
import { publicRequestUrl } from "./public-url";

// Holds the sign-in state in the browser that started sign-in, so a callback
// link cannot be completed in someone else's browser.
export const OIDC_STATE_COOKIE = "spur_oidc_state";

function sameState(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

let cachedConfiguration: Promise<oidc.Configuration> | undefined;
let cachedCredential: string | undefined;

async function googleConfiguration(config: SpurConfig): Promise<oidc.Configuration> {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new ConfigurationError("Google sign-in is not configured.", "missing_credentials");
  }
  const credential = createHash("sha256").update(JSON.stringify([config.googleClientId, config.googleClientSecret])).digest("hex");
  if (!cachedConfiguration || cachedCredential !== credential) {
    cachedCredential = credential;
    cachedConfiguration = oidc.discovery(
      new URL("https://accounts.google.com"),
      config.googleClientId,
      config.googleClientSecret,
    );
  }
  return cachedConfiguration;
}

export async function beginGoogleSignIn(
  config: SpurConfig,
  requestUrl: URL,
  returnTo?: string,
): Promise<{ url: URL; state: string }> {
  const access = new AccessStore(config.databaseUrl);
  try {
    if (config.organization.slug) await access.ensureOrganization(config.organization.slug, config.organization.name);
    await access.purgeExpired();
    const provider = await googleConfiguration(config);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = new URL("/api/auth/google/callback", requestUrl.origin).href;
    await access.saveOidcTransaction({
      state,
      organizationId: config.organization.slug,
      codeVerifier,
      nonce,
      redirectUri,
      returnTo: safeReturnPath(returnTo),
    });
    const url = oidc.buildAuthorizationUrl(provider, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      prompt: "select_account",
    });
    return { url, state };
  } finally {
    await access.close();
  }
}

export async function finishGoogleSignIn(
  config: SpurConfig,
  request: Request,
  browserState: string | undefined,
  notifier: AccessNotifier = noOpAccessNotifier,
): Promise<{
  token: string;
  expiresAt: Date;
  accessStatus: string;
  organizationId: string;
  returnTo?: string;
}> {
  const url = publicRequestUrl(request);
  const state = url.searchParams.get("state");
  if (!state) throw new AuthenticationError("Google did not return sign-in state.", "oidc_state_invalid");
  if (!browserState || !sameState(state, browserState)) {
    throw new AuthenticationError("Sign-in must finish in the browser that started it.", "oidc_state_invalid");
  }
  const access = new AccessStore(config.databaseUrl);
  try {
    const transaction = await access.consumeOidcTransaction(state);
    if (config.tenancy === "multi" && transaction.organizationId) {
      config = await resolveOrganizationConfig(transaction.organizationId);
    } else if (transaction.organizationId !== config.organization.slug) {
      throw new AuthenticationError("The sign-in organisation did not match.", "oidc_state_invalid");
    }
    const provider = await googleConfiguration(config);
    const tokens = await oidc.authorizationCodeGrant(provider, url, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    const subject = claims?.sub;
    const email = typeof claims?.email === "string" ? claims.email.toLocaleLowerCase() : "";
    if (!subject || !email || claims?.email_verified !== true) {
      throw new AuthenticationError("Google did not return a verified email address.", "email_not_verified");
    }
    const hostedDomain = typeof claims.hd === "string" ? claims.hd.toLocaleLowerCase() : "";
    const result = await access.signInWithGoogle({
      organizationId: config.organization.slug,
      subject,
      email,
      displayName: typeof claims.name === "string" ? claims.name : email,
      avatarUrl: typeof claims.picture === "string" ? claims.picture : undefined,
      bootstrapAdmins: new Set(config.bootstrapAdmins),
      bootstrapSecurityOwners: new Set(config.bootstrapSecurityOwners),
      instanceAdmins: config.tenancy === "multi" ? new Set(config.instanceAdmins) : undefined,
      allowedDomains: config.allowedDomains,
      hostedDomain,
      sessionLifetimeSeconds: config.sessionLifetimeSeconds,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });
    if (result.requestCreated && result.principal.accessStatus === "pending") {
      await notifier.accessRequested({
        organizationId: config.organization.slug,
        email,
        displayName: result.principal.displayName,
      });
    }
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      accessStatus: result.principal.accessStatus,
      organizationId: result.principal.organizationId,
      returnTo: safeReturnPath(transaction.returnTo),
    };
  } finally {
    await access.close();
  }
}
