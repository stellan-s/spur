import { NextResponse } from "next/server";

import { AccessStore } from "@/core/access-store";
import { SESSION_COOKIE, requireSameOrigin, sessionToken } from "@/core/auth";
import { loadInstanceConfig } from "@/core/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  requireSameOrigin(request);
  const config = loadInstanceConfig();
  const token = sessionToken(request);
  if (token && config.authMode !== "none") {
    const access = new AccessStore(config.databaseUrl);
    try {
      await access.revokeSession(token);
    } finally {
      await access.close();
    }
  }
  const response = NextResponse.json({ signed_out: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
