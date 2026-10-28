import { AccessStore } from "@/core/access-store";
import { loadInstanceConfig } from "@/core/config";
import { oauthError } from "@/core/oauth";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Revocation requests must use form encoding.", 415);
  }
  const access = new AccessStore(loadInstanceConfig().databaseUrl);
  try {
    const form = new URLSearchParams(await request.text());
    const token = form.get("token");
    if (token) await access.revokeOAuthToken(token);
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return oauthError("server_error", "The token could not be revoked.", 500);
  } finally {
    await access.close();
  }
}
