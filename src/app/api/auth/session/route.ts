import { NextResponse } from "next/server";

import { authenticateRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { config, principal } = await authenticateRequest(request);
    return NextResponse.json({
      organization: config.organization,
      tenancy: config.tenancy,
      user: {
        id: principal.userId,
        email: principal.email,
        display_name: principal.displayName,
        access_status: principal.accessStatus,
        permissions: [...principal.permissions].sort(),
        instance_administrator: principal.instanceAdministrator === true,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = publicErrorMessage(error, "Session could not be loaded.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
