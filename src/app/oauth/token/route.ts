import { AccessStore } from "@/core/access-store";
import { loadInstanceConfig } from "@/core/config";
import { AuthenticationError } from "@/core/errors";
import { oauthError } from "@/core/oauth";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Token requests must use form encoding.", 415);
  }
  const config = loadInstanceConfig();
  const access = new AccessStore(config.databaseUrl);
  try {
    const form = new URLSearchParams(await request.text());
    const grantType = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (!clientId) return oauthError("invalid_client", "client_id is required.", 401);
    let tokens;
    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const redirectUri = form.get("redirect_uri") ?? "";
      const codeVerifier = form.get("code_verifier") ?? "";
      if (!code || !redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
        return oauthError("invalid_request", "code, redirect_uri and a valid code_verifier are required.");
      }
      tokens = await access.exchangeOAuthAuthorizationCode({ code, clientId, redirectUri, codeVerifier });
    } else if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.");
      tokens = await access.refreshOAuthToken({ refreshToken, clientId });
    } else {
      return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    }
    return Response.json({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return oauthError(error.code, error.message);
    return oauthError("server_error", "The token request failed.", 500);
  } finally {
    await access.close();
  }
}
