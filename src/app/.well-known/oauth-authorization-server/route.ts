import { publicRequestUrl } from "@/core/public-url";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicRequestUrl(request).origin;
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
