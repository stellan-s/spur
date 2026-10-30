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
    return NextResponse.json({
      grants: await access.listOAuthGrants(config.organization.slug),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = publicErrorMessage(error, "Remote MCP connections could not be loaded.");
    return NextResponse.json({ error: message }, { status: error instanceof SpurError ? error.status : 500 });
  } finally {
    await access?.close();
  }
}
