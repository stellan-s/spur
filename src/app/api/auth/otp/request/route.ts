import { NextResponse } from "next/server";
import { z } from "zod";

import { loadInstanceConfig, resolveOrganizationConfig, tenancyMode } from "@/core/config";
import { beginEmailOtp, OTP_CHALLENGE_COOKIE } from "@/core/email-otp";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";
import { publicRequestUrl, safeReturnPath } from "@/core/public-url";
import { rateLimited } from "@/core/request-limit";
import { requireSameOrigin } from "@/core/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.email().trim().max(254).transform((value) => value.toLowerCase()),
  organization: z.string().trim().max(63).optional(),
  return_to: z.string().max(2_000).optional(),
}).strict();

export async function POST(request: Request) {
  const limited = rateLimited(request, "sign_in");
  if (limited) return limited;
  try {
    requireSameOrigin(request);
    const body = bodySchema.parse(await request.json());
    const organization = body.organization || undefined;
    const config = tenancyMode() === "multi" && !organization
      ? loadInstanceConfig()
      : await resolveOrganizationConfig(organization);
    const result = await beginEmailOtp(config, request, body.email, safeReturnPath(body.return_to));
    const url = publicRequestUrl(request);
    const response = NextResponse.json({ sent: true });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(OTP_CHALLENGE_COOKIE, result.challengeToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/api/auth/otp",
      maxAge: config.otpLifetimeSeconds,
    });
    return response;
  } catch (error) {
    const message = publicErrorMessage(error, "The login code could not be sent.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
