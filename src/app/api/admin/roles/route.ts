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

export async function GET(request: Request) {
  let access: AccessStore | undefined;
  try {
    const { config } = await authorizeApiRequest(request);
    access = new AccessStore(config.databaseUrl);
    await access.ensureOrganization(config.organization.slug, config.organization.name);
    return NextResponse.json({
      roles: await access.listRoles(config.organization.slug),
      permissions: PERMISSIONS,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = publicErrorMessage(error, "Roles could not be loaded.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}

export async function POST(request: Request) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const input = roleSchema.parse(await request.json());
    access = new AccessStore(config.databaseUrl);
    const role = await access.saveCustomRole({
      organizationId: config.organization.slug,
      actorUserId: principal.userId,
      ...input,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    const message = publicErrorMessage(error, "The role could not be created.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}
