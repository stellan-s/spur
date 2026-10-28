import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE, requireSameOrigin } from "@/core/auth";
import { loadInstanceConfig } from "@/core/config";
import { finishEmailOtp, OTP_CHALLENGE_COOKIE } from "@/core/email-otp";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";
import { publicRequestUrl } from "@/core/public-url";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

function challengeToken(request: Request): string | undefined {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0 && item.slice(0, separator).trim() === OTP_CHALLENGE_COOKIE) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export async function POST(request: Request) {
  const limited = rateLimited(request, "sign_in");
  if (limited) return limited;
  const url = publicRequestUrl(request);
  try {
    requireSameOrigin(request);
    const body = bodySchema.parse(await request.json());
    const result = await finishEmailOtp(loadInstanceConfig(), request, challengeToken(request), body.code);
    const target = result.accessStatus === "approved"
      ? result.returnTo ?? (result.organizationId ? `/o/${result.organizationId}/model` : "/organizations")
      : `/access/pending?organization=${encodeURIComponent(result.organizationId)}`;
    const response = NextResponse.json({ target });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      expires: result.expiresAt,
    });
    response.cookies.set(OTP_CHALLENGE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/api/auth/otp",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = publicErrorMessage(error, "The login code could not be verified.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
