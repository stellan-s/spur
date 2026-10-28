import { NextResponse } from "next/server";
import { z } from "zod";

import { AccessStore } from "@/core/access-store";
import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { PERMISSIONS } from "@/core/permissions";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("roles"), role_ids: z.array(z.string().trim().min(1)) }),
  z.object({ action: z.literal("permission"), permission: z.enum(PERMISSIONS), granted: z.boolean() }),
  z.object({ action: z.literal("revoke") }),
]);

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const input = updateSchema.parse(await request.json());
    const { id } = await context.params;
    access = new AccessStore(config.databaseUrl);
    if (input.action === "roles") {
      await access.setUserRoles({
        organizationId: config.organization.slug,
        userId: id,
        roleIds: input.role_ids,
        actorUserId: principal.userId,
      });
    } else if (input.action === "permission") {
      await access.setUserPermission({
        organizationId: config.organization.slug,
        userId: id,
        permission: input.permission,
        granted: input.granted,
        actorUserId: principal.userId,
      });
    } else {
      await access.revokeUser(config.organization.slug, id, principal.userId);
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = publicErrorMessage(error, "The user could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}
