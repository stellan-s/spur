import { AccessStore } from "@/core/access-store";
import { loadInstanceConfig } from "@/core/config";
import { oauthClientRegistrationSchema, oauthError, validRedirectUri } from "@/core/oauth";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth_register");
  if (limited) return limited;
  const config = loadInstanceConfig();
  const access = new AccessStore(config.databaseUrl);
  try {
    const parsed = oauthClientRegistrationSchema.safeParse(await request.json());
    if (!parsed.success) return oauthError("invalid_client_metadata", "The client metadata is invalid.");
    if (parsed.data.redirect_uris.some((uri) => !validRedirectUri(uri))) {
      return oauthError("invalid_redirect_uri", "Redirect URIs must be a loopback address or an approved MCP client host.");
    }
    if (parsed.data.grant_types?.some((grant) => !["authorization_code", "refresh_token"].includes(grant)) ||
        parsed.data.response_types?.some((type) => type !== "code")) {
      return oauthError("invalid_client_metadata", "Only the authorization-code flow is supported.");
    }
    const client = await access.registerOAuthClient({
      clientName: parsed.data.client_name,
      redirectUris: [...new Set(parsed.data.redirect_uris)],
    });
    return Response.json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return oauthError("server_error", "The client could not be registered.", 500);
  } finally {
    await access.close();
  }
}
