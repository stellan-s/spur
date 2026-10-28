import { AccessStore } from "./access-store";
import { noOpAccessNotifier, type AccessNotifier } from "./access-notifier";
import type { SpurConfig } from "./config";
import { resolveOrganizationConfig } from "./config";
import { AuthenticationError } from "./errors";
import { sendLoginCode } from "./email-delivery";
import { safeReturnPath } from "./public-url";
import { clientAddress } from "./request-limit";

export const OTP_CHALLENGE_COOKIE = "spur_otp_challenge";

export async function beginEmailOtp(
  config: SpurConfig,
  request: Request,
  emailInput: string,
  returnTo?: string,
): Promise<{ challengeToken: string }> {
  if (config.authMode !== "otp") {
    throw new AuthenticationError("Email code sign-in is not enabled.", "otp_not_enabled");
  }
  const email = emailInput.trim().toLocaleLowerCase();
  const domain = email.split("@").at(-1) ?? "";
  const bootstrap = config.bootstrapAdmins.includes(email) || config.instanceAdmins.includes(email);
  if (config.allowedDomains.length > 0 && !config.allowedDomains.includes(domain) && !bootstrap) {
    throw new AuthenticationError("This email domain is not allowed.", "domain_not_allowed");
  }
  const access = new AccessStore(config.databaseUrl);
  let challenge: { token: string; code: string } | undefined;
  try {
    if (config.organization.slug) {
      await access.ensureOrganization(config.organization.slug, config.organization.name);
    }
    await access.purgeExpired();
    challenge = await access.createLoginOtpChallenge({
      organizationId: config.organization.slug,
      email,
      returnTo: safeReturnPath(returnTo),
      lifetimeSeconds: config.otpLifetimeSeconds,
      ipAddress: clientAddress(request),
    });
    try {
      await sendLoginCode(config, { email, code: challenge.code });
    } catch (error) {
      await access.deleteLoginOtpChallenge(challenge.token);
      throw error;
    }
    return { challengeToken: challenge.token };
  } finally {
    await access.close();
  }
}

export async function finishEmailOtp(
  config: SpurConfig,
  request: Request,
  challengeToken: string | undefined,
  code: string,
  notifier: AccessNotifier = noOpAccessNotifier,
): Promise<{
  token: string;
  expiresAt: Date;
  accessStatus: string;
  organizationId: string;
  returnTo?: string;
}> {
  if (!challengeToken) {
    throw new AuthenticationError("Request a new login code.", "otp_missing");
  }
  const access = new AccessStore(config.databaseUrl);
  try {
    const challenge = await access.consumeLoginOtpChallenge(challengeToken, code);
    if (config.tenancy === "multi" && challenge.organizationId) {
      config = await resolveOrganizationConfig(challenge.organizationId);
    } else if (challenge.organizationId !== config.organization.slug) {
      throw new AuthenticationError("The sign-in organisation did not match.", "otp_invalid");
    }
    const result = await access.signInWithEmailOtp({
      organizationId: config.organization.slug,
      email: challenge.email,
      bootstrapAdmins: new Set(config.bootstrapAdmins),
      bootstrapSecurityOwners: new Set(config.bootstrapSecurityOwners),
      instanceAdmins: config.tenancy === "multi" ? new Set(config.instanceAdmins) : undefined,
      allowedDomains: config.allowedDomains,
      sessionLifetimeSeconds: config.sessionLifetimeSeconds,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ipAddress: clientAddress(request),
    });
    if (result.requestCreated && result.principal.accessStatus === "pending") {
      await notifier.accessRequested({
        organizationId: config.organization.slug,
        email: challenge.email,
        displayName: challenge.email,
      });
    }
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      accessStatus: result.principal.accessStatus,
      organizationId: result.principal.organizationId,
      returnTo: safeReturnPath(challenge.returnTo),
    };
  } finally {
    await access.close();
  }
}
