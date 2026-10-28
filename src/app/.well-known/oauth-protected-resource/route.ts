import { publicRequestUrl } from "@/core/public-url";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicRequestUrl(request).origin;
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
