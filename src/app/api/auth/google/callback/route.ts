import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/core/auth";
import { loadInstanceConfig } from "@/core/config";
import { SpurError } from "@/core/errors";
import { finishGoogleSignIn, OIDC_STATE_COOKIE } from "@/core/google-auth";
import { publicErrorMessage } from "@/core/public-error";
import { publicRequestUrl } from "@/core/public-url";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function browserState(request: Request): string | undefined {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0 && item.slice(0, separator).trim() === OIDC_STATE_COOKIE) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export async function GET(request: Request) {
  const limited = rateLimited(request, "sign_in");
  if (limited) return limited;
  const url = publicRequestUrl(request);
  const secure = url.protocol === "https:";
  let response: NextResponse;
  try {
    const config = loadInstanceConfig();
    const result = await finishGoogleSignIn(config, request, browserState(request));
    const target = result.accessStatus === "approved"
      ? result.returnTo ?? (result.organizationId ? `/o/${result.organizationId}/model` : "/organizations")
      : `/access/pending?organization=${encodeURIComponent(result.organizationId)}`;
    response = NextResponse.redirect(new URL(target, url.origin));
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: result.expiresAt,
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Google sign-in failed.");
    const code = error instanceof SpurError ? error.code : "sign_in_failed";
    const target = new URL("/access/pending", url.origin);
    target.searchParams.set("error", message);
    target.searchParams.set("code", code);
    response = NextResponse.redirect(target);
  }
  response.cookies.set(OIDC_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/api/auth/google/callback",
    maxAge: 0,
  });
  return response;
}
