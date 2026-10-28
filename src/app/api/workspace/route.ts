import { NextResponse } from "next/server";

import { SpurError } from "@/core/errors";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    return NextResponse.json({
      ...await service.workspace(),
      features: requestContext.features,
      permissions: [...requestContext.principal.permissions].sort(),
      session: {
        auth_mode: requestContext.config.authMode,
        tenancy: requestContext.config.tenancy,
        display_name: requestContext.principal.displayName,
        email: requestContext.principal.email,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Workspace unavailable.");
    const status = error instanceof SpurError ? error.status : 500;
    const code = error instanceof SpurError ? error.code : "workspace_unavailable";
    return NextResponse.json({ error: message, code }, { status });
  } finally {
    await service?.close();
  }
}
