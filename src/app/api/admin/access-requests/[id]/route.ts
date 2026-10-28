import { NextResponse } from "next/server";
import { z } from "zod";

import { AccessStore } from "@/core/access-store";
import { noOpAccessNotifier } from "@/core/access-notifier";
import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  role_ids: z.array(z.string().trim().min(1)).default([]),
  reason: z.string().trim().max(500).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  let access: AccessStore | undefined;
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const input = decisionSchema.parse(await request.json());
    const { id } = await context.params;
    access = new AccessStore(config.databaseUrl);
    const candidate = (await access.listAccessRequests(config.organization.slug))
      .find((item) => item.id === id);
    await access.decideAccessRequest({
      organizationId: config.organization.slug,
      requestId: id,
      decision: input.decision,
      roleIds: input.role_ids,
      actorUserId: principal.userId,
      reason: input.reason,
    });
    if (candidate) {
      await noOpAccessNotifier.accessDecided({
        organizationId: config.organization.slug,
        email: candidate.email,
        displayName: candidate.display_name,
        decision: input.decision,
      });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = publicErrorMessage(error, "The access request could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await access?.close();
  }
}
