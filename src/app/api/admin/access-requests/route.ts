import { NextResponse } from "next/server";

import { AccessStore } from "@/core/access-store";
import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let access: AccessStore | undefined;
  try {
    const { config } = await authorizeApiRequest(request);
    access = new AccessStore(config.databaseUrl);
    await access.ensureOrganization(config.organization.slug, config.organization.name);
    return NextResponse.json({
      access_requests: await access.listAccessRequests(config.organization.slug),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = publicErrorMessage(error, "Access requests could not be loaded.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}
