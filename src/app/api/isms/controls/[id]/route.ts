import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePrincipalPermission } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { ismsControlInputSchema } from "@/core/isms-types";
import { createAuthenticatedRequestContext, createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expected_version: z.number().int().positive(), control: ismsControlInputSchema }),
  z.object({ action: z.literal("approve"), expected_version: z.number().int().positive() }),
  z.object({ action: z.literal("archive"), expected_version: z.number().int().positive(), confirmation: z.string() }),
]);

function errorResponse(error: unknown) {
  const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ error: publicErrorMessage(error, "ISMS control unavailable.") }, { status });
}

export async function GET(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const { id } = await context.params;
    return NextResponse.json(await service.getIsmsControlDetail(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}

export async function PATCH(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    const { id } = await context.params;
    const mutation = mutationSchema.parse(await request.json());
    if (mutation.action === "save") {
      requirePrincipalPermission(requestContext.principal, "isms.propose");
      await service.saveIsmsControl(mutation.control, id, mutation.expected_version);
    } else if (mutation.action === "approve") {
      requirePrincipalPermission(requestContext.principal, "isms.approve");
      await service.approveIsmsControl(id, mutation.expected_version);
    } else {
      requirePrincipalPermission(requestContext.principal, "isms.archive");
      await service.archiveIsmsControl(id, mutation.expected_version, mutation.confirmation);
    }
    if (mutation.action === "archive") return new Response(null, { status: 204 });
    return NextResponse.json(await service.getIsmsControlDetail(id));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}
