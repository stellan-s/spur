import { NextResponse } from "next/server";

import { loadInstanceConfig, resolveOrganizationConfig, tenancyMode } from "@/core/config";
import { SpurError } from "@/core/errors";
import { beginGoogleSignIn, OIDC_STATE_COOKIE } from "@/core/google-auth";
import { publicErrorMessage } from "@/core/public-error";
import { publicRequestUrl, safeReturnPath } from "@/core/public-url";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = rateLimited(request, "sign_in");
  if (limited) return limited;
  try {
    const url = publicRequestUrl(request);
    const organization = url.searchParams.get("organization") || undefined;
    const config = tenancyMode() === "multi" && !organization
      ? loadInstanceConfig()
      : await resolveOrganizationConfig(organization);
    const returnTo = safeReturnPath(url.searchParams.get("return_to"));
    if (config.authMode !== "google") {
      return NextResponse.redirect(new URL(returnTo ?? `/o/${config.organization.slug}/model`, url.origin));
    }
    const signIn = await beginGoogleSignIn(config, url, returnTo);
    const response = NextResponse.redirect(signIn.url);
    response.cookies.set(OIDC_STATE_COOKIE, signIn.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/api/auth/google/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const message = publicErrorMessage(error, "Google sign-in could not start.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
