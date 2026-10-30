import { NextResponse } from "next/server";

import { AccessStore } from "@/core/access-store";
import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    access = new AccessStore(config.databaseUrl);
    const { id } = await context.params;
    await access.revokeOAuthGrantById(config.organization.slug, id, principal.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = publicErrorMessage(error, "The MCP connection could not be revoked.");
    return NextResponse.json({ error: message }, { status: error instanceof SpurError ? error.status : 500 });
  } finally {
    await access?.close();
  }
}
