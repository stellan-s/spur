import { NextResponse } from "next/server";
import { z } from "zod";

import { AccessStore } from "@/core/access-store";
import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { PERMISSIONS } from "@/core/permissions";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  permissions: z.array(z.enum(PERMISSIONS)),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const input = roleSchema.parse(await request.json());
    const { id } = await context.params;
    access = new AccessStore(config.databaseUrl);
    const role = await access.saveCustomRole({
      organizationId: config.organization.slug,
      actorUserId: principal.userId,
      id,
      ...input,
    });
    return NextResponse.json({ role });
  } catch (error) {
    const message = publicErrorMessage(error, "The role could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}

export async function DELETE(request: Request, context: Context) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const { id } = await context.params;
    access = new AccessStore(config.databaseUrl);
    await access.deleteCustomRole(config.organization.slug, id, principal.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = publicErrorMessage(error, "The role could not be deleted.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}
