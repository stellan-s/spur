import { loadInstanceConfig } from "@/core/config";
import { sharedPool } from "@/core/db-pool";
import { logUnexpectedError } from "@/core/logger";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = rateLimited(request, "health");
  if (limited) return limited;
  try {
    const config = loadInstanceConfig();
    await sharedPool(config.databaseUrl).query("SELECT 1");
    return Response.json({ status: "ok", database: "ready" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logUnexpectedError("health_check_failed", error);
    return Response.json({ status: "unavailable", database: "unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
