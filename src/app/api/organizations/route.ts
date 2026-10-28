import { NextResponse } from "next/server";

import { authenticateInstanceRequest } from "@/core/auth";
import { listConfiguredOrganizations, tenancyMode } from "@/core/config";
import { OrganizationStore } from "@/core/organization-store";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    let organizations;
    if (tenancyMode() === "multi") {
      const { config, principal } = await authenticateInstanceRequest(request);
      organizations = await new OrganizationStore(config.databaseUrl).listForUser(principal.userId);
    } else {
      organizations = listConfiguredOrganizations();
    }
    return NextResponse.json(
      { organizations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = publicErrorMessage(error, "Organizations are unavailable.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
